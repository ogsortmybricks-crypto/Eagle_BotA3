import { Router } from "express";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  elections,
  meetings,
  positions,
  studios,
  users,
  wikiRules,
  wikiSections,
} from "@shared/schema";
import { requireAuth, requirePermission } from "../auth";
import { logActivity } from "../activity";
import { listStudios, requireScope, uniqueStudioSlug } from "../studio";
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
  });
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
