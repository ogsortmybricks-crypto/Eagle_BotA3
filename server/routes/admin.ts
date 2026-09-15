import { Router } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, ilike, lt, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  academies,
  activityLog,
  aiJobs,
  invites,
  positionHolders,
  positions,
  studios,
  users,
  ROLES,
} from "@shared/schema";
import { publicUser, requirePermission } from "../auth";
import { logActivity } from "../activity";
import { inviteEmail, sendMail } from "../mailer";
import { aiConfigured, emailConfigured, env } from "../env";
import { getStatusSnapshot } from "../ai/jobs";
import { canReadStudio, requireScope, scoped, studioFilter } from "../studio";

export const adminRouter = Router();

/* --------------------------------- academy --------------------------------- */

adminRouter.patch("/academy", requirePermission("academy.manage"), async (req, res) => {
  const parsed = z
    .object({
      name: z.string().min(2).max(120).optional(),
      logoUrl: z.string().max(1_500_000).nullable().optional(),
      learnerNoun: z.string().min(2).max(30).optional(),
      guidesCanVote: z.boolean().optional(),
      palette: z
        .object({
          primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
          accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
          surface: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        })
        .optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Couldn't save those settings." });

  const patch: Record<string, unknown> = { ...parsed.data };
  // guidesCanVote lives in both the column and the settings blob; keep them in step.
  if (parsed.data.guidesCanVote !== undefined) {
    patch.settings = {
      ...req.settings!,
      governance: { ...req.settings!.governance, guidesCanVote: parsed.data.guidesCanVote },
    };
  }

  const [academy] = await db
    .update(academies)
    .set(patch)
    .where(eq(academies.id, req.user!.academyId))
    .returning();

  await logActivity({
    academyId: req.user!.academyId,
    actorUserId: req.user!.id,
    action: "academy.updated",
    entityType: "academy",
    entityId: academy.id,
    summary: `${req.user!.name} updated the academy settings.`,
    metadata: { fields: Object.keys(parsed.data) },
  });

  res.json({ academy });
});

/* ---------------------------------- people --------------------------------- */

adminRouter.get("/users", requirePermission("users.manage"), async (req, res) => {
  const academyId = req.user!.academyId;
  const scope = requireScope(req);
  // Admins manage the whole roster; the studio filter here is a convenience
  // view rather than a boundary, since users.manage is admin-only anyway.
  const onlyStudio = req.query.scope === "studio";

  const rows = await db
    .select()
    .from(users)
    .where(
      onlyStudio
        ? scoped(eq(users.academyId, academyId), users.studioId, scope)
        : eq(users.academyId, academyId),
    )
    .orderBy(asc(users.name));

  const held = await db
    .select({
      userId: positionHolders.userId,
      title: positions.title,
      endedAt: positionHolders.endedAt,
    })
    .from(positionHolders)
    .innerJoin(positions, eq(positions.id, positionHolders.positionId))
    .where(eq(positionHolders.academyId, academyId));

  const studioRows = await db.select().from(studios).where(eq(studios.academyId, academyId));

  res.json({
    users: rows.map((user) => ({
      ...publicUser(user),
      studioName: user.studioId
        ? (studioRows.find((studio) => studio.id === user.studioId)?.name ?? null)
        : null,
      positions: held.filter((h) => h.userId === user.id && h.endedAt === null).map((h) => h.title),
    })),
    studios: studioRows.filter((studio) => !studio.archived),
  });
});

adminRouter.patch("/users/:id", requirePermission("users.manage"), async (req, res) => {
  const parsed = z
    .object({
      role: z.enum(ROLES).optional(),
      studioId: z.number().int().nullable().optional(),
      active: z.boolean().optional(),
      name: z.string().min(2).max(120).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Couldn't save that." });

  const targetId = Number(req.params.id);

  // Don't let the last admin demote or deactivate themselves into a locked-out
  // academy - somebody has to be able to let people back in.
  if (parsed.data.role !== undefined || parsed.data.active === false) {
    const admins = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.academyId, req.user!.academyId),
          eq(users.role, "admin"),
          eq(users.active, true),
        ),
      );
    const losingAdmin =
      admins.some((a) => a.id === targetId) &&
      (parsed.data.role !== "admin" || parsed.data.active === false);
    if (losingAdmin && admins.length <= 1) {
      return res.status(409).json({
        error: "That's the only admin left. Make someone else an admin first.",
      });
    }
  }

  if (parsed.data.studioId !== undefined && parsed.data.studioId !== null) {
    const [studio] = await db
      .select()
      .from(studios)
      .where(
        and(eq(studios.id, parsed.data.studioId), eq(studios.academyId, req.user!.academyId)),
      )
      .limit(1);
    if (!studio) return res.status(400).json({ error: "That studio doesn't exist." });
    if (studio.archived) {
      return res.status(400).json({ error: `${studio.name} is archived - nobody new joins it.` });
    }
  }

  const [user] = await db
    .update(users)
    .set(parsed.data)
    .where(and(eq(users.id, targetId), eq(users.academyId, req.user!.academyId)))
    .returning();

  if (!user) return res.status(404).json({ error: "That person isn't in this academy." });

  const moved = parsed.data.studioId !== undefined;
  const [studio] = user.studioId
    ? await db.select().from(studios).where(eq(studios.id, user.studioId)).limit(1)
    : [null];

  await logActivity({
    academyId: req.user!.academyId,
    studioId: user.studioId,
    actorUserId: req.user!.id,
    action: "user.updated",
    entityType: "user",
    entityId: user.id,
    summary: `${req.user!.name} updated ${user.name}${parsed.data.role ? ` (now ${parsed.data.role})` : ""}${
      moved ? ` — studio: ${studio?.name ?? "none"}` : ""
    }.`,
    metadata: parsed.data,
  });

  res.json({ user: publicUser(user) });
});

/* --------------------------------- invites --------------------------------- */

adminRouter.get("/invites", requirePermission("invites.send"), async (req, res) => {
  const academyId = req.user!.academyId;
  const studioRows = await db.select().from(studios).where(eq(studios.academyId, academyId));

  const rows = await db
    .select()
    .from(invites)
    .where(eq(invites.academyId, academyId))
    .orderBy(desc(invites.id));

  res.json({
    invites: rows.map((invite) => ({
      ...invite,
      studioName: invite.studioId
        ? (studioRows.find((studio) => studio.id === invite.studioId)?.name ?? null)
        : null,
      link: `${env.appUrl}/invite/${invite.token}`,
      expired: invite.expiresAt < new Date(),
    })),
    studios: studioRows.filter((studio) => !studio.archived),
    emailConfigured,
  });
});

adminRouter.post("/invites", requirePermission("invites.send"), async (req, res) => {
  const parsed = z
    .object({
      emails: z.array(z.string().email()).min(1).max(60),
      role: z.enum(ROLES).optional(),
      /** Which studio they join. Omitted means the one being viewed. */
      studioId: z.number().int().nullable().optional(),
      name: z.string().max(120).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Enter at least one valid email address." });
  }

  const academyId = req.user!.academyId;
  const scope = requireScope(req);
  const settings = req.settings!;
  const role = parsed.data.role ?? settings.access.defaultInviteRole;

  const [academy] = await db.select().from(academies).where(eq(academies.id, academyId)).limit(1);
  if (!academy) return res.status(404).json({ error: "Academy not found." });

  const studioId =
    parsed.data.studioId !== undefined ? parsed.data.studioId : scope.studioId;
  if (studioId !== null && !scope.allowedIds.includes(studioId)) {
    return res.status(400).json({ error: "That isn't a studio you can invite into." });
  }
  const [studio] = studioId
    ? await db.select().from(studios).where(eq(studios.id, studioId)).limit(1)
    : [null];

  const results: { email: string; status: string; detail?: string; link?: string }[] = [];

  for (const rawEmail of parsed.data.emails) {
    const email = rawEmail.trim().toLowerCase();

    if (!email.endsWith(`@${academy.emailDomain}`)) {
      results.push({
        email,
        status: "rejected",
        detail: `Not on @${academy.emailDomain}. Eagle Bot only invites people on the academy's domain.`,
      });
      continue;
    }

    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing) {
      results.push({ email, status: "skipped", detail: "Already has an account." });
      continue;
    }

    const token = randomBytes(24).toString("hex");
    const expiryDays = settings.notifications.inviteExpiryDays;
    const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

    const [invite] = await db
      .insert(invites)
      .values({
        academyId,
        email,
        name: parsed.data.name ?? null,
        role,
        studioId,
        token,
        invitedBy: req.user!.id,
        expiresAt,
      })
      .returning();

    const link = `${env.appUrl}/invite/${token}`;
    const mail = inviteEmail({
      academyName: academy.name,
      studioName: studio?.name ?? null,
      accent: academy.palette.accent,
      inviterName: req.user!.name,
      role,
      link,
      expiryDays,
    });
    const sent = await sendMail({ to: email, ...mail });

    if (!sent.sent) {
      await db.update(invites).set({ emailError: sent.error ?? null }).where(eq(invites.id, invite.id));
      // The invite is still valid - hand back the link so the admin can share it.
      results.push({ email, status: "link_only", detail: sent.error, link });
    } else {
      results.push({ email, status: "sent", link });
    }
  }

  const sentCount = results.filter((r) => r.status === "sent").length;
  await logActivity({
    academyId,
    studioId,
    actorUserId: req.user!.id,
    action: "invite.sent",
    summary: `${req.user!.name} invited ${results.length} ${role}${results.length === 1 ? "" : "s"} to ${
      studio?.name ?? "the academy"
    } (${sentCount} emailed).`,
    metadata: { results },
  });

  res.status(201).json({ results });
});

adminRouter.delete("/invites/:id", requirePermission("invites.send"), async (req, res) => {
  await db
    .delete(invites)
    .where(and(eq(invites.id, Number(req.params.id)), eq(invites.academyId, req.user!.academyId)));
  res.json({ ok: true });
});

/* -------------------------------- activity --------------------------------- */

adminRouter.get("/activity", requirePermission("activity.read"), async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 100), 300);
  const before = req.query.before ? Number(req.query.before) : null;
  const search = (req.query.q as string | undefined)?.trim();
  const actorType = req.query.actorType as string | undefined;
  const scope = requireScope(req);

  const conditions = [eq(activityLog.academyId, req.user!.academyId)];
  if (before) conditions.push(lt(activityLog.id, before));
  if (actorType && actorType !== "all") conditions.push(eq(activityLog.actorType, actorType));
  if (search) {
    conditions.push(
      or(ilike(activityLog.summary, `%${search}%`), ilike(activityLog.action, `%${search}%`))!,
    );
  }
  const studioCondition = studioFilter(activityLog.studioId, scope);
  if (studioCondition) conditions.push(studioCondition);

  const rows = await db
    .select({ entry: activityLog, actorName: users.name, studioName: studios.name })
    .from(activityLog)
    .leftJoin(users, eq(users.id, activityLog.actorUserId))
    .leftJoin(studios, eq(studios.id, activityLog.studioId))
    .where(and(...conditions))
    .orderBy(desc(activityLog.id))
    .limit(limit);

  res.json({
    entries: rows,
    nextCursor: rows.length === limit ? rows[rows.length - 1].entry.id : null,
  });
});

