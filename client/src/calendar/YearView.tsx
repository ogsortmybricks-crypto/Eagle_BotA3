import { daysBetween, localToday } from "@shared/calendar";
import { monthGrid } from "./MonthView";
import { packLanes } from "./layout";
import { breaksOn, sessionsOn, tint, type Entry } from "./entries";
import { formatDay, itemColor, type CalendarItem } from "./types";

/**
 * The year at a glance: the sessions and breaks that pace it on top, twelve
 * small months below. It's the view for planning the next session's Quest.
 */
export function YearView({
  year,
  weekStartsOn,
  entries,
  items,
  byStudio,
  onDay,
  onOpen,
}: {
  year: number;
  weekStartsOn: number;
  entries: Entry[];
  items: CalendarItem[];
  byStudio: boolean;
  onDay: (day: string) => void;
  onOpen: (item: CalendarItem) => void;
}) {
  const today = localToday();
  const first = `${year}-01-01`;
  const last = `${year}-12-31`;
  const total = daysBetween(first, last) + 1;
  const pacing = items
    .filter((item) => item.kind === "session" || item.kind === "break")
    .sort((a, b) => a.occurrenceStart.localeCompare(b.occurrenceStart));
  // Several studios' sessions overlap in the academy view: give each a lane.
  const placed = packLanes(
    pacing.map((item) => ({
      item,
      start: Math.max(0, daysBetween(first, item.occurrenceStart)),
      end: Math.min(total - 1, daysBetween(first, item.occurrenceEnd)),
    })),
  );
  const laneCount = placed.reduce((max, entry) => Math.max(max, entry.lane + 1), 1);
  const LANE = 28;
  const busy = new Set(entries.flatMap((entry) => (entry.start === entry.end ? [entry.start] : [entry.start, entry.end])));

  return (
    <div className="space-y-5">
      <div className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Sessions and breaks</h2>
        {pacing.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing marked yet. Add a session to plan the year in Quests.</p>
        ) : (
          <>
            <div className="relative rounded-lg bg-gray-50" style={{ height: laneCount * LANE + 8 }}>
              {placed.map(({ item, start, end, lane }) => {
                const color = item.kind === "break" ? "#94a3b8" : itemColor(item, byStudio);
                return (
                  <button
                    key={item.key}
                    onClick={() => onOpen(item)}
                    className="absolute overflow-hidden rounded px-1 text-left text-[10px] font-semibold text-white"
                    style={{
                      left: `${(start / total) * 100}%`,
                      width: `${((end - start + 1) / total) * 100}%`,
                      top: 4 + lane * LANE,
                      height: LANE - 4,
                      lineHeight: `${LANE - 4}px`,
                      background: color,
                    }}
                    title={`${item.title}${item.quest ? ` — ${item.quest}` : ""}`}
                  >
                    <span className="truncate">{item.title}</span>
                  </button>
                );
              })}
              {today >= first && today <= last && (
                <div
                  className="absolute -top-1 -bottom-1 w-0.5 bg-red-500"
                  style={{ left: `${(daysBetween(first, today) / total) * 100}%` }}
                />
              )}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-gray-400">
              {Array.from({ length: 12 }, (_, month) => (
                <span key={month}>{formatDay(`${year}-${String(month + 1).padStart(2, "0")}-01`, { month: "short" })}</span>
              ))}
            </div>
            <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
              {pacing
                .filter((item) => item.kind === "session")
                .map((item) => (
                  <li key={item.key}>
                    <button onClick={() => onOpen(item)} className="flex w-full items-start gap-2 rounded-lg p-1.5 text-left hover:bg-gray-50">
                      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: itemColor(item, byStudio) }} />
                      <span className="min-w-0 text-sm">
                        <span className="font-semibold text-gray-900">{item.title}</span>
                        {item.quest && <span className="text-gray-600"> · {item.quest}</span>}
                        <span className="block text-xs text-gray-500">
                          {formatDay(item.occurrenceStart, { month: "short", day: "numeric" })} –{" "}
                          {formatDay(item.occurrenceEnd, { month: "short", day: "numeric" })} ·{" "}
                          {Math.ceil((daysBetween(item.occurrenceStart, item.occurrenceEnd) + 1) / 7)} weeks · {item.ownerLabel}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 12 }, (_, month) => {
          const cursor = `${year}-${String(month + 1).padStart(2, "0")}-01`;
          const days = monthGrid(cursor, weekStartsOn);
          return (
            <div key={month} className="card p-3">
              <div className="mb-2 text-sm font-semibold text-gray-900">{formatDay(cursor, { month: "long" })}</div>
              <div className="grid grid-cols-7 gap-0.5 text-center text-[11px]">
                {days.slice(0, 7).map((day) => (
                  <div key={day} className="text-[10px] font-semibold text-gray-400">
                    {formatDay(day, { weekday: "narrow" })}
                  </div>
                ))}
                {days.map((day) => {
                  const inMonth = day.slice(0, 7) === cursor.slice(0, 7);
                  if (!inMonth) return <div key={day} />;
                  const session = sessionsOn(items, day)[0];
                  const onBreak = breaksOn(items, day).length > 0;
                  return (
                    <button
                      key={day}
                      onClick={() => onDay(day)}
                      className={`relative h-7 rounded text-gray-700 hover:ring-1 hover:ring-gray-300 ${
                        day === today ? "!bg-brand-600 font-bold !text-white" : ""
                      }`}
                      style={{
                        background: onBreak ? "rgba(148,163,184,0.3)" : session ? tint(itemColor(session, byStudio), 0.2) : undefined,
                      }}
                      title={[session && `${session.title}${session.quest ? ` — ${session.quest}` : ""}`, onBreak && "Break"].filter(Boolean).join(" · ")}
                    >
                      {Number(day.slice(8))}
                      {busy.has(day) && (
                        <span className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-gray-700" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
