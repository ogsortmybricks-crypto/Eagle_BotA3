import type { CalendarKind, CalendarRecurrence } from "./schema";

/**
 * Calendar date math, shared by the server (attendance, Tac-Ons) and the
 * client (every view).
 *
 * Days are "YYYY-MM-DD" strings throughout. A field trip is on the 14th for
 * everyone reading it, whatever their timezone, so nothing here ever goes
 * near a local Date - all arithmetic is done at UTC noon.
 */

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const KIND_LABELS: Record<CalendarKind, string> = {
  event: "Event",
  session: "Session",
  break: "Break",
  field_trip: "Field trip",
  exhibition: "Exhibition",
  launch: "Launch",
  deadline: "Deadline",
};

/** Default colours when an entry doesn't set its own and isn't tinted by a studio. */
export const KIND_COLORS: Record<CalendarKind, string> = {
  event: "#3b82f6",
  session: "#8b5cf6",
  break: "#94a3b8",
  field_trip: "#10b981",
  exhibition: "#f59e0b",
  launch: "#ec4899",
  deadline: "#ef4444",
};

export function isDay(value: string): boolean {
  if (!DAY_RE.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function toDate(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

function toDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const date = toDate(day);
  date.setUTCDate(date.getUTCDate() + n);
  return toDay(date);
}

/** Adds months, clamping to the end of a shorter month (Jan 31 + 1 = Feb 28). */
export function addMonths(day: string, n: number): string {
  const date = toDate(day);
  const wanted = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + n);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12)).getUTCDate();
  date.setUTCDate(Math.min(wanted, last));
  return toDay(date);
}

/** Whole days from a to b. */
export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekday(day: string): number {
  return toDate(day).getUTCDay();
}

export function startOfWeek(day: string, weekStartsOn = 0): string {
  return addDays(day, -((weekday(day) - weekStartsOn + 7) % 7));
}

export function startOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export function endOfMonth(day: string): string {
  return addDays(addMonths(startOfMonth(day), 1), -1);
}

/** Every day from `from` to `to`, inclusive. */
export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/** Today in the viewer's own timezone, which is the day they mean by "today". */
export function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function timeOf(minutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, minutes));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}`;
}

/* -------------------------------------------------------------------------- */
/*  Occurrences                                                                */
/* -------------------------------------------------------------------------- */

/** The bits of a calendar entry recurrence needs. */
export type Repeatable = {
  startDate: string;
  endDate: string;
  recurrence: CalendarRecurrence | null;
  exceptions: string[];
};

/** One concrete appearance of an entry: the series start day and its span. */
export type Occurrence = { start: string; end: string };

/** A hard ceiling so a daily series with no end can't run away. */
const MAX_OCCURRENCES = 1000;

/**
 * Every occurrence of `entry` that overlaps [from, to].
 *
 * A one-off entry has one occurrence. A recurring one repeats its whole span
 * (a three-day trip repeats as three days) starting on each matching day.
 */
export function occurrences(entry: Repeatable, from: string, to: string): Occurrence[] {
  const span = Math.max(0, daysBetween(entry.startDate, entry.endDate));
  const overlaps = (start: string) => start <= to && addDays(start, span) >= from;
  const rule = entry.recurrence;

  if (!rule) {
    return overlaps(entry.startDate) ? [{ start: entry.startDate, end: entry.endDate }] : [];
  }

  const skip = new Set(entry.exceptions ?? []);
  const interval = Math.max(1, rule.interval || 1);
  const out: Occurrence[] = [];
  let produced = 0;

  const accept = (start: string): boolean => {
    if (rule.until && start > rule.until) return false;
    if (rule.count && produced >= rule.count) return false;
    produced += 1;
    if (!skip.has(start) && overlaps(start)) out.push({ start, end: addDays(start, span) });
    return true;
  };

  if (rule.freq === "weekly") {
    const days = rule.weekdays.length > 0 ? [...rule.weekdays].sort() : [weekday(entry.startDate)];
    let week = startOfWeek(entry.startDate);
    for (let guard = 0; guard < MAX_OCCURRENCES; guard += 1) {
      if (week > to) break;
      for (const wd of days) {
        const start = addDays(week, wd);
        if (start < entry.startDate) continue;
        if (start > to) break;
        if (!accept(start)) return out;
      }
      week = addDays(week, 7 * interval);
    }
    return out;
  }

  // With no count to keep, skip straight to just before the range, so a daily
  // entry that started years ago still shows today.
  let first = 0;
  if (!rule.count && entry.startDate < from) {
    if (rule.freq === "daily") {
      first = Math.max(0, Math.floor((daysBetween(entry.startDate, from) - span) / interval) - 1);
    } else {
      const months =
        (Number(from.slice(0, 4)) - Number(entry.startDate.slice(0, 4))) * 12 +
        (Number(from.slice(5, 7)) - Number(entry.startDate.slice(5, 7)));
      first = Math.max(0, Math.floor((months - Math.ceil(span / 28) - 1) / interval));
    }
  }
  for (let i = first; i < first + MAX_OCCURRENCES; i += 1) {
    const start =
      rule.freq === "daily" ? addDays(entry.startDate, i * interval) : addMonths(entry.startDate, i * interval);
    if (start > to) break;
    if (!accept(start)) break;
  }
  return out;
}

/** A human summary of a repeat rule: "Every 2 weeks on Mon, Wed until 2026-12-18". */
export function describeRecurrence(rule: CalendarRecurrence | null): string {
  if (!rule) return "Does not repeat";
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const unit = { daily: "day", weekly: "week", monthly: "month" }[rule.freq];
  let text = rule.interval > 1 ? `Every ${rule.interval} ${unit}s` : `Every ${unit}`;
  if (rule.freq === "weekly" && rule.weekdays.length > 0) {
    text += ` on ${[...rule.weekdays].sort().map((day) => names[day]).join(", ")}`;
  }
  if (rule.until) text += ` until ${rule.until}`;
  else if (rule.count) text += `, ${rule.count} times`;
  return text;
}

/**
 * Which week of a session a day falls in, counting from 1. Sessions are how
 * an Acton year is paced, so "Week 3 of Session 2" is the phrase people use.
 */
export function sessionWeek(sessionStart: string, day: string, weekStartsOn = 0): number {
  return Math.floor(daysBetween(startOfWeek(sessionStart, weekStartsOn), day) / 7) + 1;
}

/** A weekly rule's weekdays, moved along by `shift` days. */
export function shiftWeekdays(rule: CalendarRecurrence, shift: number): CalendarRecurrence {
  if (rule.freq !== "weekly" || rule.weekdays.length === 0 || shift % 7 === 0) return rule;
  return { ...rule, weekdays: [...new Set(rule.weekdays.map((day) => (((day + shift) % 7) + 7) % 7))].sort() };
}
