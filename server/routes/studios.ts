import { Router } from "express";
import { z } from "zod";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  elections,
  meetings,
  positions,
  studioGroups,
  studioGuides,
  studios,
  taconInstalls,
  tacons,
  users,
  wikiRules,
  wikiSections,
} from "@shared/schema";
import { requireAuth, requirePermission } from "../auth";
import { logActivity } from "../activity";
import { listStudios, requireScope, uniqueStudioSlug, type StudioScope } from "../studio";
import { resolveOverrides, studioOverridesSchema } from "@shared/settings";

export const studiosRouter = Router();

/**
 * The studio list, with a count of what lives in each one.
 *
 * Everyone can read this - the switcher needs it - but the response only
 * contains the studios the caller is allowed into.
 */
studiosRouter.get("/", requireAuth, async (req, res) => {
  const scope = requireScope(req);
  const academyId = req.user!.academyId;

  const counts = await db
    .select({
      studioId: wikiSections.studioId,
      rules: sql<number>`count(${wikiRules.id})::int`,
    })
    .from(wikiSections)
    .leftJoin(
      wikiRules,
      and(eq(wikiRules.sectionId, wikiSections.id), eq(wikiRules.status, "active")),
    )
    .where(eq(wikiSections.academyId, academyId))
    .groupBy(wikiSections.studioId);

  const members = await db
    .select({ studioId: users.studioId, count: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.academyId, academyId), eq(users.active, true)))
    .groupBy(users.studioId);

  const positionCounts = await db
    .select({ studioId: positions.studioId, count: sql<number>`count(*)::int` })
    .from(positions)
    .where(and(eq(positions.academyId, academyId), eq(positions.archived, false)))
    .groupBy(positions.studioId);

  const meetingCounts = await db
    .select({ studioId: meetings.studioId, count: sql<number>`count(*)::int` })
    .from(meetings)
    .where(eq(meetings.academyId, academyId))
    .groupBy(meetings.studioId);

  const lookup = (rows: { studioId: number | null; count?: number; rules?: number }[], id: number | null) =>
    rows.find((row) => row.studioId === id);

  res.json({
    studios: scope.allowed.map((studio) => ({
      ...studio,
      overrides: resolveOverrides(studio.settings),
      counts: {
        rules: lookup(counts.map((c) => ({ studioId: c.studioId, count: c.rules })), studio.id)?.count ?? 0,
        members: lookup(members, studio.id)?.count ?? 0,
        positions: lookup(positionCounts, studio.id)?.count ?? 0,
        meetings: lookup(meetingCounts, studio.id)?.count ?? 0,
      },
    })),
    shared: {
      rules: lookup(counts.map((c) => ({ studioId: c.studioId, count: c.rules })), null)?.count ?? 0,
      members: lookup(members, null)?.count ?? 0,
      positions: lookup(positionCounts, null)?.count ?? 0,
      meetings: lookup(meetingCounts, null)?.count ?? 0,
    },
    selectedStudioId: scope.studioId,
    canSeeAll: scope.canSeeAll,
    groups: await groupsFor(academyId, scope),
    guides: await guidesFor(academyId),
  });
});

/* -------------------------------------------------------------------------- */
/*  Guide assignments                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Who guides which studio or group. Everyone can read it - knowing who your
 * studio's guides are is not a secret - and an admin edits it.
 */
export async function guidesFor(academyId: number) {
  return db
    .select({
      id: studioGuides.id,
      userId: studioGuides.userId,
      studioId: studioGuides.studioId,
      groupId: studioGuides.groupId,
      name: users.name,
      avatarUrl: users.avatarUrl,
    })
    .from(studioGuides)
    .innerJoin(users, eq(users.id, studioGuides.userId))
    .where(and(eq(studioGuides.academyId, academyId), eq(users.active, true)))
    .orderBy(users.name);
}

const assignSchema = z
  .object({
    userId: z.number().int(),
    studioId: z.number().int().nullable().optional(),
    groupId: z.number().int().nullable().optional(),
  })
  .refine((body) => (body.studioId != null) !== (body.groupId != null), {
    message: "Pick a studio or a group to guide.",
  });

