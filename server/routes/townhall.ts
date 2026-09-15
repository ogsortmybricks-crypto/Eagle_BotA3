import { Router } from "express";
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { aiJobs, meetingItems, meetings, studios, users } from "@shared/schema";
import { requirePermission } from "../auth";
import { logActivity } from "../activity";
import { createJob, startProcessMeeting } from "../ai/jobs";
import { aiConfigured } from "../env";
import {
  canReadStudio,
  effectiveForStudio,
  requireScope,
  scoped,
  StudioChoiceError,
  writeStudioId,
} from "../studio";
import {
  quorumThreshold,
  type AcademySettings,
  type EffectiveSettings,
} from "@shared/settings";

export const townHallRouter = Router();

const ITEM_TYPES = [
  "agenda",
  "discussion",
  "motion",
  "decision",
  "action_item",
  "appeal",
  "announcement",
] as const;

/**
 * Who counts toward quorum in a given studio's Town Hall.
 *
 * Guides are excluded by default: counting adults toward the quorum of a
 * meeting they aren't supposed to decide anything in inflates the bar the
 * learners have to clear.
 */
async function quorumFor(
  academyId: number,
  studioId: number | null,
  settings: AcademySettings,
  effective: EffectiveSettings,
) {
  const roster = await db
    .select({ id: users.id, role: users.role, studioId: users.studioId })
    .from(users)
    .where(and(eq(users.academyId, academyId), eq(users.active, true)));

  const members = roster.filter((person) => {
    if (studioId !== null && person.studioId !== studioId) return false;
    if (person.role === "guide" && !settings.townHall.guidesCountTowardQuorum) return false;
    return true;
  });

  return {
    eligible: members.length,
    eligibleIds: members.map((person) => person.id),
    threshold: quorumThreshold(effective.quorumMode, effective.quorumFixed, members.length),
  };
}

townHallRouter.get("/", requirePermission("meetings.read"), async (req, res) => {
  const scope = requireScope(req);
  const rows = await db
    .select({
      meeting: meetings,
      secretaryName: users.name,
      studioName: studios.name,
      studioColor: studios.color,
      itemCount: sql<number>`(select count(*)::int from meeting_items where meeting_items.meeting_id = ${meetings.id})`,
    })
    .from(meetings)
    .leftJoin(users, eq(users.id, meetings.secretaryId))
    .leftJoin(studios, eq(studios.id, meetings.studioId))
    .where(scoped(eq(meetings.academyId, req.user!.academyId), meetings.studioId, scope))
    .orderBy(desc(meetings.meetingDate), desc(meetings.id));
  res.json({ meetings: rows });
});

