import type { CalendarKind } from "@shared/schema";

/** Same order as CALENDAR_KINDS; listed here so the client never bundles the schema. */
export const CALENDAR_KIND_LIST: readonly CalendarKind[] = [
  "event",
  "session",
  "break",
  "field_trip",
  "exhibition",
  "launch",
  "deadline",
];

/** One line under the kind picker on what each kind is for. */
export const KIND_HINTS: Record<CalendarKind, string> = {
  event: "Anything with a day and maybe a time.",
  session: "A run of weeks with a Quest. Shown as a band across every week it covers.",
  break: "Days nobody is expected in. Attendance skips them.",
  field_trip: "A trip out. Add where to meet and what to bring.",
  exhibition: "Where learners show their work to real outside adults.",
  launch: "A Socratic discussion or a Quest's Spark.",
  deadline: "A day something is due: a badge, a contract, an application.",
};
