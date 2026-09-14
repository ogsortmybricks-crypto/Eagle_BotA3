import { Router } from "express";
import { z } from "zod";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { aiJobs, meetingItems, meetings, users } from "@shared/schema";
import { requirePermission } from "../auth";
import { logActivity } from "../activity";
import { createJob, startProcessMeeting } from "../ai/jobs";
import { aiConfigured } from "../env";

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

townHallRouter.get("/", requirePermission("meetings.read"), async (req, res) => {
  const rows = await db
    .select({
      meeting: meetings,
      secretaryName: users.name,
      itemCount: sql<number>`(select count(*)::int from meeting_items where meeting_items.meeting_id = ${meetings.id})`,
    })
    .from(meetings)
    .leftJoin(users, eq(users.id, meetings.secretaryId))
    .where(eq(meetings.academyId, req.user!.academyId))
    .orderBy(desc(meetings.meetingDate), desc(meetings.id));
  res.json({ meetings: rows });
});

townHallRouter.post("/", requirePermission("meetings.write"), async (req, res) => {
  const parsed = z
    .object({
      title: z.string().min(2).max(160),
      meetingDate: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give the meeting a title." });

  const academyId = req.user!.academyId;

  // Open action items from previous meetings roll forward, so nothing that was
  // promised in a Town Hall quietly disappears between meetings.
  const carryOver = await db
    .select()
    .from(meetingItems)
    .where(
      and(
        eq(meetingItems.academyId, academyId),
        eq(meetingItems.type, "action_item"),
        eq(meetingItems.completed, false),
      ),
    )
    .orderBy(asc(meetingItems.dueDate));

  const [meeting] = await db
    .insert(meetings)
    .values({
      academyId,
      title: parsed.data.title.trim(),
      meetingDate: parsed.data.meetingDate ? new Date(parsed.data.meetingDate) : new Date(),
      status: "draft",
      secretaryId: req.user!.id,
      attendance: [],
    })
    .returning();

  if (carryOver.length > 0) {
    await db.insert(meetingItems).values(
      carryOver.map((item, index) => ({
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
          carryOver.map((item) => item.id),
        ),
      );
  }

  await logActivity({
    academyId,
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
  const [meeting] = await db
    .select()
    .from(meetings)
    .where(and(eq(meetings.id, id), eq(meetings.academyId, req.user!.academyId)))
    .limit(1);
  if (!meeting) return res.status(404).json({ error: "That meeting doesn't exist." });

  const items = await db
    .select()
    .from(meetingItems)
    .where(eq(meetingItems.meetingId, id))
    .orderBy(asc(meetingItems.orderIndex), asc(meetingItems.id));

  const job = meeting.lastJobId
    ? (await db.select().from(aiJobs).where(eq(aiJobs.id, meeting.lastJobId)).limit(1))[0]
    : null;

  const roster = await db
    .select({ id: users.id, name: users.name, role: users.role, studio: users.studio })
    .from(users)
    .where(and(eq(users.academyId, req.user!.academyId), eq(users.active, true)))
    .orderBy(asc(users.name));

  res.json({ meeting, items, job: job ?? null, roster });
});

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

  const patch: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.meetingDate) patch.meetingDate = new Date(parsed.data.meetingDate);
  if (parsed.data.status === "in_progress") patch.startedAt = new Date();
  if (parsed.data.status === "archived") patch.endedAt = new Date();

  const [meeting] = await db
    .update(meetings)
    .set(patch)
    .where(and(eq(meetings.id, Number(req.params.id)), eq(meetings.academyId, req.user!.academyId)))
    .returning();

  if (!meeting) return res.status(404).json({ error: "That meeting doesn't exist." });
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
  const [meeting] = await db
    .select()
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.academyId, req.user!.academyId)))
    .limit(1);
  if (!meeting) return res.status(404).json({ error: "That meeting doesn't exist." });

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
        eq(meetingItems.academyId, req.user!.academyId),
      ),
    )
    .returning();

  if (!item) return res.status(404).json({ error: "That item doesn't exist." });
  res.json({ item });
});

townHallRouter.delete("/:id/items/:itemId", requirePermission("meetings.write"), async (req, res) => {
  await db
    .delete(meetingItems)
    .where(
      and(
        eq(meetingItems.id, Number(req.params.itemId)),
        eq(meetingItems.academyId, req.user!.academyId),
      ),
    );
  res.json({ ok: true });
});

/** Bulk reorder after a drag. */
townHallRouter.post("/:id/reorder", requirePermission("meetings.write"), async (req, res) => {
  const parsed = z.object({ order: z.array(z.number().int()) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Bad ordering payload." });

  await Promise.all(
    parsed.data.order.map((itemId, index) =>
      db
        .update(meetingItems)
        .set({ orderIndex: index })
        .where(
          and(eq(meetingItems.id, itemId), eq(meetingItems.academyId, req.user!.academyId)),
        ),
    ),
  );
  res.json({ ok: true });
});

/* ------------------------------- process AI -------------------------------- */

townHallRouter.post("/:id/process", requirePermission("meetings.process"), async (req, res) => {
  if (!aiConfigured) {
    return res.status(503).json({ error: "The Claude API key isn't set, so AI features are off." });
  }
  const meetingId = Number(req.params.id);
  const academyId = req.user!.academyId;

  const [meeting] = await db
    .select()
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.academyId, academyId)))
    .limit(1);
  if (!meeting) return res.status(404).json({ error: "That meeting doesn't exist." });

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
    return res.status(409).json({ error: "This meeting is already being processed.", jobId: running[0].id });
  }

  const job = await createJob({
    academyId,
    kind: "process_meeting",
    requestedBy: req.user!.id,
    meetingId,
    message: "Queued",
  });

  await db.update(meetings).set({ status: "processing", lastJobId: job.id }).where(eq(meetings.id, meetingId));
  startProcessMeeting(job, meetingId);

  await logActivity({
    academyId,
    actorUserId: req.user!.id,
    action: "townhall.process.requested",
    entityType: "meeting",
    entityId: meetingId,
    summary: `${req.user!.name} sent "${meeting.title}" to the AI.`,
  });

  res.status(202).json({ jobId: job.id });
});

/** Open action items across all meetings - the "nothing got dropped" view. */
townHallRouter.get("/action-items/open", requirePermission("meetings.read"), async (req, res) => {
  const rows = await db
    .select({
      item: meetingItems,
      meetingTitle: meetings.title,
      meetingDate: meetings.meetingDate,
      assigneeName: users.name,
    })
    .from(meetingItems)
    .innerJoin(meetings, eq(meetings.id, meetingItems.meetingId))
    .leftJoin(users, eq(users.id, meetingItems.assignedTo))
    .where(
      and(
        eq(meetingItems.academyId, req.user!.academyId),
        eq(meetingItems.type, "action_item"),
        eq(meetingItems.completed, false),
      ),
    )
    .orderBy(asc(meetingItems.dueDate));
  res.json({ items: rows });
});
