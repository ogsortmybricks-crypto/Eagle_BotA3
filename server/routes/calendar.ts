import { Router, type Request } from "express";
import { z } from "zod";
import { and, eq, gte, inArray, lte, or } from "drizzle-orm";
import { db } from "../db";
import {
  absences,
  CALENDAR_KINDS,
  calendarEvents,
  elections,
  meetings,
  users,
  type CalendarEvent,
  type CalendarRecurrence,
} from "@shared/schema";
import { addDays, daysBetween, isDay, KIND_LABELS, shiftWeekdays, TIME_RE } from "@shared/calendar";
import { requirePermission } from "../auth";
import { logActivity } from "../activity";
import { requireScope, studioFilter } from "../studio";
import {
  attendanceOverview,
  CALENDAR_VIEWS,
  CalendarLensError,
  eventsInRange,
  expand,
  ownerOf,
  resolveLens,
  type CalendarView,
} from "../calendar";
import { guidesFor } from "./studios";
import { can } from "@shared/permissions";
import { visibleInstalls } from "../tacons/registry";
import { buildRuntime, calendarFeed, type TaconCalendarEntry } from "../tacons/runtime";

export const calendarRouter = Router();

/** Longest range one request may ask for: a year view plus its edges. */
const MAX_RANGE_DAYS = 400;

const day = z.string().refine(isDay, "That isn't a day.");

const rangeQuery = z.object({
  from: day,
  to: day,
  view: z.enum(CALENDAR_VIEWS).default("studio"),
  target: z.coerce.number().int().optional(),
});

function parseRange(req: Request) {
  const parsed = rangeQuery.safeParse(req.query);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Pick a range." } as const;
  const { from, to } = parsed.data;
  if (to < from || daysBetween(from, to) > MAX_RANGE_DAYS) {
    return { error: "That range is too long." } as const;
  }
  return { data: parsed.data } as const;
}

/** A view with no studio selected falls back to the whole academy instead of failing. */
function defaultView(req: Request, view: CalendarView): CalendarView {
  const scope = requireScope(req);
  return view === "studio" && scope.studioId === null && req.query.target === undefined ? "academy" : view;
}

/* -------------------------------------------------------------------------- */
/*  Reading                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Everything on the calendar between two days, for one view.
 *
 * Alongside the calendar's own entries come the dated things the rest of
 * Eagle Bot already knows about - Town Halls and election deadlines - so the
 * calendar is the one place to see what's coming, without anyone entering
 * a Town Hall twice.
 */
