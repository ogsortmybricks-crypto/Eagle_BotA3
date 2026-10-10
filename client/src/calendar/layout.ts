import { daysBetween, minutesOf } from "@shared/calendar";

/**
 * Packs spans into horizontal lanes, the way a month view stacks multi-day
 * bars: longest and earliest first, each into the first lane it fits.
 */
export type Span<T> = { item: T; start: number; end: number };
export type Placed<T> = Span<T> & { lane: number };

export function packLanes<T>(spans: Span<T>[]): Placed<T>[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const lanes: boolean[][] = [];
  const placed: Placed<T>[] = [];
  for (const span of sorted) {
    let lane = 0;
    for (; ; lane += 1) {
      if (!lanes[lane]) lanes[lane] = [];
      let free = true;
      for (let column = span.start; column <= span.end; column += 1) {
        if (lanes[lane][column]) {
          free = false;
          break;
        }
      }
      if (free) break;
    }
    for (let column = span.start; column <= span.end; column += 1) lanes[lane][column] = true;
    placed.push({ ...span, lane });
  }
  return placed;
}

/** Clips an inclusive day range to a row of `days`, as column indexes, or null if it misses. */
export function clipToRow(start: string, end: string, days: string[]): { start: number; end: number } | null {
  const first = days[0];
  const last = days[days.length - 1];
  if (end < first || start > last) return null;
  return {
    start: start < first ? 0 : daysBetween(first, start),
    end: end > last ? days.length - 1 : daysBetween(first, end),
  };
}

/**
 * Side-by-side columns for overlapping timed events in a day, so two things
 * at 10:00 sit next to each other rather than on top of each other.
 */
export type Timed<T> = { item: T; startMin: number; endMin: number };
export type TimedPlaced<T> = Timed<T> & { column: number; columns: number };

export function layoutTimed<T>(entries: Timed<T>[]): TimedPlaced<T>[] {
  const sorted = [...entries].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const out: TimedPlaced<T>[] = [];
  let cluster: TimedPlaced<T>[] = [];
  let clusterEnd = -1;
  let ends: number[] = [];

  const flush = () => {
    const width = Math.max(1, ends.length);
    for (const entry of cluster) entry.columns = width;
    out.push(...cluster);
    cluster = [];
    ends = [];
  };

  for (const entry of sorted) {
    if (entry.startMin >= clusterEnd && cluster.length > 0) {
      flush();
      clusterEnd = -1;
    }
    let column = ends.findIndex((end) => end <= entry.startMin);
    if (column === -1) {
      column = ends.length;
      ends.push(entry.endMin);
    } else {
      ends[column] = entry.endMin;
    }
    cluster.push({ ...entry, column, columns: 1 });
    clusterEnd = Math.max(clusterEnd, entry.endMin);
  }
  flush();
  return out;
}

export function minutesBetween(start: string, end: string): number {
  return Math.max(15, minutesOf(end) - minutesOf(start));
}
