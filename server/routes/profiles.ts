import { Router } from "express";
import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { positionHolders, positions, users, STUDIOS } from "@shared/schema";
import { publicUser, requireAuth } from "../auth";
import { logActivity } from "../activity";

export const profilesRouter = Router();

/** The studio directory. Everyone can see who's who. */
profilesRouter.get("/", requireAuth, async (req, res) => {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      studio: users.studio,
      avatarUrl: users.avatarUrl,
      bio: users.bio,
      nga: users.nga,
    })
    .from(users)
    .where(and(eq(users.academyId, req.user!.academyId), eq(users.active, true)))
    .orderBy(asc(users.name));

  const held = await db
    .select({ userId: positionHolders.userId, title: positions.title, endedAt: positionHolders.endedAt })
    .from(positionHolders)
    .innerJoin(positions, eq(positions.id, positionHolders.positionId))
    .where(eq(positionHolders.academyId, req.user!.academyId));

  res.json({
    people: rows.map((person) => ({
      ...person,
      currentPositions: held.filter((h) => h.userId === person.id && !h.endedAt).map((h) => h.title),
    })),
  });
});

profilesRouter.get("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const [person] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.academyId, req.user!.academyId)))
    .limit(1);
  if (!person) return res.status(404).json({ error: "No such person." });

  const history = await db
    .select({
      holder: positionHolders,
      title: positions.title,
      description: positions.description,
    })
    .from(positionHolders)
    .innerJoin(positions, eq(positions.id, positionHolders.positionId))
    .where(eq(positionHolders.userId, id))
    .orderBy(desc(positionHolders.startedAt));

  res.json({
    person: publicUser(person),
    positions: history,
    isSelf: person.id === req.user!.id,
    canEdit: person.id === req.user!.id || req.user!.role === "admin",
  });
});

profilesRouter.patch("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const isSelf = id === req.user!.id;
  if (!isSelf && req.user!.role !== "admin") {
    return res.status(403).json({ error: "You can only edit your own profile." });
  }

  const parsed = z
    .object({
      name: z.string().min(2).max(120).optional(),
      bio: z.string().max(2000).nullable().optional(),
      nga: z.string().max(300).nullable().optional(),
      studio: z.enum(STUDIOS).nullable().optional(),
      // Stored as a data URL. Small images only - see the note in README.
      avatarUrl: z.string().max(1_500_000).nullable().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Couldn't save that." });
  }

  const [person] = await db
    .update(users)
    .set(parsed.data)
    .where(and(eq(users.id, id), eq(users.academyId, req.user!.academyId)))
    .returning();
  if (!person) return res.status(404).json({ error: "No such person." });

  await logActivity({
    academyId: req.user!.academyId,
    actorUserId: req.user!.id,
    action: "profile.updated",
    entityType: "user",
    entityId: person.id,
    summary: isSelf
      ? `${person.name} updated their profile.`
      : `${req.user!.name} updated ${person.name}'s profile.`,
  });

  res.json({ person: publicUser(person) });
});