calendarRouter.get("/", requirePermission("calendar.read"), async (req, res) => {
  const range = parseRange(req);
  if ("error" in range) return res.status(400).json({ error: range.error });
  const { from, to, target } = range.data;
  const academyId = req.user!.academyId;
  const scope = requireScope(req);

  let lens;
  try {
    lens = await resolveLens(academyId, scope, defaultView(req, range.data.view), target ?? null);
  } catch (error) {
    if (error instanceof CalendarLensError) return res.status(400).json({ error: error.message });
    throw error;
  }

  const items = expand(await eventsInRange(academyId, lens, from, to), lens, from, to);

  // Town Halls and elections are filed by studio, so a lens reads them the
  // way the rest of the app does: its studios, plus academy-wide ones.
  const lensScope = { ...scope, studioId: null, circleIds: [], readableIds: lens.studioIds, canSeeAll: false };
  const fromTime = new Date(`${from}T00:00:00Z`);
  const toTime = new Date(`${addDays(to, 1)}T12:00:00Z`);

  const meetingRows = await db
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.academyId, academyId),
        gte(meetings.meetingDate, fromTime),
        lte(meetings.meetingDate, toTime),
        studioFilter(meetings.studioId, lensScope),
      ),
    );
  const electionRows = await db
    .select()
    .from(elections)
    .where(
      and(
        eq(elections.academyId, academyId),
        inArray(elections.status, ["open", "closed", "certified"]),
        or(
          and(gte(elections.opensAt, fromTime), lte(elections.opensAt, toTime)),
          and(gte(elections.closesAt, fromTime), lte(elections.closesAt, toTime)),
        ),
        studioFilter(elections.studioId, lensScope),
      ),
    );

  const studioColor = (id: number | null) => lens.studios.find((studio) => studio.id === id)?.color ?? null;
  const linked = [
    ...meetingRows.map((meeting) => ({
      key: `meeting-${meeting.id}`,
      type: "town_hall" as const,
      title: meeting.title,
      at: meeting.meetingDate.toISOString(),
      href: `/town-hall/${meeting.id}`,
      color: studioColor(meeting.studioId),
    })),
    ...electionRows.flatMap((election) =>
      [
        election.opensAt && { at: election.opensAt, label: "Voting opens" },
        election.closesAt && { at: election.closesAt, label: "Voting closes" },
      ]
        .filter((entry): entry is { at: Date; label: string } => Boolean(entry))
        .filter((entry) => entry.at >= fromTime && entry.at <= toTime)
        .map((entry) => ({
          key: `election-${election.id}-${entry.label}`,
          type: "election" as const,
          title: `${entry.label}: ${election.title}`,
          at: entry.at.toISOString(),
          href: `/elections/${election.id}`,
          color: studioColor(election.studioId),
        })),
    ),
  ];

  // Tac-Ons that put their own records on the calendar. A Tac-On that fails
  // drops out of the calendar rather than taking it down.
  const taconEntries: TaconCalendarEntry[] = [];
  if (can(req.user!.role, "tacons.use", req.settings, { devStatus: req.user!.devStatus })) {
    for (const install of await visibleInstalls(academyId, scope)) {
      if (!install.manifest.calendars?.length) continue;
      try {
        const runtime = await buildRuntime({
          academy: req.academy!,
          settings: req.settings!,
          user: req.user!,
          scope,
          install,
        });
        taconEntries.push(...(await calendarFeed(runtime, from, to)));
      } catch (error) {
        console.error("[calendar] a Tac-On's calendar failed", install.install.id, error);
      }
    }
  }

  // Who guides what's in view, so the header can say whose calendar this is.
  const guides = (await guidesFor(academyId)).filter(
    (guide) =>
      (guide.studioId !== null && lens.studioIds.includes(guide.studioId)) ||
      (guide.groupId !== null && lens.groupIds.includes(guide.groupId)),
  );

  res.json({
    view: lens.view,
    targetId: lens.targetId,
    label: lens.label,
    items,
    linked,
    tacons: taconEntries,
    guides: [...new Map(guides.map((guide) => [guide.userId, guide])).values()],
    studios: lens.studios
      .filter((studio) => !studio.archived && lens.studioIds.includes(studio.id))
      .map((studio) => ({ id: studio.id, name: studio.name, color: studio.color, groupId: studio.groupId })),
    groups: lens.groups
      .filter((group) => lens.groupIds.includes(group.id))
      .map((group) => ({ id: group.id, name: group.name })),
  });
});

/** Search across everything this person can see. */
calendarRouter.get("/search", requirePermission("calendar.read"), async (req, res) => {
  const q = String(req.query.q ?? "").trim().toLowerCase();
  if (q.length < 2) return res.json({ items: [] });
  const academyId = req.user!.academyId;
  const lens = await resolveLens(academyId, requireScope(req), "academy", null);
  const from = addDays(new Date().toISOString().slice(0, 10), -365);
  const to = addDays(from, MAX_RANGE_DAYS * 2);
  const events = (await eventsInRange(academyId, lens, from, to)).filter((event) =>
    [event.title, event.description, event.location ?? "", event.quest ?? ""].some((field) =>
      field.toLowerCase().includes(q),
    ),
  );
  // One row per entry, not per occurrence - search finds things, the views show them.
  res.json({
    items: events.slice(0, 50).map((event) => ({
      ...event,
      key: String(event.id),
      occurrenceStart: event.startDate,
      occurrenceEnd: event.endDate,
      ...((owner) => ({ ownerLabel: owner.label, ownerColor: owner.color }))(ownerOf(event, lens)),
    })),
  });
});