studiosRouter.post("/guides", requirePermission("guides.assign"), async (req, res) => {
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the form." });
  }
  const academyId = req.user!.academyId;
  const { userId } = parsed.data;
  const studioId = parsed.data.studioId ?? null;
  const groupId = parsed.data.groupId ?? null;

  const [person] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.academyId, academyId), eq(users.active, true)))
    .limit(1);
  if (!person) return res.status(404).json({ error: "That person isn't in this academy." });
  // Admins guide too at plenty of small Actons; a learner never does.
  if (person.role !== "guide" && person.role !== "admin") {
    return res.status(400).json({ error: `${person.name} is a ${person.role}. Only guides and admins can be assigned.` });
  }

  let label: string;
  if (studioId !== null) {
    const [studio] = await db
      .select()
      .from(studios)
      .where(and(eq(studios.id, studioId), eq(studios.academyId, academyId)))
      .limit(1);
    if (!studio || studio.archived) return res.status(404).json({ error: "That studio doesn't exist." });
    label = studio.name;
  } else {
    const [group] = await db
      .select()
      .from(studioGroups)
      .where(and(eq(studioGroups.id, groupId!), eq(studioGroups.academyId, academyId)))
      .limit(1);
    if (!group) return res.status(404).json({ error: "That group doesn't exist." });
    label = `the "${group.name}" group`;
  }

  const [existing] = await db
    .select()
    .from(studioGuides)
    .where(
      and(
        eq(studioGuides.userId, userId),
        studioId !== null ? eq(studioGuides.studioId, studioId) : eq(studioGuides.groupId, groupId!),
      ),
    )
    .limit(1);
  if (existing) return res.json({ assignment: existing });

  const [assignment] = await db
    .insert(studioGuides)
    .values({ academyId, userId, studioId, groupId, assignedBy: req.user!.id })
    .returning();

  await logActivity({
    academyId,
    studioId,
    actorUserId: req.user!.id,
    action: "studio.guide.assigned",
    entityType: "user",
    entityId: userId,
    summary: `${req.user!.name} made ${person.name} a guide of ${label}.`,
    metadata: { studioId, groupId },
  });

  res.status(201).json({ assignment });
});

