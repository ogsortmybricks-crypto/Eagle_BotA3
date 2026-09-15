import { Router } from "express";
import { z } from "zod";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { elections, positionHolders, positions, studios, users } from "@shared/schema";
import { requirePermission } from "../auth";
import { logActivity } from "../activity";
import {
  canReadShared,
  canReadStudio,
  requireScope,
  scopedShared,
  StudioChoiceError,
  writeStudioId,
} from "../studio";

export const positionsRouter = Router();

positionsRouter.get("/", requirePermission("positions.read"), async (req, res) => {
  const academyId = req.user!.academyId;
  const scope = requireScope(req);
  const includeArchived = req.query.includeArchived === "true";

  const base = includeArchived
    ? eq(positions.academyId, academyId)
    : and(eq(positions.academyId, academyId), eq(positions.archived, false));

  const rows = await db
    .select()
    .from(positions)
    .where(scopedShared(base, positions.studioId, positions.sharedStudioIds, scope))
    .orderBy(asc(positions.title));

  const holders = await db
    .select({
      holder: positionHolders,
      userName: users.name,
      userAvatar: users.avatarUrl,
      userStudioId: users.studioId,
    })
    .from(positionHolders)
    .innerJoin(users, eq(users.id, positionHolders.userId))
    .where(eq(positionHolders.academyId, academyId))
    .orderBy(desc(positionHolders.startedAt));

  const openElections = await db
    .select({
      id: elections.id,
      positionId: elections.positionId,
      status: elections.status,
      title: elections.title,
    })
    .from(elections)
    .where(eq(elections.academyId, academyId));

  const studioRows = await db.select().from(studios).where(eq(studios.academyId, academyId));
  const studioById = new Map(studioRows.map((studio) => [studio.id, studio]));

  res.json({
    positions: rows.map((position) => ({
      ...position,
      studioName: position.studioId ? (studioById.get(position.studioId)?.name ?? null) : null,
      studioColor: position.studioId ? (studioById.get(position.studioId)?.color ?? null) : null,
      shared: position.studioId === null,
      sharedWith: (position.sharedStudioIds ?? [])
        .map((id) => studioById.get(id)?.name)
        .filter((name): name is string => Boolean(name)),
      current: holders
        .filter((h) => h.holder.positionId === position.id && h.holder.endedAt === null)
        .map((h) => ({
          ...h.holder,
          name: h.userName,
          avatarUrl: h.userAvatar,
          studioId: h.userStudioId,
        })),
      past: holders
        .filter((h) => h.holder.positionId === position.id && h.holder.endedAt !== null)
        .map((h) => ({ ...h.holder, name: h.userName })),
      activeElection:
        openElections.find(
          (e) => e.positionId === position.id && (e.status === "draft" || e.status === "open"),
        ) ?? null,
    })),
  });
});

const positionSchema = z.object({
  title: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
  responsibilities: z.array(z.string().max(300)).max(20).default([]),
  seats: z.number().int().min(1).max(20).default(1),
  termLength: z.string().max(80).optional(),
  elected: z.boolean().default(true),
  /** Omit for the studio being viewed; null makes it an academy-wide role. */
  studioId: z.number().int().nullable().optional(),
  /** Other studios that share this role - a joint committee across two studios. */
  sharedStudioIds: z.array(z.number().int()).max(20).optional(),
});

positionsRouter.post("/", requirePermission("positions.manage"), async (req, res) => {
  const parsed = positionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the form." });
  }

  const scope = requireScope(req);
  let studioId: number | null;
  try {
    studioId = writeStudioId(scope, parsed.data.studioId);
  } catch (error) {
    if (error instanceof StudioChoiceError) {
      return res.status(400).json({ error: error.message, needsStudio: true });
    }
    throw error;
  }

  const [position] = await db
    .insert(positions)
    .values({
      academyId: req.user!.academyId,
      studioId,
      title: parsed.data.title.trim(),
      description: parsed.data.description ?? null,
      responsibilities: parsed.data.responsibilities,
      seats: parsed.data.seats,
      termLength: parsed.data.termLength ?? null,
      elected: parsed.data.elected,
      sharedStudioIds: (parsed.data.sharedStudioIds ?? []).filter((sid) => sid !== studioId),
      sourceType: "manual",
    })
    .returning();

  await logActivity({
    academyId: req.user!.academyId,
    studioId,
    actorUserId: req.user!.id,
    action: "position.created",
    entityType: "position",
    entityId: position.id,
    summary: `${req.user!.name} added the position "${position.title}".`,
  });

  res.status(201).json({ position });
});