/* -------------------------------------------------------------------------- */
/*  Writing                                                                    */
/* -------------------------------------------------------------------------- */

const recurrenceSchema = z
  .object({
    freq: z.enum(["daily", "weekly", "monthly"]),
    interval: z.number().int().min(1).max(52).default(1),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    until: day.nullable().default(null),
    count: z.number().int().min(1).max(500).nullable().default(null),
  })
  .nullable();

const eventSchema = z.object({
  kind: z.enum(CALENDAR_KINDS),
  title: z.string().trim().min(1, "Give it a title.").max(140),
  description: z.string().max(10_000).default(""),
  location: z.string().trim().max(200).nullable().optional(),
  quest: z.string().trim().max(200).nullable().optional(),
  startDate: day,
  endDate: day,
  startTime: z.string().regex(TIME_RE).nullable().optional(),
  endTime: z.string().regex(TIME_RE).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  recurrence: recurrenceSchema.optional(),
  /** Who it belongs to. Both null means the whole academy. */
  studioId: z.number().int().nullable().optional(),
  groupId: z.number().int().nullable().optional(),
});

type EventInput = z.infer<typeof eventSchema>;

/** Problems with an entry's shape, as a sentence, or null. */
function shapeProblem(input: Pick<EventInput, "startDate" | "endDate" | "startTime" | "endTime" | "kind">): string | null {
  if (input.endDate < input.startDate) return "It can't end before it starts.";
  if (daysBetween(input.startDate, input.endDate) > 366) return "Keep it under a year. Split a longer stretch into sessions.";
  if (Boolean(input.startTime) !== Boolean(input.endTime)) return "Give it both a start and an end time, or neither.";
  if (input.startTime && input.endTime && input.startDate === input.endDate && input.endTime <= input.startTime) {
    return "It has to end after it starts.";
  }
  if ((input.kind === "session" || input.kind === "break") && input.startTime) {
    return `A ${KIND_LABELS[input.kind].toLowerCase()} runs whole days, so it doesn't take times.`;
  }
  return null;
}

/**
 * May this person put something on this studio's, group's or academy's
 * calendar? Guides can write anywhere they can open - planning a joint field
 * trip with another studio is ordinary guide work - and the academy calendar
 * is open to anyone who can see every studio.
 */
async function ownerProblem(req: Request, studioId: number | null, groupId: number | null): Promise<string | null> {
  const scope = requireScope(req);
  if (studioId !== null && groupId !== null) return "Put it on a studio or a group, not both.";
  if (studioId !== null) {
    return scope.allowedIds.includes(studioId) ? null : "That isn't a studio you can add to.";
  }
  if (groupId !== null) {
    const members = scope.allowed.filter((studio) => studio.groupId === groupId);
    if (members.length === 0) return "That isn't a group you can add to.";
    return null;
  }
  return req.user!.role === "admin" || scope.canSeeAll
    ? null
    : "Only someone who can see every studio can add to the whole academy's calendar.";
}

/** An entry this person may change, or null. Reading it is the same test as writing to its owner. */
async function editableEvent(req: Request, id: number): Promise<CalendarEvent | null> {
  const [event] = await db
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.id, id), eq(calendarEvents.academyId, req.user!.academyId)))
    .limit(1);
  if (!event) return null;
  return (await ownerProblem(req, event.studioId, event.groupId)) ? null : event;
}

function describe(event: Pick<CalendarEvent, "kind" | "title" | "startDate" | "endDate">): string {
  const when = event.startDate === event.endDate ? event.startDate : `${event.startDate} to ${event.endDate}`;
  return `${KIND_LABELS[event.kind].toLowerCase()} "${event.title}" (${when})`;
}