studiosRouter.delete("/guides/:id", requirePermission("guides.assign"), async (req, res) => {
  const academyId = req.user!.academyId;
  const [removed] = await db
    .delete(studioGuides)
    .where(and(eq(studioGuides.id, Number(req.params.id)), eq(studioGuides.academyId, academyId)))
    .returning();
  if (!removed) return res.status(404).json({ error: "That assignment doesn't exist." });

  const [person] = await db.select({ name: users.name }).from(users).where(eq(users.id, removed.userId));
  await logActivity({
    academyId,
    studioId: removed.studioId,
    actorUserId: req.user!.id,
    action: "studio.guide.unassigned",
    entityType: "user",
    entityId: removed.userId,
    summary: `${req.user!.name} took ${person?.name ?? "a guide"} off ${
      removed.studioId !== null ? await studioNames([removed.studioId]) : "a studio group"
    }.`,
  });
  res.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/*  Studio groups                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The academy's groups, minus any the caller couldn't manage anyway. A group
 * is listed only if every studio in it is one the caller can open, so a guide
 * who can't see Spark never sees, or edits, a group Spark is in.
 */
async function groupsFor(academyId: number, scope: StudioScope) {
  const groups = await db
    .select()
    .from(studioGroups)
    .where(eq(studioGroups.academyId, academyId))
    .orderBy(studioGroups.id);
  const members = await listStudios(academyId, true);

  return groups
    .map((group) => ({
      ...group,
      studioIds: members
        .filter((studio) => studio.groupId === group.id && !studio.archived)
        .map((studio) => studio.id),
    }))
    .filter((group) => group.studioIds.every((id) => scope.allowedIds.includes(id)));
}

/**
 * Things worth saying before two studios start sharing everything: the
 * positions and Tac-Ons that will now appear twice side by side.
 */
async function groupWarnings(academyId: number, studioIds: number[]): Promise<string[]> {
  if (studioIds.length < 2) return [];
  const warnings: string[] = [];

  const titles = await db
    .select({ title: positions.title, studioId: positions.studioId })
    .from(positions)
    .where(
      and(
        eq(positions.academyId, academyId),
        eq(positions.archived, false),
        inArray(positions.studioId, studioIds),
      ),
    );
  const byTitle = new Map<string, Set<number>>();
  for (const row of titles) {
    const key = row.title.trim().toLowerCase();
    if (!byTitle.has(key)) byTitle.set(key, new Set());
    byTitle.get(key)!.add(row.studioId!);
  }
  const doubled = titles
    .filter((row) => (byTitle.get(row.title.trim().toLowerCase())?.size ?? 0) > 1)
    .map((row) => row.title);
  const doubledTitles = [...new Set(doubled)];
  if (doubledTitles.length > 0) {
    warnings.push(
      `More than one studio has ${listWords(doubledTitles.map((title) => `"${title}"`))}. Both will now show on the Positions page - archive the one you don't need.`,
    );
  }

  const installs = await db
    .select({ name: tacons.name, taconId: taconInstalls.taconId, studioId: taconInstalls.studioId })
    .from(taconInstalls)
    .innerJoin(tacons, eq(tacons.id, taconInstalls.taconId))
    .where(and(eq(taconInstalls.academyId, academyId), inArray(taconInstalls.studioId, studioIds)));
  const byTacon = new Map<number, { name: string; studios: Set<number> }>();
  for (const row of installs) {
    if (!byTacon.has(row.taconId)) byTacon.set(row.taconId, { name: row.name, studios: new Set() });
    byTacon.get(row.taconId)!.studios.add(row.studioId!);
  }
  const twice = [...byTacon.values()].filter((entry) => entry.studios.size > 1).map((entry) => entry.name);
  if (twice.length > 0) {
    warnings.push(
      `${listWords(twice)} ${twice.length === 1 ? "is" : "are"} installed in more than one of these studios, with separate records. Each install will now show for the whole group - remove the extra one if you want a single set.`,
    );
  }

  return warnings;
}

function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const groupSchema = z.object({
  name: z.string().trim().min(2, "Give the group a name.").max(60),
  description: z.string().max(600).nullable().optional(),
  studioIds: z.array(z.number().int()).min(2, "A group needs at least two studios."),
});

/**
 * Checks a proposed member list. Every studio must be one the caller can open,
 * and none may already sit in a different group - a studio governs with one
 * group at a time, and quietly moving it out of another one would change what
 * a whole other set of learners sees.
 */
async function checkMembers(
  academyId: number,
  scope: StudioScope,
  studioIds: number[],
  groupId: number | null,
): Promise<string | null> {
  const unique = [...new Set(studioIds)];
  if (unique.length < 2) return "A group needs at least two studios.";
  const all = await listStudios(academyId, true);
  for (const id of unique) {
    const studio = all.find((entry) => entry.id === id);
    if (!studio || studio.archived) return "One of those studios doesn't exist.";
    if (!scope.allowedIds.includes(id)) return `You can't group ${studio.name} - it isn't a studio you can open.`;
    if (studio.groupId !== null && studio.groupId !== groupId) {
      const [other] = await db.select().from(studioGroups).where(eq(studioGroups.id, studio.groupId)).limit(1);
      return `${studio.name} is already in "${other?.name ?? "another group"}". Take it out of that group first.`;
    }
  }
  return null;
}

async function studioNames(ids: number[]): Promise<string> {
  if (ids.length === 0) return "";
  const rows = await db.select({ name: studios.name }).from(studios).where(inArray(studios.id, ids));
  return listWords(rows.map((row) => row.name));
}

studiosRouter.post("/groups", requirePermission("studios.group"), async (req, res) => {
  const parsed = groupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the form." });
  }
  const academyId = req.user!.academyId;
  const studioIds = [...new Set(parsed.data.studioIds)];
  const problem = await checkMembers(academyId, requireScope(req), studioIds, null);
  if (problem) return res.status(400).json({ error: problem });

  const group = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(studioGroups)
      .values({
        academyId,
        name: parsed.data.name,
        description: parsed.data.description?.trim() || null,
      })
      .returning();
    await tx
      .update(studios)
      .set({ groupId: created.id, updatedAt: new Date() })
      .where(and(eq(studios.academyId, academyId), inArray(studios.id, studioIds)));
    return created;
  });

  await logActivity({
    academyId,
    actorUserId: req.user!.id,
    action: "studio.group.created",
    entityType: "studio_group",
    entityId: group.id,
    summary: `${req.user!.name} grouped ${await studioNames(studioIds)} as "${group.name}". They now share a wiki, positions, Town Halls, elections and Tac-Ons.`,
    metadata: { studioIds },
  });

  res.status(201).json({ group: { ...group, studioIds }, warnings: await groupWarnings(academyId, studioIds) });
});

/** Loads a group the caller is allowed to manage, or null. */
async function manageableGroup(academyId: number, scope: StudioScope, id: number) {
  const [group] = await db
    .select()
    .from(studioGroups)
    .where(and(eq(studioGroups.id, id), eq(studioGroups.academyId, academyId)))
    .limit(1);
  if (!group) return null;
  const members = (await listStudios(academyId, true)).filter((studio) => studio.groupId === id);
  const visible = members.filter((studio) => !studio.archived).every((studio) => scope.allowedIds.includes(studio.id));
  return visible ? { group, members } : null;
}

