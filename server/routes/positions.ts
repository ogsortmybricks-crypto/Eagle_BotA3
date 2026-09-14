import { Router } from "express";
import { z } from "zod";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { elections, positionHolders, positions, users } from "@shared/schema";
import { requirePermission } from "../auth";
import { logActivity } from "../activity";

export const positionsRouter = Router();

positionsRouter.get("/", requirePermission("positions.read"), async (req, res) => {
  const academyId = req.user!.academyId;
  const includeArchived = req.query.includeArchived === "true";

  const rows = await db
    .select()
    .from(positions)
    .where(
      includeArchived
        ? eq(positions.academyId, academyId)
        : and(eq(positions.academyId, academyId), eq(positions.archived, false)),
    )
    .orderBy(asc(positions.title));

  const holders = await db
    .select({
      holder: positionHolders,
      userName: users.name,
      userAvatar: users.avatarUrl,
      userStudio: users.studio,
    })
    .from(positionHolders)
    .innerJoin(users, eq(users.id, positionHolders.userId))
    .where(eq(positionHolders.academyId, academyId))
    .orderBy(desc(positionHolders.startedAt));

  const openElections = await db
    .select({ id: elections.id, positionId: elections.positionId, status: elections.status, title: elections.title })
    .from(elections)
    .where(eq(elections.academyId, academyId));

  res.json({
    positions: rows.map((position) => ({
      ...position,
      current: holders
        .filter((h) => h.holder.positionId === position.id && h.holder.endedAt === null)
        .map((h) => ({ ...h.holder, name: h.userName, avatarUrl: h.userAvatar, studio: h.userStudio })),
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
});

positionsRouter.post("/", requirePermission("positions.manage"), async (req, res) => {
  const parsed = positionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the form." });
  }

  const [position] = await db
    .insert(positions)
    .values({
      academyId: req.user!.academyId,
      title: parsed.data.title.trim(),
      description: parsed.data.description ?? null,
      responsibilities: parsed.data.responsibilities,
      seats: parsed.data.seats,
      termLength: parsed.data.termLength ?? null,
      elected: parsed.data.elected,
      sourceType: "manual",
    })
    .returning();

  await logActivity({
    academyId: req.user!.academyId,
    actorUserId: req.user!.id,
    action: "position.created",
    entityType: "position",
    entityId: position.id,
    summary: `${req.user!.name} added the position "${position.title}".`,
  });

  res.status(201).json({ position });
});

positionsRouter.patch("/:id", requirePermission("positions.manage"), async (req, res) => {
  const parsed = positionSchema.partial().extend({ archived: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Couldn't save that." });

  const [position] = await db
    .update(positions)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(positions.id, Number(req.params.id)), eq(positions.academyId, req.user!.academyId)))
    .returning();

  if (!position) return res.status(404).json({ error: "That position doesn't exist." });

  await logActivity({
    academyId: req.user!.academyId,
    actorUserId: req.user!.id,
    action: "position.updated",
    entityType: "position",
    entityId: position.id,
    summary: `${req.user!.name} updated "${position.title}".`,
  });

  res.json({ position });
});

positionsRouter.delete("/:id", requirePermission("positions.manage"), async (req, res) => {
  // Archive rather than delete - the history of who held what is the point.
  const [position] = await db
    .update(positions)
    .set({ archived: true, updatedAt: new Date() })
    .where(and(eq(positions.id, Number(req.params.id)), eq(positions.academyId, req.user!.academyId)))
    .returning();
  if (!position) return res.status(404).json({ error: "That position doesn't exist." });

  await logActivity({
    academyId: req.user!.academyId,
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

  const [position] = await db
    .select()
    .from(positions)
    .where(and(eq(positions.id, positionId), eq(positions.academyId, academyId)))
    .limit(1);
  if (!position) return res.status(404).json({ error: "That position doesn't exist." });

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
    actorUserId: req.user!.id,
    action: "position.term_ended",
    entityType: "position",
    entityId: holder.positionId,
    summary: `${req.user!.name} ended a term.`,
  });

  res.json({ ok: true });
});
