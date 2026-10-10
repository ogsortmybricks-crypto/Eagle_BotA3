import { and, eq, gte, inArray, isNotNull, isNull, lte, or, type SQL } from "drizzle-orm";
import { db } from "./db";
import {
  absences,
  calendarEvents,
  studioGroups,
  users,
  type CalendarEvent,
  type Studio,
  type StudioGroup,
} from "@shared/schema";
import { eachDay, occurrences, weekday } from "@shared/calendar";
import { listStudios, type StudioScope } from "./studio";

/**
 * The studio calendar's reads.
 *
 * A calendar entry belongs to a studio, a studio group, or the whole academy,
 * and a view is one of those three too. Looking at Middle Studio shows
 * Middle's own entries, its group's, and the academy's. Looking at the group
 * adds every studio in it. Looking at the academy shows everything the
 * person can read.
 */

export const CALENDAR_VIEWS = ["studio", "group", "academy"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

/** What a view covers, worked out once and handed to every query. */
export type CalendarLens = {
  view: CalendarView;
  /** The studio or group being looked at; null for the academy. */
  targetId: number | null;
  label: string;
  studioIds: number[];
  groupIds: number[];
  /** Every studio in the academy, archived ones included, for labelling. */
  studios: Studio[];
  groups: StudioGroup[];
};

export class CalendarLensError extends Error {}

/**
 * Resolves a requested view against what this person may read. Asking for a
 * studio you can't see is an error, not a silent fallback: a calendar that
 * quietly showed a different studio's field trips would be worse than none.
 */
export async function resolveLens(
  academyId: number,
  scope: StudioScope,
  view: CalendarView,
  targetId: number | null,
): Promise<CalendarLens> {
  const studios = await listStudios(academyId, true);
  const live = studios.filter((studio) => !studio.archived);
  const groups = await db.select().from(studioGroups).where(eq(studioGroups.academyId, academyId));
  const readable = scope.canSeeAll ? live.map((studio) => studio.id) : scope.readableIds;

  if (view === "studio") {
    const id = targetId ?? scope.studioId;
    const studio = live.find((entry) => entry.id === id);
    if (!studio || !readable.includes(studio.id)) {
      throw new CalendarLensError("Pick a studio you can open.");
    }
    return {
      view,
      targetId: studio.id,
      label: studio.name,
      studioIds: [studio.id],
      groupIds: studio.groupId !== null ? [studio.groupId] : [],
      studios,
      groups,
    };
  }

  if (view === "group") {
    const fallback = live.find((entry) => entry.id === scope.studioId)?.groupId ?? null;
    const group = groups.find((entry) => entry.id === (targetId ?? fallback));
    const members = live.filter((studio) => group && studio.groupId === group.id).map((studio) => studio.id);
    if (!group || !members.some((id) => readable.includes(id))) {
      throw new CalendarLensError("Pick a studio group you're part of.");
    }
    return { view, targetId: group.id, label: group.name, studioIds: members, groupIds: [group.id], studios, groups };
  }

  const groupIds = groups
    .filter((group) => live.some((studio) => studio.groupId === group.id && readable.includes(studio.id)))
    .map((group) => group.id);
  return { view, targetId: null, label: "Whole academy", studioIds: readable, groupIds, studios, groups };
}

/** The where-clause for entries a lens covers: its studios, its groups, and the academy's. */
function lensFilter(lens: CalendarLens): SQL {
  const academyWide = and(isNull(calendarEvents.studioId), isNull(calendarEvents.groupId))!;
  const parts: SQL[] = [academyWide];
  if (lens.studioIds.length > 0) parts.push(inArray(calendarEvents.studioId, lens.studioIds));
  if (lens.groupIds.length > 0) parts.push(inArray(calendarEvents.groupId, lens.groupIds));
  return or(...parts)!;
}

/** Entries whose series could touch [from, to]. Recurring ones are filtered after expansion. */
export async function eventsInRange(
  academyId: number,
  lens: CalendarLens,
  from: string,
  to: string,
): Promise<CalendarEvent[]> {
  return db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.academyId, academyId),
        lte(calendarEvents.startDate, to),
        or(gte(calendarEvents.endDate, from), isNotNull(calendarEvents.recurrence)),
        lensFilter(lens),
      ),
    )
    .orderBy(calendarEvents.startDate, calendarEvents.startTime);
}

/** One appearance of an entry, as every view and Tac-On reads it. */
export type CalendarItem = CalendarEvent & {
  /** Unique per occurrence: "12" or "12@2026-10-14". */
  key: string;
  occurrenceStart: string;
  occurrenceEnd: string;
  ownerLabel: string;
  ownerColor: string | null;
};

