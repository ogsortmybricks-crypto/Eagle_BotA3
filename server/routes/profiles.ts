import { Router } from "express";
import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { positionHolders, positions, studios, users } from "@shared/schema";
import { publicUser, requireAuth } from "../auth";
import { logActivity } from "../activity";
import { canReadStudio, requireScope } from "../studio";

export const profilesRouter = Router();

/**
 * The directory, grouped by studio.
 *
 * Everyone in the academy is listed - knowing who else exists is not a
 * governance question - but the client groups by studio so the Middle Studio
 * roster is what a Middle Studio learner actually reads.
 */
profilesRouter.get("/", requireAuth, async (req, res) => {
  const academyId = req.user!.academyId;
  const settings = req.settings!;
  const scope = requireScope(req);
  const onlyMyStudios = req.query.scope === "studio";

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      studioId: users.studioId,
      avatarUrl: users.avatarUrl,
      bio: users.bio,
      nga: users.nga,
    })
    .from(users)
    .where(and(eq(users.academyId, academyId), eq(users.active, true)))
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

  const studioRows = await db
    .select()
    .from(studios)
    .where(eq(studios.academyId, academyId))
    .orderBy(asc(studios.orderIndex), asc(studios.id));

  const visible = onlyMyStudios
    ? rows.filter((person) => canReadStudio(scope, person.studioId))
    : rows;

  res.json({
    people: visible.map((person) => ({
      ...person,
      // An academy running a Spark studio usually does not want addresses on screen.
      email: settings.access.showEmailsInDirectory ? person.email : null,
      currentPositions: held.filter((h) => h.userId === person.id && !h.endedAt).map((h) => h.title),
    })),
    studios: studioRows,
  });
});

profilesRouter.get("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const settings = req.settings!;
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
      studioId: positions.studioId,
    })
    .from(positionHolders)
    .innerJoin(positions, eq(positions.id, positionHolders.positionId))
    .where(eq(positionHolders.userId, id))
    .orderBy(desc(positionHolders.startedAt));

  const [studio] = person.studioId
    ? await db.select().from(studios).where(eq(studios.id, person.studioId)).limit(1)
    : [null];

  const isSelf = person.id === req.user!.id;
  const isAdmin = req.user!.role === "admin";
  const shown = publicUser(person);

  res.json({
    person: {
      ...shown,
      email: settings.access.showEmailsInDirectory || isSelf || isAdmin ? shown.email : null,
    },
    studio: studio ? { id: studio.id, name: studio.name, color: studio.color } : null,
    positions: history,
    isSelf,
    canEdit: isAdmin || (isSelf && settings.access.allowProfileEditing),
  });
});

profilesRouter.patch("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const isSelf = id === req.user!.id;
  const isAdmin = req.user!.role === "admin";
  const settings = req.settings!;

  if (!isSelf && !isAdmin) {
    return res.status(403).json({ error: "You can only edit your own profile." });
  }
  if (isSelf && !isAdmin && !settings.access.allowProfileEditing) {
    return res.status(403).json({
      error: "Profile editing is turned off in this academy. Ask an admin to make the change.",
    });
  }

  const parsed = z
    .object({
      name: z.string().min(2).max(120).optional(),
      bio: z.string().max(2000).nullable().optional(),
      nga: z.string().max(300).nullable().optional(),
      /** Only an admin moves someone between studios. */
      studioId: z.number().int().nullable().optional(),
      // Stored as a data URL. Small images only - see the note in README.
      avatarUrl: z.string().max(1_500_000).nullable().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Couldn't save that." });
  }

  const { studioId, ...rest } = parsed.data;
  const patch: Record<string, unknown> = { ...rest };

  if (studioId !== undefined) {
    if (!isAdmin) {
      return res.status(403).json({
        error: "Only an admin moves someone between studios - it changes what they can vote on.",
      });
    }
    if (studioId !== null) {
      const [studio] = await db
        .select()
        .from(studios)
        .where(and(eq(studios.id, studioId), eq(studios.academyId, req.user!.academyId)))
        .limit(1);
      if (!studio) return res.status(400).json({ error: "That studio doesn't exist." });
    }
    patch.studioId = studioId;
  }

  const [person] = await db
    .update(users)
    .set(patch)
    .where(and(eq(users.id, id), eq(users.academyId, req.user!.academyId)))
    .returning();
  if (!person) return res.status(404).json({ error: "No such person." });

  await logActivity({
    academyId: req.user!.academyId,
    studioId: person.studioId,
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
