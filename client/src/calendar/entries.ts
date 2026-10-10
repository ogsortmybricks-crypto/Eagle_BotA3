import { KIND_COLORS } from "@shared/calendar";
import { localDayOf, localTimeOf, itemColor, type CalendarItem, type LinkedItem, type TaconEntry } from "./types";

/**
 * What every view draws: a calendar entry or a linked Town Hall / election,
 * flattened to the same shape so the views don't care which.
 */
export type Entry = {
  key: string;
  title: string;
  start: string;
  end: string;
  startTime: string | null;
  endTime: string | null;
  color: string;
  item: CalendarItem | null;
  linked: LinkedItem | null;
  tacon?: TaconEntry | null;
};

export type Interaction = {
  canEdit: boolean;
  onOpen: (entry: Entry) => void;
  /** Create on a day range, optionally with times. */
  onCreate: (draft: { startDate: string; endDate: string; startTime?: string; endTime?: string }) => void;
  /** Dragged to a new first day, and optionally a new start time. */
  onMove: (entry: Entry, startDate: string, startTime?: string) => void;
  onDay: (day: string) => void;
};

export function toEntries(
  items: CalendarItem[],
  linked: LinkedItem[],
  byStudio: boolean,
  tacons: TaconEntry[] = [],
): Entry[] {
  return [
    ...tacons.map((entry) => ({
      key: entry.key,
      title: entry.title,
      start: entry.start,
      end: entry.end,
      startTime: entry.startTime,
      endTime: null,
      color: entry.color ?? KIND_COLORS[entry.kind] ?? "#64748b",
      item: null,
      linked: null,
      tacon: entry,
    })),
    ...items
      .filter((item) => item.kind !== "session")
      .map((item) => ({
        key: item.key,
        title: item.title,
        start: item.occurrenceStart,
        end: item.occurrenceEnd,
        startTime: item.startTime,
        endTime: item.endTime,
        color: itemColor(item, byStudio),
        item,
        linked: null,
      })),
    ...linked.map((entry) => {
      const day = localDayOf(entry.at);
      const time = localTimeOf(entry.at);
      return {
        key: entry.key,
        title: entry.title,
        start: day,
        end: day,
        startTime: time,
        endTime: null,
        color: entry.color ?? "#64748b",
        item: null,
        linked: entry,
      };
    }),
  ];
}

/** Multi-day things and all-day things go in the lanes; timed single-day ones are dots. */
export const isBar = (entry: Entry) => entry.start !== entry.end || !entry.startTime;

/** Sessions covering each day, for the bands. */
export function sessionsOn(items: CalendarItem[], day: string): CalendarItem[] {
  return items.filter((item) => item.kind === "session" && item.occurrenceStart <= day && item.occurrenceEnd >= day);
}

/** Breaks covering a day, for the shading. */
export function breaksOn(items: CalendarItem[], day: string): CalendarItem[] {
  return items.filter((item) => item.kind === "break" && item.occurrenceStart <= day && item.occurrenceEnd >= day);
}

/** A session as an Entry, so it can be opened and dragged like anything else. */
export function sessionEntry(item: CalendarItem, color: string): Entry {
  return {
    key: item.key,
    title: item.title,
    start: item.occurrenceStart,
    end: item.occurrenceEnd,
    startTime: null,
    endTime: null,
    color,
    item,
    linked: null,
  };
}

/** Readable text on a coloured chip. */
export function textOn(hex: string): string {
  const clean = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? "#111827" : "#ffffff";
}

/** A soft tint of a colour for backgrounds. */
export function tint(hex: string, alpha = 0.14): string {
  const clean = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