export function expand(events: CalendarEvent[], lens: CalendarLens, from: string, to: string): CalendarItem[] {
  const items: CalendarItem[] = [];
  for (const event of events) {
    const owner = ownerOf(event, lens);
    for (const occurrence of occurrences(event, from, to)) {
      items.push({
        ...event,
        key: event.recurrence ? `${event.id}@${occurrence.start}` : String(event.id),
        occurrenceStart: occurrence.start,
        occurrenceEnd: occurrence.end,
        ownerLabel: owner.label,
        ownerColor: owner.color,
      });
    }
  }
  return items.sort(
    (a, b) =>
      a.occurrenceStart.localeCompare(b.occurrenceStart) ||
      (a.startTime ?? "").localeCompare(b.startTime ?? ""),
  );
}

export function ownerOf(
  event: Pick<CalendarEvent, "studioId" | "groupId">,
  lens: Pick<CalendarLens, "studios" | "groups">,
): { label: string; color: string | null } {
  if (event.studioId !== null) {
    const studio = lens.studios.find((entry) => entry.id === event.studioId);
    return { label: studio?.name ?? "A studio", color: studio?.color ?? null };
  }
  if (event.groupId !== null) {
    return { label: lens.groups.find((entry) => entry.id === event.groupId)?.name ?? "A group", color: null };
  }
  return { label: "Whole academy", color: null };
}

/* -------------------------------------------------------------------------- */
/*  Attendance                                                                 */
/* -------------------------------------------------------------------------- */

export type AttendanceDay = {
  day: string;
  expected: number;
  absent: number;
  /** True when every learner in view is on a break. */
  isBreak: boolean;
  absentees: { userId: number; name: string; kind: "sick" | "other"; note: string | null }[];
};

export type AttendanceLearner = {
  id: number;
  name: string;
  avatarUrl: string | null;
  studioId: number | null;
  expected: number;
  absent: number;
  sick: number;
  other: number;
};

/**
 * Who was expected in, and who wasn't, for every day in [from, to].
 *
 * Expected means: the learner's own attendance days (an account setting), not
 * a break that covers their studio. Absences are what learners record
 * themselves, plus anything a guide records for them.
 */
export async function attendanceOverview(academyId: number, lens: CalendarLens, from: string, to: string) {
  const learners =
    lens.studioIds.length === 0
      ? []
      : await db
          .select()
          .from(users)
          .where(
            and(
              eq(users.academyId, academyId),
              eq(users.active, true),
              eq(users.role, "learner"),
              inArray(users.studioId, lens.studioIds),
            ),
          )
          .orderBy(users.name);

  const ids = learners.map((learner) => learner.id);
  const missed =
    ids.length === 0
      ? []
      : await db
          .select()
          .from(absences)
          .where(and(inArray(absences.userId, ids), gte(absences.day, from), lte(absences.day, to)));

  const breaks = expand(
    (await eventsInRange(academyId, lens, from, to)).filter((event) => event.kind === "break"),
    lens,
    from,
    to,
  );

  /** Does a break entry cover a learner in this studio? */
  const covers = (item: CalendarItem, studioId: number | null) => {
    if (item.studioId === null && item.groupId === null) return true;
    if (item.studioId !== null) return item.studioId === studioId;
    return lens.studios.some((studio) => studio.id === studioId && studio.groupId === item.groupId);
  };
  const onBreak = (day: string, studioId: number | null) =>
    breaks.some((item) => item.occurrenceStart <= day && item.occurrenceEnd >= day && covers(item, studioId));

  const days = eachDay(from, to);
  const perDay: AttendanceDay[] = days.map((day) => ({ day, expected: 0, absent: 0, isBreak: false, absentees: [] }));
  const perLearner: AttendanceLearner[] = [];

  for (const learner of learners) {
    const row: AttendanceLearner = {
      id: learner.id,
      name: learner.name,
      avatarUrl: learner.avatarUrl,
      studioId: learner.studioId,
      expected: 0,
      absent: 0,
      sick: 0,
      other: 0,
    };
    days.forEach((day, index) => {
      if (!(learner.attendanceDays ?? []).includes(weekday(day))) return;
      if (onBreak(day, learner.studioId)) return;
      row.expected += 1;
      perDay[index].expected += 1;
      const absence = missed.find((entry) => entry.userId === learner.id && entry.day === day);
      if (absence) {
        row.absent += 1;
        row[absence.kind === "sick" ? "sick" : "other"] += 1;
        perDay[index].absent += 1;
        perDay[index].absentees.push({
          userId: learner.id,
          name: learner.name,
          kind: absence.kind,
          note: absence.note,
        });
      }
    });
    perLearner.push(row);
  }

  for (const entry of perDay) {
    entry.isBreak = learners.length > 0 ? learners.every((learner) => onBreak(entry.day, learner.studioId)) : breaks.some((item) => item.occurrenceStart <= entry.day && item.occurrenceEnd >= entry.day);
  }

  return { days: perDay, learners: perLearner };
}
