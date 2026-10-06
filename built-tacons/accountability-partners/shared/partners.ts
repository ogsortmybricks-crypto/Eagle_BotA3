/**
 * Accountability partners: the parts both sides of the wire agree on.
 *
 * The server stores check-in dates; the browser works out "this week" from the
 * viewer's own calendar so a learner in Pacific time doesn't see Friday's
 * check-in land on Saturday. Both use these helpers, so the weekly standing a
 * learner sees is the standing a guide sees.
 */

export type PartnersStoreKind = "config" | "groups" | "goals" | "checkins" | "shots" | "categories" | "assignments" | "certificates" | "profiles";

/** Reserved names cannot be declared as ordinary TacScript stores. */
export function partnersStore(name: string, kind: PartnersStoreKind): string {
  return `__partners_${name}_${kind}`;
}

export const ON_TRACK = ["on-track", "slightly-behind", "off-track"] as const;
export type OnTrack = (typeof ON_TRACK)[number];

export const ON_TRACK_LABELS: Record<OnTrack, string> = {
  "on-track": "On track",
  "slightly-behind": "A little behind",
  "off-track": "Off track",
};

export const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** The viewer's calendar date, as YYYY-MM-DD. */
export function localDay(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function addDays(day: string, count: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function weekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** Weeks run Monday to Sunday. */
export function weekStart(day: string): string {
  return addDays(day, -((weekday(day) + 6) % 7));
}

export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export type WeekStatus = "met" | "on-pace" | "behind" | "missed";

export type WeekStanding = {
  /** Distinct days with a check-in this week. */
  done: number;
  remaining: number;
  /** The required day, if any, and whether it has a check-in. */
  dueDay: string | null;
  dueMet: boolean;
  status: WeekStatus;
  /** One line a busy learner can act on. */
  summary: string;
};

/**
 * Where one partner stands on checking in on one counterpart for one week.
 * School days (Monday to Friday) are what's left to plan on; a weekend
 * check-in still counts if it happens.
 */
export function weekStanding(options: {
  days: string[];
  required: number;
  due: number | null;
  today: string;
  week: string;
}): WeekStanding {
  const week = weekDays(options.week);
  const checked = new Set(options.days.filter((day) => week.includes(day)));
  const done = checked.size;
  const remaining = Math.max(0, options.required - done);
  const dueDay = options.due === null ? null : week.find((day) => weekday(day) === options.due) ?? null;
  const dueMet = dueDay === null || checked.has(dueDay);
  const dueName = options.due === null ? "" : capitalize(WEEKDAYS[options.due]);
  const weekOver = options.today > week[6];

  if (remaining === 0 && dueMet) {
    return { done, remaining, dueDay, dueMet, status: "met", summary: "Requirement met for this week." };
  }
  if (weekOver || (dueDay !== null && !dueMet && options.today > dueDay)) {
    const why = !dueMet && dueDay !== null ? `no ${dueName} check-in` : `${done} of ${options.required} check-ins`;
    return { done, remaining, dueDay, dueMet, status: "missed", summary: `Requirement missed: ${why}.` };
  }

  const schoolDaysLeft = week.slice(0, 5).filter((day) => day >= options.today && !checked.has(day)).length;
  const needed = Math.max(remaining, dueMet ? 0 : 1);
  const including = !dueMet && dueName ? `, including ${dueName}` : "";
  const summary = `${needed} more check-in${needed === 1 ? "" : "s"} needed${including}.`;
  return {
    done,
    remaining,
    dueDay,
    dueMet,
    status: schoolDaysLeft >= needed ? "on-pace" : "behind",
    summary,
  };
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Screenshots arrive as data URLs; anything else is refused. */
export const SHOT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const SHOT_MAX_CHARS = 1_400_000;
export const SHOTS_PER_SUBJECT = 3;
