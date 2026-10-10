import { useEffect, useRef, useState } from "react";
import { addDays, daysBetween, localToday, minutesOf, sessionWeek, timeOf } from "@shared/calendar";
import { clipToRow, layoutTimed, packLanes } from "./layout";
import { breaksOn, sessionEntry, textOn, tint, type Entry, type Interaction } from "./entries";
import { beginDrag, Chip, dayUnderPointer, DRAG_TYPE, dragGrab, endDrag } from "./MonthView";
import { formatDay, formatTime, itemColor, type CalendarItem } from "./types";

const HOUR = 48;
const SNAP = 15;

/** Week and day views: an all-day strip on top, the hours below. */
export function TimeGridView({
  days,
  weekStartsOn,
  entries,
  items,
  byStudio,
  interaction,
}: {
  days: string[];
  weekStartsOn: number;
  entries: Entry[];
  items: CalendarItem[];
  byStudio: boolean;
  interaction: Interaction;
}) {
  const today = localToday();
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());

  // Open on the school day rather than midnight.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 7.5 * HOUR;
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const allDay = entries.filter((entry) => entry.start !== entry.end || !entry.startTime);
  const timed = entries.filter((entry) => entry.start === entry.end && entry.startTime);
  const bars = packLanes(
    allDay
      .map((entry) => ({ entry, clip: clipToRow(entry.start, entry.end, days) }))
      .filter((row): row is { entry: Entry; clip: { start: number; end: number } } => row.clip !== null)
      .map((row) => ({ item: row.entry, ...row.clip })),
  );
  const lanes = bars.reduce((max, bar) => Math.max(max, bar.lane + 1), 0);
  const sessions = items
    .filter((item) => item.kind === "session")
    .map((item) => ({ item, clip: clipToRow(item.occurrenceStart, item.occurrenceEnd, days) }))
    .filter((row): row is { item: CalendarItem; clip: { start: number; end: number } } => row.clip !== null);

  const findEntry = (key: string): Entry | undefined => {
    const found = entries.find((candidate) => candidate.key === key);
    if (found) return found;
    const session = sessions.find((row) => row.item.key === key)?.item;
    return session ? sessionEntry(session, itemColor(session, byStudio)) : undefined;
  };

  // Drag down an empty column to create a timed entry.
  const [selecting, setSelecting] = useState<{ day: string; from: number; to: number } | null>(null);
  useEffect(() => {
    if (!selecting) return;
    const finish = () => {
      const start = Math.min(selecting.from, selecting.to);
      const end = Math.max(selecting.from, selecting.to) + SNAP;
      setSelecting(null);
      interaction.onCreate({
        startDate: selecting.day,
        endDate: selecting.day,
        startTime: timeOf(start),
        endTime: timeOf(end - start < 30 ? start + 60 : end),
      });
    };
    window.addEventListener("mouseup", finish);
    return () => window.removeEventListener("mouseup", finish);
  }, [selecting, interaction]);

  const minuteAt = (event: React.MouseEvent | React.DragEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const minutes = ((event.clientY - rect.top) / HOUR) * 60;
    return Math.max(0, Math.min(24 * 60 - SNAP, Math.floor(minutes / SNAP) * SNAP));
  };

  const columns = `3.5rem repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="card overflow-hidden select-none">
      {/* Headings */}
      <div className="grid border-b border-gray-200" style={{ gridTemplateColumns: columns }}>
        <div />
        {days.map((day) => (
          <button
            key={day}
            onClick={() => interaction.onDay(day)}
            className="flex flex-col items-center py-2 text-xs hover:bg-gray-50"
          >
            <span className="font-semibold uppercase tracking-wide text-gray-500">{formatDay(day, { weekday: "short" })}</span>
            <span
              className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-lg font-semibold ${
                day === today ? "bg-brand-600 text-white" : "text-gray-800"
              }`}
            >
              {Number(day.slice(8))}
            </span>
          </button>
        ))}
      </div>

      {/* Sessions and all-day entries */}
      <div className="relative grid border-b border-gray-200 py-1" style={{ gridTemplateColumns: columns }}>
        <div className="row-span-full self-center pr-2 text-right text-[10px] uppercase tracking-wide text-gray-400" style={{ gridColumn: 1, gridRow: `1 / ${Math.max(2, sessions.length + lanes + 1)}` }}>
          all day
        </div>
        {days.map((day, index) => (
          <div
            key={day}
            className="border-l border-gray-100"
            style={{
              gridColumn: index + 2,
              gridRow: `1 / ${Math.max(2, sessions.length + lanes + 2)}`,
              minHeight: "1.75rem",
              backgroundImage: breaksOn(items, day).length
                ? "repeating-linear-gradient(135deg, rgba(148,163,184,0.16) 0 6px, transparent 6px 12px)"
                : undefined,
            }}
            onDoubleClick={() => interaction.canEdit && interaction.onCreate({ startDate: day, endDate: day })}
            onDragOver={(event) => event.dataTransfer.types.includes(DRAG_TYPE) && event.preventDefault()}
            onDrop={(event) => {
              endDrag();
              const entry = findEntry(event.dataTransfer.getData(DRAG_TYPE));
              if (entry) interaction.onMove(entry, addDays(day, -dragGrab.days));
            }}
          />
        ))}
        {sessions.map(({ item, clip }, index) => {
          const color = itemColor(item, byStudio);
          return (
            <Chip
              key={item.key}
              entry={sessionEntry(item, color)}
              interaction={interaction}
              grabDays={(event) => daysBetween(item.occurrenceStart, dayUnderPointer(event, days, clip.start, clip.end))}
              className="z-10 mx-0.5 font-semibold"
              style={{ gridColumn: `${clip.start + 2} / ${clip.end + 3}`, gridRow: index + 1, background: tint(color, 0.18), color }}
            >
              {item.title} · Week {sessionWeek(item.occurrenceStart, days[clip.start], weekStartsOn)}
              {item.quest && <span className="font-normal"> · Quest: {item.quest}</span>}
            </Chip>
          );
        })}
        {bars.map((bar) => (
          <Chip
            key={bar.item.key}
            entry={bar.item}
            interaction={interaction}
            grabDays={(event) => daysBetween(bar.item.start, dayUnderPointer(event, days, bar.start, bar.end))}
            className="z-10 mx-0.5"
            style={{
              gridColumn: `${bar.start + 2} / ${bar.end + 3}`,
              gridRow: sessions.length + bar.lane + 1,
              background: bar.item.color,
              color: textOn(bar.item.color),
            }}
          >
            {bar.item.title}
          </Chip>
        ))}
      </div>

      {/* Hours */}
      <div ref={scroller} className="max-h-[68vh] overflow-y-auto">
        <div className="relative grid" style={{ gridTemplateColumns: columns, height: 24 * HOUR }}>
          <div className="relative">
            {Array.from({ length: 24 }, (_, hour) => (
              <div key={hour} className="absolute right-2 -translate-y-1/2 text-[10px] text-gray-400" style={{ top: hour * HOUR }}>
                {hour === 0 ? "" : formatTime(timeOf(hour * 60))}
              </div>
            ))}
          </div>
          {days.map((day) => {
            const placed = layoutTimed(
              timed
                .filter((entry) => entry.start === day)
                .map((entry) => {
                  const startMin = minutesOf(entry.startTime!);
                  const endMin = entry.endTime ? Math.max(startMin + SNAP, minutesOf(entry.endTime)) : startMin + 30;
                  return { item: entry, startMin, endMin };
                }),
            );
            const sel = selecting?.day === day ? selecting : null;
            const nowMin = now.getHours() * 60 + now.getMinutes();
            return (
              <div
                key={day}
                className="relative border-l border-gray-100"
                style={{
                  backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 ${HOUR - 1}px, rgb(243 244 246) ${HOUR - 1}px ${HOUR}px)`,
                }}
                onMouseDown={(event) => {
                  if (!interaction.canEdit || event.button !== 0) return;
                  const minute = minuteAt(event);
                  setSelecting({ day, from: minute, to: minute });
                }}
                onMouseMove={(event) => sel && setSelecting({ ...sel, to: minuteAt(event) })}
                onDragOver={(event) => event.dataTransfer.types.includes(DRAG_TYPE) && event.preventDefault()}
                onDrop={(event) => {
                  endDrag();
                  const entry = findEntry(event.dataTransfer.getData(DRAG_TYPE));
                  if (entry) interaction.onMove(entry, day, timeOf(Math.max(0, minuteAt(event) - dragGrab.minutes)));
                }}
              >
                {sel && (
                  <div
                    className="pointer-events-none absolute inset-x-1 rounded bg-brand-200/70 px-1.5 text-[11px] font-medium text-brand-900"
                    style={{
                      top: (Math.min(sel.from, sel.to) / 60) * HOUR,
                      height: ((Math.abs(sel.to - sel.from) + SNAP) / 60) * HOUR,
                    }}
                  >
                    {formatTime(timeOf(Math.min(sel.from, sel.to)))}
                  </div>
                )}
                {placed.map((entry) => (
                  <div
                    key={entry.item.key}
                    role="button"
                    tabIndex={0}
                    draggable={interaction.canEdit && entry.item.item !== null}
                    onDragStart={(event) => {
                      // Grabbed by its middle, it should keep its place under the pointer.
                      const rect = event.currentTarget.getBoundingClientRect();
                      const minutes = Math.floor((((event.clientY - rect.top) / HOUR) * 60) / SNAP) * SNAP;
                      beginDrag(event, entry.item.key, { minutes });
                    }}
                    onDragEnd={endDrag}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={() => interaction.onOpen(entry.item)}
                    onKeyDown={(event) => event.key === "Enter" && interaction.onOpen(entry.item)}
                    className="cal-fg absolute cursor-pointer overflow-hidden rounded-md border border-white/60 px-1.5 py-0.5 text-left text-[11px] leading-tight shadow-sm"
                    style={{
                      top: (entry.startMin / 60) * HOUR,
                      height: Math.max(18, ((entry.endMin - entry.startMin) / 60) * HOUR - 2),
                      left: `calc(${(entry.column / entry.columns) * 100}% + 2px)`,
                      width: `calc(${100 / entry.columns}% - 4px)`,
                      background: entry.item.color,
                      color: textOn(entry.item.color),
                    }}
                    title={entry.item.title}
                  >
                    <div className="truncate font-semibold">{entry.item.title}</div>
                    <div className="truncate opacity-80">
                      {formatTime(entry.item.startTime!)}
                      {entry.item.endTime && ` – ${formatTime(entry.item.endTime)}`}
                      {entry.item.item?.location && ` · ${entry.item.item.location}`}
                    </div>
                  </div>
                ))}
                {day === today && (
                  <div className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-red-500" style={{ top: (nowMin / 60) * HOUR }}>
                    <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-red-500" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
