import { useEffect, useState } from "react";
import { addDays, daysBetween, eachDay, localToday, sessionWeek } from "@shared/calendar";
import { clipToRow, packLanes } from "./layout";
import { breaksOn, isBar, sessionEntry, textOn, tint, type Entry, type Interaction } from "./entries";
import { formatDay, formatTime, itemColor, type CalendarItem } from "./types";

const MAX_LANES = 3;
export const DRAG_TYPE = "application/x-eagle-calendar";

/**
 * How far into an entry it was picked up: grab a three-day trip by its last
 * day and drop it one day on, and it should move one day, not three.
 */
export const dragGrab = { days: 0, minutes: 0 };

export function beginDrag(event: React.DragEvent, key: string, grab: { days?: number; minutes?: number } = {}) {
  event.dataTransfer.setData(DRAG_TYPE, key);
  event.dataTransfer.effectAllowed = "move";
  dragGrab.days = grab.days ?? 0;
  dragGrab.minutes = grab.minutes ?? 0;
  // Let drops reach the day underneath whatever is drawn on it. Changing the
  // page during dragstart can cancel the drag in Chrome, so wait a tick.
  window.setTimeout(() => document.documentElement.classList.add("cal-dragging"), 0);
}

export function endDrag() {
  window.setTimeout(() => document.documentElement.classList.remove("cal-dragging"), 0);
}

/** Which of `days` is under the pointer, for a bar spanning columns `start`..`end`. */
export function dayUnderPointer(event: React.DragEvent, days: string[], start: number, end: number): string {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const span = end - start + 1;
  const index = Math.min(span - 1, Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * span)));
  return days[start + index];
}

/** The six-week grid for the month containing `cursor`. */
export function monthGrid(cursor: string, weekStartsOn: number): string[] {
  const first = `${cursor.slice(0, 7)}-01`;
  const offset = (new Date(`${first}T12:00:00Z`).getUTCDay() - weekStartsOn + 7) % 7;
  const start = addDays(first, -offset);
  return eachDay(start, addDays(start, 41));
}