positionsRouter.patch("/:id", requirePermission("positions.manage"), async (req, res) => {
  const parsed = positionSchema
    .partial()
    .extend({ archived: z.boolean().optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Couldn't save that." });

  const scope = requireScope(req);
  const [before] = await db
    .select()
    .from(positions)
    .where(and(eq(positions.id, Number(req.params.id)), eq(positions.academyId, req.user!.academyId)))
    .limit(1);
  if (!before || !canReadShared(scope, before.studioId, before.sharedStudioIds)) {
    return res.status(404).json({ error: "That position doesn't exist." });
  }

  const { studioId, sharedStudioIds, ...rest } = parsed.data;
  const patch: Record<string, unknown> = { ...rest, updatedAt: new Date() };
  if (sharedStudioIds !== undefined) {
    if (!scope.canWriteShared) {
      return res.status(403).json({ error: "Only an admin can share a position between studios." });
    }
    const owner = studioId !== undefined ? studioId : before.studioId;
    patch.sharedStudioIds = [...new Set(sharedStudioIds)].filter(
      (sid) => sid !== owner && scope.allowedIds.includes(sid),
    );
  }
  if (studioId !== undefined) {
    if (studioId !== null && !scope.allowedIds.includes(studioId)) {
      return res.status(403).json({ error: "That isn't a studio you can move this into." });
    }
    if (studioId === null && !scope.canWriteShared) {
      return res.status(403).json({ error: "Only an admin can make a position academy-wide." });
    }
    patch.studioId = studioId;
  }

  const [position] = await db
    .update(positions)
    .set(patch)
    .where(eq(positions.id, before.id))
    .returning();

  await logActivity({
    academyId: req.user!.academyId,
    studioId: position.studioId,
    actorUserId: req.user!.id,
    action: "position.updated",
    entityType: "position",
    entityId: position.id,
    summary: `${req.user!.name} updated "${position.title}".`,
  });

  res.json({ position });
});

positionsRouter.delete("/:id", requirePermission("positions.manage"), async (req, res) => {
  const scope = requireScope(req);
  const [before] = await db
    .select()
    .from(positions)
    .where(and(eq(positions.id, Number(req.params.id)), eq(positions.academyId, req.user!.academyId)))
    .limit(1);
  if (!before || !canReadStudio(scope, before.studioId)) {
    return res.status(404).json({ error: "That position doesn't exist." });
  }

  // Archive rather than delete - the history of who held what is the point.
  const [position] = await db
    .update(positions)
    .set({ archived: true, updatedAt: new Date() })
    .where(eq(positions.id, before.id))
    .returning();

  await logActivity({
    academyId: req.user!.academyId,
    studioId: position.studioId,
    actorUserId: req.user!.id,
    action: "position.archived",
    entityType: "position",
    entityId: position.id,
    summary: `${req.user!.name} archived "${position.title}".`,
  });

  res.json({ ok: true });
});

/** Appoint someone directly - for positions the studio doesn't elect. */
positionsRouter.post("/:id/holders", requirePermission("positions.manage"), async (req, res) => {
  const parsed = z
    .object({ userId: z.number().int(), note: z.string().max(300).optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Pick a person." });

  const positionId = Number(req.params.id);
  const academyId = req.user!.academyId;
  const scope = requireScope(req);

  const [position] = await db
    .select()
    .from(positions)
    .where(and(eq(positions.id, positionId), eq(positions.academyId, academyId)))
    .limit(1);
  if (!position || !canReadShared(scope, position.studioId, position.sharedStudioIds)) {
    return res.status(404).json({ error: "That position doesn't exist." });
  }

  const current = await db
    .select()
    .from(positionHolders)
    .where(and(eq(positionHolders.positionId, positionId), isNull(positionHolders.endedAt)));
  if (current.length >= position.seats) {
    return res.status(409).json({
      error: `"${position.title}" only has ${position.seats} seat${position.seats === 1 ? "" : "s"}, and they're full. End a term first.`,
    });
  }

  const [person] = await db.select().from(users).where(eq(users.id, parsed.data.userId)).limit(1);
  if (!person || person.academyId !== academyId) {
    return res.status(400).json({ error: "That person isn't in this academy." });
  }

  const studioRows = await db.select().from(studios).where(eq(studios.academyId, academyId));

  // A Middle Studio seat held by someone in Launchpad is almost always a
  // mistake, and it is the kind that quietly breaks a studio's trust in the tool.
  const eligibleStudios = [position.studioId, ...(position.sharedStudioIds ?? [])];
  if (
    req.settings!.governance.restrictCandidatesToStudio &&
    position.studioId !== null &&
    !eligibleStudios.includes(person.studioId)
  ) {
    const names = studioRows
      .filter((studio) => eligibleStudios.includes(studio.id))
      .map((studio) => studio.name);
    return res.status(400).json({
      error: `"${position.title}" belongs to ${names.join(" and ") || "another studio"}, and ${person.name} isn't in ${names.length > 1 ? "either" : "it"}. Move them there first, or turn off the studio restriction in Settings.`,
    });
  }

  const [holder] = await db
    .insert(positionHolders)
    .values({
      academyId,
      positionId,
      userId: parsed.data.userId,
      note: parsed.data.note ?? `Appointed by ${req.user!.name}.`,
    })
    .returning();

  await logActivity({
    academyId,
    studioId: position.studioId,
    actorUserId: req.user!.id,
    action: "position.appointed",
    entityType: "position",
    entityId: positionId,
    summary: `${person.name} now holds "${position.title}".`,
  });

  res.status(201).json({ holder });
});

positionsRouter.post("/holders/:holderId/end", requirePermission("positions.manage"), async (req, res) => {
  const [holder] = await db
    .update(positionHolders)
    .set({ endedAt: new Date(), note: (req.body?.note as string) ?? `Ended by ${req.user!.name}.` })
    .where(
      and(
        eq(positionHolders.id, Number(req.params.holderId)),
        eq(positionHolders.academyId, req.user!.academyId),
      ),
    )
    .returning();
  if (!holder) return res.status(404).json({ error: "Not found." });

  await logActivity({
    academyId: req.user!.academyId,
    studioId: requireScope(req).studioId,
    actorUserId: req.user!.id,
    action: "position.term_ended",
    entityType: "position",
    entityId: holder.positionId,
    summary: `${req.user!.name} ended a term.`,
  });

  res.json({ ok: true });
});