townHallRouter.post("/", requirePermission("meetings.write"), async (req, res) => {
  const parsed = z
    .object({
      title: z.string().min(2).max(160).optional(),
      meetingDate: z.string().optional(),
      studioId: z.number().int().nullable().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Couldn't start that meeting." });

  const academyId = req.user!.academyId;
  const scope = requireScope(req);
  const settings = req.settings!;

  let studioId: number | null;
  try {
    studioId = writeStudioId(scope, parsed.data.studioId);
  } catch (error) {
    if (error instanceof StudioChoiceError) {
      return res.status(400).json({ error: error.message, needsStudio: true });
    }
    throw error;
  }

  const [studio] = studioId
    ? await db.select().from(studios).where(eq(studios.id, studioId)).limit(1)
    : [null];

  const meetingDate = parsed.data.meetingDate ? new Date(parsed.data.meetingDate) : new Date();
  const title =
    parsed.data.title?.trim() ||
    settings.townHall.titleTemplate
      .replace("{date}", meetingDate.toLocaleDateString(undefined, { month: "long", day: "numeric" }))
      .replace("{studio}", studio?.name ?? "Academy");

  // Open action items roll forward so nothing promised in a Town Hall quietly
  // disappears - but only this studio's, because Spark's chores are not
  // Launchpad's problem.
  const carryOver = settings.townHall.carryOverActionItems
    ? await db
        .select()
        .from(meetingItems)
        .innerJoin(meetings, eq(meetings.id, meetingItems.meetingId))
        .where(
          and(
            eq(meetingItems.academyId, academyId),
            eq(meetingItems.type, "action_item"),
            eq(meetingItems.completed, false),
            // Strictly this studio's own meetings. An academy-wide meeting
            // carries academy-wide items, not four studios' chores at once.
            studioId === null ? isNull(meetings.studioId) : eq(meetings.studioId, studioId),
          ),
        )
        .orderBy(asc(meetingItems.dueDate))
    : [];

  const [meeting] = await db
    .insert(meetings)
    .values({
      academyId,
      studioId,
      title,
      meetingDate,
      status: "draft",
      secretaryId: req.user!.id,
      attendance: [],
    })
    .returning();

  if (carryOver.length > 0) {
    const items = carryOver.map((row) => row.meeting_items);
    await db.insert(meetingItems).values(
      items.map((item, index) => ({
        academyId,
        meetingId: meeting.id,
        type: "action_item" as const,
        title: item.title,
        body: item.body,
        orderIndex: index,
        assignedTo: item.assignedTo,
        dueDate: item.dueDate,
        raisedBy: item.raisedBy,
      })),
    );
    // The originals are closed out; the copies are now the live ones.
    await db
      .update(meetingItems)
      .set({ completed: true })
      .where(
        inArray(
          meetingItems.id,
          items.map((item) => item.id),
        ),
      );
  }

  await logActivity({
    academyId,
    studioId,
    actorUserId: req.user!.id,
    action: "townhall.created",
    entityType: "meeting",
    entityId: meeting.id,
    summary: `${req.user!.name} started a Town Hall: "${meeting.title}".`,
    metadata: { carriedOverItems: carryOver.length },
  });

  res.status(201).json({ meeting, carriedOver: carryOver.length });
});

townHallRouter.get("/:id", requirePermission("meetings.read"), async (req, res) => {
  const id = Number(req.params.id);
  const scope = requireScope(req);
  const settings = req.settings!;

  const [meeting] = await db
    .select()
    .from(meetings)
    .where(and(eq(meetings.id, id), eq(meetings.academyId, req.user!.academyId)))
    .limit(1);
  if (!meeting || !canReadStudio(scope, meeting.studioId)) {
    return res.status(404).json({ error: "That meeting doesn't exist." });
  }

  const items = await db
    .select()
    .from(meetingItems)
    .where(eq(meetingItems.meetingId, id))
    .orderBy(asc(meetingItems.orderIndex), asc(meetingItems.id));

  const job = meeting.lastJobId
    ? (await db.select().from(aiJobs).where(eq(aiJobs.id, meeting.lastJobId)).limit(1))[0]
    : null;

  const [studio] = meeting.studioId
    ? await db.select().from(studios).where(eq(studios.id, meeting.studioId)).limit(1)
    : [null];

  // The roster is the people who are actually in this meeting's studio.
  const roster = await db
    .select({ id: users.id, name: users.name, role: users.role, studioId: users.studioId })
    .from(users)
    .where(and(eq(users.academyId, req.user!.academyId), eq(users.active, true)))
    .orderBy(asc(users.name));
  const studioRoster =
    meeting.studioId === null
      ? roster
      : roster.filter((person) => person.studioId === meeting.studioId);

  const effective = await effectiveForStudio(meeting.studioId, settings);
  const quorum = await quorumFor(req.user!.academyId, meeting.studioId, settings, effective);

  res.json({
    meeting,
    studio: studio ? { id: studio.id, name: studio.name, color: studio.color } : null,
    items,
    job: job ?? null,
    roster: studioRoster,
    quorum: {
      ...quorum,
      mode: effective.quorumMode,
      present: (meeting.attendance ?? []).filter((personId) =>
        quorum.eligibleIds.includes(personId),
      ).length,
      requiredToProcess: settings.townHall.requireQuorumToProcess,
    },
    locked: settings.townHall.lockAfterProcessing && meeting.status === "processed",
  });
});

/** Rejects edits when the meeting is frozen, either mid-AI-run or after one. */
async function ensureEditable(req: import("express").Request, meetingId: number) {
  const [meeting] = await db
    .select()
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.academyId, req.user!.academyId)))
    .limit(1);
  if (!meeting || !canReadStudio(requireScope(req), meeting.studioId)) {
    return { error: "That meeting doesn't exist.", status: 404 as const, meeting: null };
  }
  if (meeting.status === "processing") {
    return { error: "The AI is reading these notes right now. Give it a moment.", status: 409 as const, meeting };
  }
  if (req.settings!.townHall.lockAfterProcessing && meeting.status === "processed") {
    return {
      error:
        "These notes were locked once the AI folded them into the wiki. An admin can turn that off in Settings.",
      status: 409 as const,
      meeting,
    };
  }
  return { error: null, status: 200 as const, meeting };
}