/** What Tac-Ons hear about a calendar change, as `event.*`. */
function hookMetadata(event: CalendarEvent, ownerLabel: string) {
  return {
    kind: event.kind,
    title: event.title,
    starts: event.startDate,
    ends: event.endDate,
    quest: event.quest ?? "",
    owner: ownerLabel,
  };
}

async function logChange(req: Request, action: string, event: CalendarEvent, summary: string) {
  const lens = await resolveLens(req.user!.academyId, requireScope(req), "academy", null);
  // A group's entry is filed under one of its studios. Activity and Tac-On
  // reactions read a studio together with its group, so the whole group sees
  // it - which a null (academy-level) studio would not give.
  const groupStudio =
    event.groupId !== null
      ? (lens.studios.find((studio) => studio.groupId === event.groupId && !studio.archived)?.id ?? null)
      : null;
  await logActivity({
    academyId: req.user!.academyId,
    studioId: event.studioId ?? groupStudio,
    actorUserId: req.user!.id,
    action,
    entityType: "calendar_event",
    entityId: event.id,
    summary,
    metadata: hookMetadata(event, ownerOf(event, lens).label),
  });
}

function normalise(input: Partial<EventInput>) {
  const values: Partial<typeof calendarEvents.$inferInsert> = {};
  if (input.kind !== undefined) values.kind = input.kind;
  if (input.title !== undefined) values.title = input.title;
  if (input.description !== undefined) values.description = input.description;
  if (input.location !== undefined) values.location = input.location || null;
  if (input.quest !== undefined) values.quest = input.quest || null;
  if (input.startDate !== undefined) values.startDate = input.startDate;
  if (input.endDate !== undefined) values.endDate = input.endDate;
  if (input.startTime !== undefined) values.startTime = input.startTime || null;
  if (input.endTime !== undefined) values.endTime = input.endTime || null;
  if (input.color !== undefined) values.color = input.color || null;
  if (input.recurrence !== undefined) values.recurrence = (input.recurrence as CalendarRecurrence | null) ?? null;
  if (input.studioId !== undefined) values.studioId = input.studioId ?? null;
  if (input.groupId !== undefined) values.groupId = input.groupId ?? null;
  return values;
}

calendarRouter.post("/events", requirePermission("calendar.manage"), async (req, res) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the form." });
  const input = parsed.data;
  const problem =
    shapeProblem(input) ?? (await ownerProblem(req, input.studioId ?? null, input.groupId ?? null));
  if (problem) return res.status(400).json({ error: problem });

  const [event] = await db
    .insert(calendarEvents)
    .values({
      ...normalise(input),
      academyId: req.user!.academyId,
      kind: input.kind,
      title: input.title,
      startDate: input.startDate,
      endDate: input.endDate,
      createdBy: req.user!.id,
    })
    .returning();

  await logChange(req, "calendar.event.created", event, `${req.user!.name} added the ${describe(event)} to the calendar.`);
  res.status(201).json({ event });
});

/**
 * Changing an entry. For a recurring one, `occurrence` names the day of the
 * occurrence being edited and `mode` says how far the change reaches, the
 * way any calendar asks: just this one, this and following, or all of them.
 */