studiosRouter.patch("/groups/:id", requirePermission("studios.group"), async (req, res) => {
  const parsed = groupSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the form." });
  }
  const academyId = req.user!.academyId;
  const scope = requireScope(req);
  const id = Number(req.params.id);
  const found = await manageableGroup(academyId, scope, id);
  if (!found) return res.status(404).json({ error: "That group doesn't exist." });

  const before = found.members.filter((studio) => !studio.archived).map((studio) => studio.id);
  const after = parsed.data.studioIds ? [...new Set(parsed.data.studioIds)] : before;
  if (parsed.data.studioIds) {
    const problem = await checkMembers(academyId, scope, after, id);
    if (problem) return res.status(400).json({ error: problem });
  }
  const added = after.filter((studioId) => !before.includes(studioId));
  const removed = before.filter((studioId) => !after.includes(studioId));

  const group = await db.transaction(async (tx) => {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.description !== undefined) patch.description = parsed.data.description?.trim() || null;
    const [updated] = await tx.update(studioGroups).set(patch).where(eq(studioGroups.id, id)).returning();
    if (removed.length > 0) {
      await tx
        .update(studios)
        .set({ groupId: null, updatedAt: new Date() })
        .where(and(eq(studios.groupId, id), inArray(studios.id, removed)));
    }
    if (added.length > 0) {
      await tx
        .update(studios)
        .set({ groupId: id, updatedAt: new Date() })
        .where(and(eq(studios.academyId, academyId), inArray(studios.id, added), isNull(studios.groupId)));
    }
    return updated;
  });

  const label = `the "${group.name}" group`;
  const addedNames = await studioNames(added);
  const removedNames = await studioNames(removed);
  let summary = `${req.user!.name} updated ${label}.`;
  if (added.length > 0 && removed.length > 0) {
    summary = `${req.user!.name} added ${addedNames} to ${label} and took ${removedNames} out of it.`;
  } else if (added.length > 0) {
    summary = `${req.user!.name} added ${addedNames} to ${label}.`;
  } else if (removed.length > 0) {
    summary = `${req.user!.name} took ${removedNames} out of ${label}.`;
  }
  await logActivity({
    academyId,
    actorUserId: req.user!.id,
    action: "studio.group.updated",
    entityType: "studio_group",
    entityId: id,
    summary,
    metadata: { added, removed },
  });

  res.json({
    group: { ...group, studioIds: after },
    warnings: added.length > 0 ? await groupWarnings(academyId, after) : [],
  });
});

/**
 * Breaking a group up. Nothing is deleted: every rule, position, election and
 * Tac-On stays with the studio that owns it, and each studio goes back to
 * seeing only its own.
 */
studiosRouter.delete("/groups/:id", requirePermission("studios.group"), async (req, res) => {
  const academyId = req.user!.academyId;
  const id = Number(req.params.id);
  const found = await manageableGroup(academyId, requireScope(req), id);
  if (!found) return res.status(404).json({ error: "That group doesn't exist." });

  await db.transaction(async (tx) => {
    await tx.update(studios).set({ groupId: null, updatedAt: new Date() }).where(eq(studios.groupId, id));
    await tx.delete(studioGroups).where(eq(studioGroups.id, id));
  });

  await logActivity({
    academyId,
    actorUserId: req.user!.id,
    action: "studio.group.removed",
    entityType: "studio_group",
    entityId: id,
    summary: `${req.user!.name} broke up the "${found.group.name}" group. ${listWords(found.members.map((studio) => studio.name))} each govern on their own again.`,
  });

  res.json({ ok: true });
});