townHallRouter.patch("/:id", requirePermission("meetings.write"), async (req, res) => {
  const parsed = z
    .object({
      title: z.string().min(2).max(160).optional(),
      notes: z.string().optional(),
      attendance: z.array(z.number().int()).optional(),
      quorumNote: z.string().max(300).nullable().optional(),
      status: z.enum(["draft", "in_progress", "processed", "archived"]).optional(),
      meetingDate: z.string().optional(),
      secretaryId: z.number().int().nullable().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Couldn't save that." });

  const check = await ensureEditable(req, Number(req.params.id));
  if (check.error) return res.status(check.status).json({ error: check.error });

  const patch: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.meetingDate) patch.meetingDate = new Date(parsed.data.meetingDate);
  if (parsed.data.status === "in_progress") patch.startedAt = new Date();
  if (parsed.data.status === "archived") patch.endedAt = new Date();

  const [meeting] = await db
    .update(meetings)
    .set(patch)
    .where(eq(meetings.id, check.meeting!.id))
    .returning();

  res.json({ meeting });
});

/* --------------------------------- items ---------------------------------- */

townHallRouter.post("/:id/items", requirePermission("meetings.write"), async (req, res) => {
  const parsed = z
    .object({
      type: z.enum(ITEM_TYPES).default("discussion"),
      title: z.string().min(1).max(300),
      body: z.string().default(""),
      raisedBy: z.number().int().nullable().optional(),
      timeOffsetSec: z.number().int().nullable().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "An item needs a title." });

  const meetingId = Number(req.params.id);
  const check = await ensureEditable(req, meetingId);
  if (check.error) return res.status(check.status).json({ error: check.error });

  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${meetingItems.orderIndex}), -1)` })
    .from(meetingItems)
    .where(eq(meetingItems.meetingId, meetingId));

  const [item] = await db
    .insert(meetingItems)
    .values({
      academyId: req.user!.academyId,
      meetingId,
      type: parsed.data.type,
      title: parsed.data.title,
      body: parsed.data.body,
      orderIndex: (max ?? -1) + 1,
      raisedBy: parsed.data.raisedBy ?? null,
      timeOffsetSec: parsed.data.timeOffsetSec ?? null,
    })
    .returning();

  res.status(201).json({ item });
});

townHallRouter.patch("/:id/items/:itemId", requirePermission("meetings.write"), async (req, res) => {
  const parsed = z
    .object({
      type: z.enum(ITEM_TYPES).optional(),
      title: z.string().min(1).max(300).optional(),
      body: z.string().optional(),
      outcome: z.enum(["passed", "failed", "tabled", "withdrawn"]).nullable().optional(),
      votesFor: z.number().int().nullable().optional(),
      votesAgainst: z.number().int().nullable().optional(),
      votesAbstain: z.number().int().nullable().optional(),
      assignedTo: z.number().int().nullable().optional(),
      raisedBy: z.number().int().nullable().optional(),
      dueDate: z.string().nullable().optional(),
      completed: z.boolean().optional(),
      orderIndex: z.number().int().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Couldn't save that change." });

  const check = await ensureEditable(req, Number(req.params.id));
  if (check.error) return res.status(check.status).json({ error: check.error });

  const patch: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  if (parsed.data.dueDate !== undefined) {
    patch.dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null;
  }

  const [item] = await db
    .update(meetingItems)
    .set(patch)
    .where(
      and(
        eq(meetingItems.id, Number(req.params.itemId)),
        eq(meetingItems.meetingId, check.meeting!.id),
      ),
    )
    .returning();

  if (!item) return res.status(404).json({ error: "That item doesn't exist." });
  res.json({ item });
});

townHallRouter.delete("/:id/items/:itemId", requirePermission("meetings.write"), async (req, res) => {
  const check = await ensureEditable(req, Number(req.params.id));
  if (check.error) return res.status(check.status).json({ error: check.error });

  await db
    .delete(meetingItems)
    .where(
      and(
        eq(meetingItems.id, Number(req.params.itemId)),
        eq(meetingItems.meetingId, check.meeting!.id),
      ),
    );
  res.json({ ok: true });
});

/** Bulk reorder after a drag. */
townHallRouter.post("/:id/reorder", requirePermission("meetings.write"), async (req, res) => {
  const parsed = z.object({ order: z.array(z.number().int()) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Bad ordering payload." });

  const check = await ensureEditable(req, Number(req.params.id));
  if (check.error) return res.status(check.status).json({ error: check.error });

  await Promise.all(
    parsed.data.order.map((itemId, index) =>
      db
        .update(meetingItems)
        .set({ orderIndex: index })
        .where(and(eq(meetingItems.id, itemId), eq(meetingItems.meetingId, check.meeting!.id))),
    ),
  );
  res.json({ ok: true });
});

/* ------------------------------- process AI -------------------------------- */

townHallRouter.post("/:id/process", requirePermission("meetings.process"), async (req, res) => {
  if (!aiConfigured) {
    return res.status(503).json({ error: "The Claude API key isn't set, so AI features are off." });
  }
  if (!req.settings!.ai.enabled) {
    return res.status(403).json({ error: "AI features are switched off in this academy's settings." });
  }

  const meetingId = Number(req.params.id);
  const academyId = req.user!.academyId;
  const scope = requireScope(req);
  const settings = req.settings!;

  const [meeting] = await db
    .select()
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.academyId, academyId)))
    .limit(1);
  if (!meeting || !canReadStudio(scope, meeting.studioId)) {
    return res.status(404).json({ error: "That meeting doesn't exist." });
  }

  // A meeting that never had quorum didn't decide anything, so folding it into
  // the Contract would be recording decisions the studio never legitimately made.
  if (settings.townHall.requireQuorumToProcess) {
    const effective = await effectiveForStudio(meeting.studioId, settings);
    const quorum = await quorumFor(academyId, meeting.studioId, settings, effective);
    const present = (meeting.attendance ?? []).filter((id) => quorum.eligibleIds.includes(id)).length;
    if (present < quorum.threshold) {
      return res.status(409).json({
        error: `This meeting had ${present} of the ${quorum.threshold} people it needed for quorum, and this academy won't write a Town Hall into the wiki without it.`,
        quorumShort: true,
      });
    }
  }

  const running = await db
    .select({ id: aiJobs.id })
    .from(aiJobs)
    .where(
      and(
        eq(aiJobs.academyId, academyId),
        eq(aiJobs.meetingId, meetingId),
        inArray(aiJobs.status, ["queued", "running"]),
      ),
    );
  if (running.length > 0) {
    return res
      .status(409)
      .json({ error: "This meeting is already being processed.", jobId: running[0].id });
  }

  const job = await createJob({
    academyId,
    studioId: meeting.studioId,
    kind: "process_meeting",
    requestedBy: req.user!.id,
    meetingId,
    message: "Queued",
  });

  await db
    .update(meetings)
    .set({ status: "processing", lastJobId: job.id })
    .where(eq(meetings.id, meetingId));
  startProcessMeeting(job, meetingId);

  await logActivity({
    academyId,
    studioId: meeting.studioId,
    actorUserId: req.user!.id,
    action: "townhall.process.requested",
    entityType: "meeting",
    entityId: meetingId,
    summary: `${req.user!.name} sent "${meeting.title}" to the AI.`,
  });

  res.status(202).json({ jobId: job.id });
});

/** Open action items across this studio's meetings - the "nothing got dropped" view. */
townHallRouter.get("/action-items/open", requirePermission("meetings.read"), async (req, res) => {
  const scope = requireScope(req);
  const rows = await db
    .select({
      item: meetingItems,
      meetingTitle: meetings.title,
      meetingDate: meetings.meetingDate,
      studioName: studios.name,
      assigneeName: users.name,
    })
    .from(meetingItems)
    .innerJoin(meetings, eq(meetings.id, meetingItems.meetingId))
    .leftJoin(studios, eq(studios.id, meetings.studioId))
    .leftJoin(users, eq(users.id, meetingItems.assignedTo))
    .where(
      scoped(
        and(
          eq(meetingItems.academyId, req.user!.academyId),
          eq(meetingItems.type, "action_item"),
          eq(meetingItems.completed, false),
        ),
        meetings.studioId,
        scope,
      ),
    )
    .orderBy(asc(meetingItems.dueDate));
  res.json({ items: rows });
});