/* --------------------------------- statuses -------------------------------- */

adminRouter.get("/status", requirePermission("status.read"), async (req, res) => {
  const snapshot = await getStatusSnapshot(req.user!.academyId, requireScope(req));
  res.json({
    ...snapshot,
    config: {
      aiConfigured,
      emailConfigured,
      aiEnabled: req.settings!.ai.enabled,
      model: env.anthropicModel,
      effort: req.settings!.ai.effort,
      appUrl: env.appUrl,
    },
  });
});

adminRouter.get("/jobs/:id", requirePermission("status.read"), async (req, res) => {
  const [job] = await db
    .select()
    .from(aiJobs)
    .where(and(eq(aiJobs.id, Number(req.params.id)), eq(aiJobs.academyId, req.user!.academyId)))
    .limit(1);
  if (!job) return res.status(404).json({ error: "No such job." });
  if (!canReadStudio(requireScope(req), job.studioId)) {
    return res.status(404).json({ error: "No such job." });
  }
  res.json({ job });
});

/** Dismisses the "awaiting input" state once a human has dealt with it. */
adminRouter.post("/jobs/:id/acknowledge", requirePermission("status.read"), async (req, res) => {
  const [job] = await db
    .update(aiJobs)
    .set({ status: "succeeded", awaitingReason: null })
    .where(
      and(
        eq(aiJobs.id, Number(req.params.id)),
        eq(aiJobs.academyId, req.user!.academyId),
        eq(aiJobs.status, "awaiting_input"),
      ),
    )
    .returning();
  if (!job) return res.status(404).json({ error: "Nothing to acknowledge." });
  res.json({ job });
});