calendarRouter.patch("/events/:id", requirePermission("calendar.manage"), async (req, res) => {
  const parsed = eventSchema
    .partial()
    .extend({ occurrence: day.optional(), mode: z.enum(["one", "following", "all"]).default("all") })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the form." });
  const { occurrence, mode, ...patch } = parsed.data;

  const event = await editableEvent(req, Number(req.params.id));
  if (!event) return res.status(404).json({ error: "That isn't on a calendar you can change." });

  const merged = { ...event, ...normalise(patch) } as CalendarEvent;
  // Splitting one occurrence (or the rest) off a series: the new entry runs
  // from that occurrence, not from the series' first day, so check those dates.
  const splitting = Boolean(event.recurrence && occurrence && mode !== "all");
  if (splitting) {
    const span = daysBetween(event.startDate, event.endDate);
    merged.startDate = patch.startDate ?? occurrence!;
    merged.endDate = patch.endDate ?? addDays(merged.startDate, span);
  }
  // Moving a repeating entry by a few days (a drag, not a new rule) carries its
  // weekdays and skipped days along with it, so a Mon/Wed series dragged a day
  // later becomes Tue/Thu rather than quietly losing its first week.
  if (event.recurrence && patch.recurrence === undefined && patch.startDate !== undefined) {
    const shift = daysBetween(splitting ? occurrence! : event.startDate, merged.startDate);
    if (shift !== 0) {
      merged.recurrence = shiftWeekdays(event.recurrence, shift);
      if (!splitting) merged.exceptions = event.exceptions.map((day) => addDays(day, shift));
    }
  }
  const problem =
    shapeProblem(merged) ??
    (patch.studioId !== undefined || patch.groupId !== undefined
      ? await ownerProblem(req, merged.studioId, merged.groupId)
      : null);
  if (problem) return res.status(400).json({ error: problem });

  const now = new Date();

  if (splitting && occurrence) {
    const { startDate, endDate } = merged;
    const { id: _id, createdAt: _created, updatedAt: _updated, ...copy } = merged;
    void _id;
    void _created;
    void _updated;

    const created = await db.transaction(async (tx) => {
      if (mode === "one") {
        await tx
          .update(calendarEvents)
          .set({ exceptions: [...new Set([...event.exceptions, occurrence])], updatedAt: now })
          .where(eq(calendarEvents.id, event.id));
        const [single] = await tx
          .insert(calendarEvents)
          .values({ ...copy, startDate, endDate, recurrence: null, exceptions: [], createdBy: req.user!.id })
          .returning();
        return single;
      }
      // This and following: end the old series the day before, start a new one.
      await tx
        .update(calendarEvents)
        .set({ recurrence: { ...event.recurrence!, until: addDays(occurrence, -1), count: null }, updatedAt: now })
        .where(eq(calendarEvents.id, event.id));
      const [series] = await tx
        .insert(calendarEvents)
        .values({
          ...copy,
          startDate,
          endDate,
          recurrence: merged.recurrence ? { ...merged.recurrence, count: null } : null,
          exceptions: event.exceptions.filter((entry) => entry > occurrence),
          createdBy: req.user!.id,
        })
        .returning();
      return series;
    });

    await logChange(
      req,
      "calendar.event.updated",
      created,
      `${req.user!.name} changed ${mode === "one" ? "one day of" : "the rest of"} the ${describe(event)}.`,
    );
    return res.json({ event: created });
  }

  const [updated] = await db
    .update(calendarEvents)
    .set({ ...normalise(patch), recurrence: merged.recurrence, exceptions: merged.exceptions, updatedAt: now })
    .where(eq(calendarEvents.id, event.id))
    .returning();
  await logChange(req, "calendar.event.updated", updated, `${req.user!.name} changed the ${describe(updated)}.`);
  res.json({ event: updated });
});

calendarRouter.delete("/events/:id", requirePermission("calendar.manage"), async (req, res) => {
  const parsed = z
    .object({ occurrence: day.optional(), mode: z.enum(["one", "following", "all"]).default("all") })
    .safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Pick which occurrence." });
  const { occurrence, mode } = parsed.data;

  const event = await editableEvent(req, Number(req.params.id));
  if (!event) return res.status(404).json({ error: "That isn't on a calendar you can change." });

  if (event.recurrence && occurrence && mode !== "all" && !(mode === "following" && occurrence <= event.startDate)) {
    const set =
      mode === "one"
        ? { exceptions: [...new Set([...event.exceptions, occurrence])] }
        : { recurrence: { ...event.recurrence, until: addDays(occurrence, -1), count: null } };
    await db.update(calendarEvents).set({ ...set, updatedAt: new Date() }).where(eq(calendarEvents.id, event.id));
    await logChange(
      req,
      "calendar.event.removed",
      { ...event, startDate: occurrence, endDate: occurrence },
      `${req.user!.name} removed ${mode === "one" ? `${occurrence} from` : `everything from ${occurrence} on in`} the ${describe(event)}.`,
    );
    return res.json({ ok: true });
  }

  await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));
  await logChange(req, "calendar.event.removed", event, `${req.user!.name} removed the ${describe(event)} from the calendar.`);
  res.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/*  Attendance                                                                 */
