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
  users,
  ROLES,
  STUDIOS,
} from "@shared/schema";
import { publicUser, requirePermission } from "../auth";
import { logActivity } from "../activity";
import { inviteEmail, sendMail } from "../mailer";
import { aiConfigured, emailConfigured, env } from "../env";
import { getStatusSnapshot } from "../ai/jobs";

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

  const [academy] = await db
    .update(academies)
    .set(parsed.data)
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
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.academyId, req.user!.academyId))
    .orderBy(asc(users.name));

  const held = await db
    .select({
      userId: positionHolders.userId,
      title: positions.title,
      endedAt: positionHolders.endedAt,
    })
    .from(positionHolders)
    .innerJoin(positions, eq(positions.id, positionHolders.positionId))
    .where(eq(positionHolders.academyId, req.user!.academyId));

  res.json({
    users: rows.map((user) => ({
      ...publicUser(user),
      positions: held.filter((h) => h.userId === user.id && h.endedAt === null).map((h) => h.title),
    })),
  });
});

adminRouter.patch("/users/:id", requirePermission("users.manage"), async (req, res) => {
  const parsed = z
    .object({
      role: z.enum(ROLES).optional(),
      studio: z.enum(STUDIOS).nullable().optional(),
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

  const [user] = await db
    .update(users)
    .set(parsed.data)
    .where(and(eq(users.id, targetId), eq(users.academyId, req.user!.academyId)))
    .returning();

  if (!user) return res.status(404).json({ error: "That person isn't in this academy." });

  await logActivity({
    academyId: req.user!.academyId,
    actorUserId: req.user!.id,
    action: "user.updated",
    entityType: "user",
    entityId: user.id,
    summary: `${req.user!.name} updated ${user.name}${parsed.data.role ? ` (now ${parsed.data.role})` : ""}.`,
    metadata: parsed.data,
  });

  res.json({ user: publicUser(user) });
});

/* --------------------------------- invites --------------------------------- */

adminRouter.get("/invites", requirePermission("invites.send"), async (req, res) => {
  const rows = await db
    .select()
    .from(invites)
    .where(eq(invites.academyId, req.user!.academyId))
    .orderBy(desc(invites.id));
  res.json({
    invites: rows.map((invite) => ({
      ...invite,
      link: `${env.appUrl}/invite/${invite.token}`,
      expired: invite.expiresAt < new Date(),
    })),
    emailConfigured,
  });
});

adminRouter.post("/invites", requirePermission("invites.send"), async (req, res) => {
  const parsed = z
    .object({
      emails: z.array(z.string().email()).min(1).max(60),
      role: z.enum(ROLES).default("learner"),
      studio: z.enum(STUDIOS).nullable().optional(),
      name: z.string().max(120).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Enter at least one valid email address." });
  }

  const academyId = req.user!.academyId;
  const [academy] = await db.select().from(academies).where(eq(academies.id, academyId)).limit(1);
  if (!academy) return res.status(404).json({ error: "Academy not found." });

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
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    const [invite] = await db
      .insert(invites)
      .values({
        academyId,
        email,
        name: parsed.data.name ?? null,
        role: parsed.data.role,
        studio: parsed.data.studio ?? null,
        token,
        invitedBy: req.user!.id,
        expiresAt,
      })
      .returning();

    const link = `${env.appUrl}/invite/${token}`;
    const mail = inviteEmail({
      academyName: academy.name,
      accent: academy.palette.accent,
      inviterName: req.user!.name,
      role: parsed.data.role,
      link,
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
    actorUserId: req.user!.id,
    action: "invite.sent",
    summary: `${req.user!.name} invited ${results.length} ${parsed.data.role}${results.length === 1 ? "" : "s"} (${sentCount} emailed).`,
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

  const conditions = [eq(activityLog.academyId, req.user!.academyId)];
  if (before) conditions.push(lt(activityLog.id, before));
  if (actorType && actorType !== "all") conditions.push(eq(activityLog.actorType, actorType));
  if (search) {
    conditions.push(
      or(ilike(activityLog.summary, `%${search}%`), ilike(activityLog.action, `%${search}%`))!,
    );
  }

  const rows = await db
    .select({ entry: activityLog, actorName: users.name })
    .from(activityLog)
    .leftJoin(users, eq(users.id, activityLog.actorUserId))
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
  const snapshot = await getStatusSnapshot(req.user!.academyId);
  res.json({
    ...snapshot,
    config: {
      aiConfigured,
      emailConfigured,
      model: env.anthropicModel,
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

adminRouter.get("/overview", requirePermission("status.read"), async (req, res) => {
  const academyId = req.user!.academyId;
  const counts = await db
    .select({
      people: sql<number>`(select count(*)::int from users where academy_id = ${academyId} and active = true)`,
      rules: sql<number>`(select count(*)::int from wiki_rules where academy_id = ${academyId} and status = 'active')`,
      openFindings: sql<number>`(select count(*)::int from ai_findings where academy_id = ${academyId} and status = 'open')`,
      meetings: sql<number>`(select count(*)::int from meetings where academy_id = ${academyId})`,
      openElections: sql<number>`(select count(*)::int from elections where academy_id = ${academyId} and status = 'open')`,
      pendingInvites: sql<number>`(select count(*)::int from invites where academy_id = ${academyId} and accepted_at is null)`,
    })
    .from(academies)
    .where(eq(academies.id, academyId))
    .limit(1);

  res.json({ counts: counts[0] ?? {} });
});