/* ------------------------------- dashboard --------------------------------- */

/**
 * Counts for the studio being viewed, plus a per-studio breakdown so an admin
 * can see at a glance which studio has fallen behind.
 */
adminRouter.get("/overview", requirePermission("status.read"), async (req, res) => {
  const academyId = req.user!.academyId;
  const scope = requireScope(req);
  const studioId = scope.studioId;
  const scopeSql = studioId === null ? sql`true` : sql`(studio_id = ${studioId} or studio_id is null)`;

  const counts = await db
    .select({
      people: sql<number>`(select count(*)::int from users where academy_id = ${academyId} and active = true and ${
        studioId === null ? sql`true` : sql`studio_id = ${studioId}`
      })`,
      rules: sql<number>`(select count(*)::int from wiki_rules r join wiki_sections s on s.id = r.section_id
        where r.academy_id = ${academyId} and r.status = 'active' and ${
          studioId === null ? sql`true` : sql`(s.studio_id = ${studioId} or s.studio_id is null)`
        })`,
      openFindings: sql<number>`(select count(*)::int from ai_findings where academy_id = ${academyId} and status = 'open' and ${scopeSql})`,
      meetings: sql<number>`(select count(*)::int from meetings where academy_id = ${academyId} and ${scopeSql})`,
      openElections: sql<number>`(select count(*)::int from elections where academy_id = ${academyId} and status = 'open' and ${scopeSql})`,
      pendingInvites: sql<number>`(select count(*)::int from invites where academy_id = ${academyId} and accepted_at is null and ${scopeSql})`,
    })
    .from(academies)
    .where(eq(academies.id, academyId))
    .limit(1);

  const perStudio = await db
    .select({
      id: studios.id,
      name: studios.name,
      color: studios.color,
      members: sql<number>`(select count(*)::int from users where studio_id = ${studios.id} and active = true)`,
      rules: sql<number>`(select count(*)::int from wiki_rules r join wiki_sections s on s.id = r.section_id where s.studio_id = ${studios.id} and r.status = 'active')`,
      openFindings: sql<number>`(select count(*)::int from ai_findings where studio_id = ${studios.id} and status = 'open')`,
      openElections: sql<number>`(select count(*)::int from elections where studio_id = ${studios.id} and status = 'open')`,
      lastMeeting: sql<string | null>`(select max(meeting_date)::text from meetings where studio_id = ${studios.id})`,
    })
    .from(studios)
    .where(and(eq(studios.academyId, academyId), eq(studios.archived, false)))
    .orderBy(asc(studios.orderIndex));

  res.json({
    counts: counts[0] ?? {},
    studios: perStudio.filter((row) => scope.canSeeAll || scope.allowedIds.includes(row.id)),
    scopedTo: scope.studio ? scope.studio.name : null,
  });
});
