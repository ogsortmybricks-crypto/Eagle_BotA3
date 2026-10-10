import type { CalendarKind, CalendarRecurrence } from "@shared/schema";
import { KIND_COLORS } from "@shared/calendar";

export type { CalendarKind, CalendarRecurrence };

export type CalendarView = "studio" | "group" | "academy";
export type ViewMode = "day" | "week" | "month" | "year" | "agenda";

/** One appearance of an entry, as the server expands it. */
export type CalendarItem = {
  id: number;
  key: string;
  kind: CalendarKind;
  title: string;
  description: string;
  location: string | null;
  quest: string | null;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  color: string | null;
  recurrence: CalendarRecurrence | null;
  exceptions: string[];
  studioId: number | null;
  groupId: number | null;
  occurrenceStart: string;
  occurrenceEnd: string;
  ownerLabel: string;
  ownerColor: string | null;
};

/** Town Halls and election deadlines: dated things from elsewhere in Eagle Bot. */
export type LinkedItem = {
  key: string;
  type: "town_hall" | "election";
  title: string;
  at: string;
  href: string;
  color: string | null;
};

/** A Tac-On's record, put on the calendar by its `calendar` block. Read-only here. */
export type TaconEntry = {
  key: string;
  title: string;
  start: string;
  end: string;
  startTime: string | null;
  kind: CalendarKind;
  color: string | null;
  installId: number;
  taconName: string;
  href: string | null;
};

export type CalendarGuide = {
  id: number;
  userId: number;
  name: string;
  avatarUrl: string | null;
  studioId: number | null;
  groupId: number | null;
};

export type CalendarResponse = {
  view: CalendarView;
  targetId: number | null;
  label: string;
  items: CalendarItem[];
  linked: LinkedItem[];
  tacons: TaconEntry[];
  guides: CalendarGuide[];
  studios: { id: number; name: string; color: string; groupId: number | null }[];
  groups: { id: number; name: string }[];
};

/** The colour an item is drawn in: its own, else its studio's, else its kind's. */
export function itemColor(item: Pick<CalendarItem, "color" | "ownerColor" | "kind">, byStudio: boolean): string {
  if (item.color) return item.color;
  if (byStudio && item.ownerColor) return item.ownerColor;
  return KIND_COLORS[item.kind];
}

export const isAllDay = (item: Pick<CalendarItem, "startTime">) => !item.startTime;

/** True when an item is on `day`. */
export const onDay = (item: Pick<CalendarItem, "occurrenceStart" | "occurrenceEnd">, day: string) =>
  item.occurrenceStart <= day && item.occurrenceEnd >= day;

/** What the editor opens with when creating. */
export type Draft = {
  startDate: string;
  endDate: string;
  startTime?: string | null;
  endTime?: string | null;
  kind?: CalendarKind;
};

/** Formats a day for headings using the browser's locale. */
export function formatDay(day: string, options: Intl.DateTimeFormatOptions): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", ...options });
}

/** "9:30 AM" or "09:30", whatever the locale prefers. */
export function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString(undefined, {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The local calendar day of an ISO timestamp. */
export function localDayOf(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function localTimeOf(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