export function MonthView({
  cursor,
  weekStartsOn,
  entries,
  items,
  byStudio,
  interaction,
}: {
  cursor: string;
  weekStartsOn: number;
  entries: Entry[];
  items: CalendarItem[];
  byStudio: boolean;
  interaction: Interaction;
}) {
  const days = monthGrid(cursor, weekStartsOn);
  const weeks = Array.from({ length: 6 }, (_, index) => days.slice(index * 7, index * 7 + 7));
  const month = cursor.slice(0, 7);
  const today = localToday();

  // Drag across days to create something spanning them: a trip, a break, a session.
  const [selecting, setSelecting] = useState<{ from: string; to: string } | null>(null);
  useEffect(() => {
    if (!selecting) return;
    const finish = () => {
      const [startDate, endDate] = [selecting.from, selecting.to].sort();
      setSelecting(null);
      interaction.onCreate({ startDate, endDate });
    };
    window.addEventListener("mouseup", finish);
    return () => window.removeEventListener("mouseup", finish);
  }, [selecting, interaction]);
  const selected = (day: string) => {
    if (!selecting) return false;
    const [a, b] = [selecting.from, selecting.to].sort();
    return day >= a && day <= b;
  };

  const sessions = items.filter((item) => item.kind === "session");
  const findEntry = (key: string): Entry | undefined => {
    const found = entries.find((candidate) => candidate.key === key);
    if (found) return found;
    const session = sessions.find((item) => item.key === key);
    return session ? sessionEntry(session, itemColor(session, byStudio)) : undefined;
  };

  return (
    <div className="card overflow-hidden select-none">
      <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">
        {weeks[0].map((day) => (
          <div key={day} className="py-2">
            {formatDay(day, { weekday: "short" })}
          </div>
        ))}
      </div>

      {weeks.map((week) => {
        const bars = packLanes(
          entries
            .filter(isBar)
            .map((entry) => ({ entry, clip: clipToRow(entry.start, entry.end, week) }))
            .filter((row): row is { entry: Entry; clip: { start: number; end: number } } => row.clip !== null)
            .map((row) => ({ item: row.entry, ...row.clip })),
        );
        const dots = week.map((day) =>
          entries
            .filter((entry) => !isBar(entry) && entry.start === day)
            .sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? "")),
        );
        const weekSessions = sessions
          .map((item) => ({ item, clip: clipToRow(item.occurrenceStart, item.occurrenceEnd, week) }))
          .filter((row): row is { item: CalendarItem; clip: { start: number; end: number } } => row.clip !== null);

        // How many entries didn't fit on each day.
        const hidden = week.map((_, column) => {
          const overflowBars = bars.filter((bar) => bar.lane >= MAX_LANES && bar.start <= column && bar.end >= column).length;
          const usedLanes = Math.min(
            MAX_LANES,
            bars.filter((bar) => bar.start <= column && bar.end >= column).reduce((max, bar) => Math.max(max, bar.lane + 1), 0),
          );
          const dotRoom = Math.max(0, MAX_LANES - usedLanes);
          return overflowBars + Math.max(0, dots[column].length - dotRoom);
        });

        return (
          <div key={week[0]} className="relative min-h-[7.5rem] border-b border-gray-200 last:border-b-0">
            {/* Day cells: the background, the drop targets, the drag-to-create surface. */}
            <div className="absolute inset-0 grid grid-cols-7">
              {week.map((day) => {
                const isBreak = breaksOn(items, day).length > 0;
                return (
                  <div
                    key={day}
                    className={`border-r border-gray-100 last:border-r-0 ${day.slice(0, 7) !== month ? "bg-gray-50/70" : ""} ${
                      selected(day) ? "!bg-brand-100" : ""
                    }`}
                    style={
                      isBreak
                        ? { backgroundImage: "repeating-linear-gradient(135deg, rgba(148,163,184,0.16) 0 6px, transparent 6px 12px)" }
                        : undefined
                    }
                    onMouseDown={(event) => {
                      if (!interaction.canEdit || event.button !== 0) return;
                      setSelecting({ from: day, to: day });
                    }}
                    onMouseEnter={() => selecting && setSelecting({ ...selecting, to: day })}
                    onDoubleClick={() => !interaction.canEdit && interaction.onDay(day)}
                    onDragOver={(event) => {
                      if (event.dataTransfer.types.includes(DRAG_TYPE)) event.preventDefault();
                    }}
                    onDrop={(event) => {
                      endDrag();
                      const entry = findEntry(event.dataTransfer.getData(DRAG_TYPE));
                      if (entry) interaction.onMove(entry, addDays(day, -dragGrab.days));
                    }}
                  />
                );
              })}
            </div>

            {/* Foreground: numbers, session bands, bars, dots. */}
            <div className="pointer-events-none relative grid grid-cols-7 gap-y-0.5 pb-1">
              {week.map((day, column) => (
                <div key={day} className="flex justify-center pt-1" style={{ gridColumn: column + 1, gridRow: 1 }}>
                  <button
                    onClick={() => interaction.onDay(day)}
                    onMouseDown={(event) => event.stopPropagation()}
                    className={`cal-fg pointer-events-auto flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-medium transition hover:bg-gray-200 ${
                      day === today ? "bg-brand-600 text-white hover:bg-brand-700" : day.slice(0, 7) === month ? "text-gray-800" : "text-gray-400"
                    }`}
                  >
                    {day.endsWith("-01") ? formatDay(day, { month: "short", day: "numeric" }) : Number(day.slice(8))}
                  </button>
                </div>
              ))}

              {weekSessions.map(({ item, clip }, index) => {
                const color = itemColor(item, byStudio);
                const entry = sessionEntry(item, color);
                return (
                  <Chip
                    key={item.key}
                    entry={entry}
                    interaction={interaction}
                    grabDays={(event) => daysBetween(item.occurrenceStart, dayUnderPointer(event, week, clip.start, clip.end))}
                    className="mx-0.5 !text-[10px] font-semibold !leading-4"
                    style={{ gridColumn: `${clip.start + 1} / ${clip.end + 2}`, gridRow: 2 + index, background: tint(color, 0.18), color }}
                    title={item.quest ? `${item.title} — Quest: ${item.quest}` : item.title}
                  >
                    {item.title} · Wk {sessionWeek(item.occurrenceStart, week[clip.start], weekStartsOn)}
                    {item.quest && <span className="font-normal"> · {item.quest}</span>}
                  </Chip>
                );
              })}

              {bars
                .filter((bar) => bar.lane < MAX_LANES)
                .map((bar) => {
                  const entry = bar.item;
                  const continuesLeft = entry.start < week[bar.start];
                  const continuesRight = entry.end > week[bar.end];
                  return (
                    <Chip
                      key={`${entry.key}-${week[0]}`}
                      entry={entry}
                      interaction={interaction}
                      grabDays={(event) => daysBetween(entry.start, dayUnderPointer(event, week, bar.start, bar.end))}
                      className={`mx-0.5 ${continuesLeft ? "rounded-l-none" : ""} ${continuesRight ? "rounded-r-none" : ""}`}
                      style={{
                        gridColumn: `${bar.start + 1} / ${bar.end + 2}`,
                        gridRow: 2 + weekSessions.length + bar.lane,
                        background: entry.color,
                        color: textOn(entry.color),
                      }}
                    >
                      {entry.startTime && <span className="opacity-80">{formatTime(entry.startTime)} </span>}
                      {entry.title}
                    </Chip>
                  );
                })}

              {week.map((_, column) => {
                const lanesUsed = bars
                  .filter((bar) => bar.start <= column && bar.end >= column && bar.lane < MAX_LANES)
                  .reduce((max, bar) => Math.max(max, bar.lane + 1), 0);
                const room = Math.max(0, MAX_LANES - lanesUsed);
                return dots[column].slice(0, room).map((entry, index) => (
                  <Chip
                    key={entry.key}
                    entry={entry}
                    interaction={interaction}
                    className="mx-0.5 bg-transparent hover:bg-gray-100"
                    style={{ gridColumn: column + 1, gridRow: 2 + weekSessions.length + lanesUsed + index, color: "#374151" }}
                  >
                    <span className="mr-1 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: entry.color }} />
                    {entry.startTime && <span className="text-gray-500">{formatTime(entry.startTime)} </span>}
                    {entry.title}
                  </Chip>
                ));
              })}

              {hidden.map((count, column) =>
                count > 0 ? (
                  <button
                    key={`more-${column}`}
                    onClick={() => interaction.onDay(week[column])}
                    onMouseDown={(event) => event.stopPropagation()}
                    className="cal-fg pointer-events-auto mx-1 rounded px-1 text-left text-[11px] font-semibold text-gray-600 hover:bg-gray-100"
                    style={{ gridColumn: column + 1, gridRow: 2 + weekSessions.length + MAX_LANES }}
                  >
                    {count} more
                  </button>
                ) : null,
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * One clickable, draggable entry. A div rather than a button: Firefox won't
 * start a drag from a button.
 */
export function Chip({
  entry,
  interaction,
  grabDays,
  className = "",
  style,
  title,
  children,
}: {
  entry: Entry;
  interaction: Interaction;
  /** Days from the entry's start to the point it was picked up by. */
  grabDays?: (event: React.DragEvent) => number;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  children: React.ReactNode;
}) {
  const draggable = interaction.canEdit && entry.item !== null;
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={draggable}
      onDragStart={(event) => beginDrag(event, entry.key, { days: grabDays?.(event) ?? 0 })}
      onDragEnd={endDrag}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={() => interaction.onOpen(entry)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          interaction.onOpen(entry);
        }
      }}
      className={`cal-fg pointer-events-auto flex min-w-0 cursor-pointer items-center truncate rounded px-1.5 text-left text-[11px] font-medium leading-5 ${className}`}
      style={style}
      title={title ?? entry.title}
    >
      <span className="truncate">{children}</span>
    </div>
  );
}