/** Remembers the studio the person is looking at across sessions and devices. */
studiosRouter.post("/select", requireAuth, async (req, res) => {
  const parsed = z.object({ studioId: z.number().int().nullable() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Pick a studio." });

  const scope = requireScope(req);
  const wanted = parsed.data.studioId;
  if (wanted !== null && !scope.allowedIds.includes(wanted)) {
    return res.status(403).json({ error: "That isn't a studio you can open." });
  }
  req.session.studioId = wanted;
  res.json({ ok: true, studioId: wanted });
});

const studioSchema = z.object({
  name: z.string().min(2).max(60),
  description: z.string().max(600).nullable().optional(),
  ageRange: z.string().max(40).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  learnerNoun: z.string().max(30).nullable().optional(),
  /** Strips the app back for the learners in this studio. */
  simpleMode: z.boolean().optional(),
  orderIndex: z.number().int().min(0).max(100).optional(),
  archived: z.boolean().optional(),
  settings: studioOverridesSchema.partial().optional(),
});

studiosRouter.post("/", requirePermission("studios.manage"), async (req, res) => {
  const parsed = studioSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the form." });
  }

  const academyId = req.user!.academyId;
  const existing = await listStudios(academyId, true);

  const [studio] = await db
    .insert(studios)
    .values({
      academyId,
      name: parsed.data.name.trim(),
      slug: await uniqueStudioSlug(academyId, parsed.data.name),
      description: parsed.data.description?.trim() || null,
      ageRange: parsed.data.ageRange?.trim() || null,
      color: parsed.data.color,
      learnerNoun: parsed.data.learnerNoun?.trim() || null,
      simpleMode: parsed.data.simpleMode ?? false,
      orderIndex: parsed.data.orderIndex ?? existing.length,
      settings: parsed.data.settings ?? {},
    })
    .returning();

  await logActivity({
    academyId,
    studioId: studio.id,
    actorUserId: req.user!.id,
    action: "studio.created",
    entityType: "studio",
    entityId: studio.id,
    summary: `${req.user!.name} added the ${studio.name} studio.`,
  });

  res.status(201).json({ studio });
});

studiosRouter.patch("/:id", requirePermission("studios.manage"), async (req, res) => {
  const parsed = studioSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Couldn't save that." });

  const id = Number(req.params.id);
  const [before] = await db
    .select()
    .from(studios)
    .where(and(eq(studios.id, id), eq(studios.academyId, req.user!.academyId)))
    .limit(1);
  if (!before) return res.status(404).json({ error: "That studio doesn't exist." });

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) patch.name = parsed.data.name.trim();
  if (parsed.data.description !== undefined) patch.description = parsed.data.description?.trim() || null;
  if (parsed.data.ageRange !== undefined) patch.ageRange = parsed.data.ageRange?.trim() || null;
  if (parsed.data.color !== undefined) patch.color = parsed.data.color;
  if (parsed.data.learnerNoun !== undefined) {
    patch.learnerNoun = parsed.data.learnerNoun?.trim() || null;
  }
  if (parsed.data.simpleMode !== undefined) patch.simpleMode = parsed.data.simpleMode;
  if (parsed.data.orderIndex !== undefined) patch.orderIndex = parsed.data.orderIndex;
  if (parsed.data.archived !== undefined) patch.archived = parsed.data.archived;
  if (parsed.data.settings !== undefined) {
    // Merge rather than replace, so a partial save can't silently reset overrides.
    patch.settings = { ...resolveOverrides(before.settings), ...parsed.data.settings };
  }

  const [studio] = await db.update(studios).set(patch).where(eq(studios.id, id)).returning();

  await logActivity({
    academyId: req.user!.academyId,
    studioId: studio.id,
    actorUserId: req.user!.id,
    action: "studio.updated",
    entityType: "studio",
    entityId: studio.id,
    summary: `${req.user!.name} updated the ${studio.name} studio.`,
    metadata: { fields: Object.keys(parsed.data) },
  });

  res.json({ studio });
});

/**
 * Archiving, never deleting.
 *
 * A studio that graduates its last cohort still holds the record of everything
 * it decided, and that record is the whole point of the tool. Archived studios
 * drop out of the switcher and stop taking new members; nothing else changes.
 */
studiosRouter.delete("/:id", requirePermission("studios.manage"), async (req, res) => {
  const id = Number(req.params.id);
  const academyId = req.user!.academyId;

  const remaining = (await listStudios(academyId)).filter((studio) => studio.id !== id);
  if (remaining.length === 0) {
    return res.status(409).json({
      error: "That's the last studio. An academy needs at least one for anything to belong to.",
    });
  }

  const [studio] = await db
    .update(studios)
    .set({ archived: true, updatedAt: new Date() })
    .where(and(eq(studios.id, id), eq(studios.academyId, academyId)))
    .returning();
  if (!studio) return res.status(404).json({ error: "That studio doesn't exist." });

  const [{ members }] = await db
    .select({ members: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.studioId, id), eq(users.active, true)));

  const [{ open }] = await db
    .select({ open: sql<number>`count(*)::int` })
    .from(elections)
    .where(and(eq(elections.studioId, id), eq(elections.status, "open")));

  await logActivity({
    academyId,
    studioId: id,
    actorUserId: req.user!.id,
    action: "studio.archived",
    entityType: "studio",
    entityId: id,
    summary: `${req.user!.name} archived the ${studio.name} studio.`,
  });

  res.json({
    ok: true,
    studio,
    // Worth saying out loud rather than leaving the admin to discover it.
    warnings: [
      members > 0 ? `${members} ${members === 1 ? "person is" : "people are"} still in it.` : null,
      open > 0 ? `${open} vote${open === 1 ? " is" : "s are"} still open there.` : null,
    ].filter(Boolean),
  });
});
