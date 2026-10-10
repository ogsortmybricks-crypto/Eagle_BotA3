import { CalendarDays, MapPin } from "lucide-react";
import { eachDay, localToday, sessionWeek } from "@shared/calendar";
import { EmptyState } from "@/components/ui";
import { sessionsOn, type Entry } from "./entries";
import { formatDay, formatTime, type CalendarItem } from "./types";
import { KIND_LABELS } from "@shared/calendar";

/** The schedule: every day that has something on it, in order. */
export function AgendaView({
  from,
  weekStartsOn,
  to,
  entries,
  items,
  onOpen,
  onDay,
  onMore,
}: {
  from: string;
  weekStartsOn: number;
  to: string;
  entries: Entry[];
  items: CalendarItem[];
  onOpen: (entry: Entry) => void;
  onDay: (day: string) => void;
  onMore: () => void;
}) {
  const today = localToday();
  const days = eachDay(from, to)
    .map((day) => ({
      day,
      entries: entries
        .filter((entry) => entry.start <= day && entry.end >= day)
        // A long trip shows on its first day, and on the first day of the range.
        .filter((entry) => entry.start === day || day === from)
        .sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? "")),
    }))
    .filter((row) => row.entries.length > 0);

  if (days.length === 0) {
    return (
      <EmptyState icon={CalendarDays} title="Nothing coming up">
        Nothing's on the calendar between {formatDay(from, { month: "short", day: "numeric" })} and{" "}
        {formatDay(to, { month: "short", day: "numeric", year: "numeric" })}.
      </EmptyState>
    );
  }

  return (
    <div className="card divide-y divide-gray-100">
      {days.map(({ day, entries: dayEntries }) => {
        const session = sessionsOn(items, day)[0];
        return (
          <div key={day} className="flex gap-4 px-4 py-3">
            <button onClick={() => onDay(day)} className="w-16 shrink-0 text-left">
              <div className={`text-2xl font-semibold ${day === today ? "text-brand-600" : "text-gray-900"}`}>{Number(day.slice(8))}</div>
              <div className="text-xs uppercase text-gray-500">{formatDay(day, { month: "short", weekday: "short" })}</div>
            </button>
            <div className="min-w-0 flex-1 space-y-1">
              {session && (
                <div className="text-[11px] font-semibold uppercase tracking-wide text-purple-700">
                  {session.title} · Week {sessionWeek(session.occurrenceStart, day, weekStartsOn)}
                  {session.quest && ` · ${session.quest}`}
                </div>
              )}
              {dayEntries.map((entry) => (
                <button
                  key={entry.key}
                  onClick={() => onOpen(entry)}
                  className="flex w-full items-start gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-gray-50"
                >
                  <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: entry.color }} />
                  <span className="w-28 shrink-0 text-sm text-gray-500">
                    {entry.start !== entry.end
                      ? `Until ${formatDay(entry.end, { month: "short", day: "numeric" })}`
                      : entry.startTime
                        ? `${formatTime(entry.startTime)}${entry.endTime ? ` – ${formatTime(entry.endTime)}` : ""}`
                        : "All day"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-900">{entry.title}</span>
                    <span className="flex flex-wrap gap-x-3 text-xs text-gray-500">
                      {entry.item
                        ? KIND_LABELS[entry.item.kind]
                        : entry.tacon
                          ? `${KIND_LABELS[entry.tacon.kind]} · from ${entry.tacon.taconName}`
                          : entry.linked?.type === "town_hall"
                            ? "Town Hall"
                            : "Election"}
                      {entry.item && <span>{entry.item.ownerLabel}</span>}
                      {entry.item?.location && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {entry.item.location}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <div className="p-3 text-center">
        <button onClick={onMore} className="btn-ghost btn-sm">
          Show further ahead
        </button>
      </div>
    </div>
  );
}