/* -------------------------------------------------------------------------- */

/** The attendance picture for a view: per day, and per learner. */
calendarRouter.get("/attendance", requirePermission("attendance.read"), async (req, res) => {
  const range = parseRange(req);
  if ("error" in range) return res.status(400).json({ error: range.error });
  const { from, to, target } = range.data;
  const academyId = req.user!.academyId;
  try {
    const lens = await resolveLens(academyId, requireScope(req), defaultView(req, range.data.view), target ?? null);
    res.json({ label: lens.label, ...(await attendanceOverview(academyId, lens, from, to)) });
  } catch (error) {
    if (error instanceof CalendarLensError) return res.status(400).json({ error: error.message });
    throw error;
  }
});

/** A learner a guide may record attendance for: one in a studio they can open. */
async function recordableLearner(req: Request, userId: number) {
  const scope = requireScope(req);
  const [learner] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.academyId, req.user!.academyId), eq(users.active, true)))
    .limit(1);
  if (!learner) return null;
  if (req.user!.role !== "admin" && !(learner.studioId !== null && scope.allowedIds.includes(learner.studioId))) {
    return null;
  }
  return learner;
}

/**
 * A guide recording an absence for a learner - the morning someone calls in
 * rather than logging it themselves. It lands in the same place as the
 * learner's own, so Tac-Ons that read attendance see it too.
 */
calendarRouter.post("/attendance/absences", requirePermission("calendar.manage"), async (req, res) => {
  const parsed = z
    .object({
      userId: z.number().int(),
      day,
      kind: z.enum(["sick", "other"]).default("sick"),
      note: z.string().max(300).nullable().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Pick a learner and a day." });
  const learner = await recordableLearner(req, parsed.data.userId);
  if (!learner) return res.status(404).json({ error: "That isn't a learner you can record for." });

  const note = parsed.data.note?.trim() || null;
  await db
    .insert(absences)
    .values({ academyId: learner.academyId, userId: learner.id, day: parsed.data.day, kind: parsed.data.kind, note })
    .onConflictDoUpdate({ target: [absences.userId, absences.day], set: { kind: parsed.data.kind, note } });

  await logActivity({
    academyId: learner.academyId,
    studioId: learner.studioId,
    actorUserId: req.user!.id,
    action: "attendance.absence.recorded",
    entityType: "user",
    entityId: learner.id,
    summary: `${req.user!.name} recorded ${learner.name} as ${parsed.data.kind === "sick" ? "out sick" : "away"} on ${parsed.data.day}.`,
  });
  res.status(201).json({ ok: true });
});

calendarRouter.delete("/attendance/absences/:userId/:day", requirePermission("calendar.manage"), async (req, res) => {
  if (!isDay(req.params.day)) return res.status(400).json({ error: "That isn't a day." });
  const learner = await recordableLearner(req, Number(req.params.userId));
  if (!learner) return res.status(404).json({ error: "That isn't a learner you can record for." });
  await db.delete(absences).where(and(eq(absences.userId, learner.id), eq(absences.day, req.params.day)));
  await logActivity({
    academyId: learner.academyId,
    studioId: learner.studioId,
    actorUserId: req.user!.id,
    action: "attendance.absence.cleared",
    entityType: "user",
    entityId: learner.id,
    summary: `${req.user!.name} marked ${learner.name} as in on ${req.params.day}.`,
  });
  res.json({ ok: true });
});

