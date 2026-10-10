import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Trash2, UserX } from "lucide-react";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { Avatar, Banner, Chip, LoadingPage, Spinner, Stat } from "@/components/ui";
import { localToday } from "@shared/calendar";
import { monthGrid } from "./MonthView";
import { formatDay, type CalendarView } from "./types";

type AttendanceDay = {
  day: string;
  expected: number;
  absent: number;
  isBreak: boolean;
  absentees: { userId: number; name: string; kind: "sick" | "other"; note: string | null }[];
};
type AttendanceLearner = {
  id: number;
  name: string;
  avatarUrl: string | null;
  studioId: number | null;
  expected: number;
  absent: number;
  sick: number;
  other: number;
};
type AttendanceResponse = { label: string; days: AttendanceDay[]; learners: AttendanceLearner[] };

const pct = (part: number, whole: number) => (whole === 0 ? null : Math.round((part / whole) * 100));

/** Green when nearly everyone's in, through amber, to red. */
function rateColor(rate: number | null): string {
  if (rate === null) return "transparent";
  if (rate >= 95) return "rgba(16,185,129,0.28)";
  if (rate >= 85) return "rgba(16,185,129,0.14)";
  if (rate >= 75) return "rgba(245,158,11,0.22)";
  return "rgba(239,68,68,0.22)";
}

/**
 * Who's in, across a month, for the studio, group or academy in view.
 *
 * Built from what's already recorded - each learner's usual days and the
 * absences they (or a guide) log - with breaks taken out, so nobody has to
 * take a register for the overview to mean something.
 */
export function AttendanceView({
  cursor,
  weekStartsOn,
  view,
  target,
  studios,
  canRecord,
}: {
  cursor: string;
  weekStartsOn: number;
  view: CalendarView;
  target: number | null;
  studios: { id: number; name: string; color: string }[];
  canRecord: boolean;
}) {
  const grid = monthGrid(cursor, weekStartsOn);
  const from = `${cursor.slice(0, 7)}-01`;
  const to = grid.filter((day) => day.slice(0, 7) === cursor.slice(0, 7)).pop()!;
  const today = localToday();
  const [picked, setPicked] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const query = useQuery<AttendanceResponse>({
    queryKey: ["calendar", "attendance", view, target, from, to],
    queryFn: () =>
      apiGet(`/calendar/attendance?from=${from}&to=${to}&view=${view}${target !== null ? `&target=${target}` : ""}`),
  });

  if (query.isLoading) return <LoadingPage />;
  if (query.error) return <Banner tone="error">{(query.error as Error).message}</Banner>;
  const data = query.data!;

  // Only days that have happened count toward the rate.
  const past = data.days.filter((day) => day.day <= today);
  const expected = past.reduce((sum, day) => sum + day.expected, 0);
  const absent = past.reduce((sum, day) => sum + day.absent, 0);
  const sick = past.reduce((sum, day) => sum + day.absentees.filter((entry) => entry.kind === "sick").length, 0);
  const rate = pct(expected - absent, expected);
  const byDay = new Map(data.days.map((day) => [day.day, day]));
  const pickedDay = picked ? byDay.get(picked) : null;
  const studioName = (id: number | null) => studios.find((studio) => studio.id === id)?.name ?? "";

  const learners = data.learners
    .filter((learner) => learner.name.toLowerCase().includes(filter.toLowerCase()))
    .map((learner) => ({ ...learner, rate: pct(learner.expected - learner.absent, learner.expected) }))
    .sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101) || a.name.localeCompare(b.name));

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat
          label="Attendance"
          value={rate === null ? "—" : `${rate}%`}
          tone={rate === null ? "neutral" : rate >= 90 ? "good" : "warn"}
          hint={`${data.label}, ${formatDay(from, { month: "long" })} so far`}
        />
        <Stat label="Days missed" value={absent} hint={`of ${expected} expected learner-days`} />
        <Stat label="Sick days" value={sick} hint={`${absent - sick} for other reasons`} />
        <Stat label="Learners" value={data.learners.length} hint="Active learners in view" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">
            {grid.slice(0, 7).map((day) => (
              <div key={day} className="py-2">
                {formatDay(day, { weekday: "short" })}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {grid.map((day) => {
              const entry = byDay.get(day);
              if (!entry) return <div key={day} className="h-20 border-b border-r border-gray-100 bg-gray-50/60" />;
              const dayRate = pct(entry.expected - entry.absent, entry.expected);
              const future = day > today;
              return (
                <button
                  key={day}
                  onClick={() => setPicked(day)}
                  className={`flex h-20 flex-col items-start border-b border-r border-gray-100 p-1.5 text-left transition hover:ring-2 hover:ring-inset hover:ring-brand-300 ${
                    picked === day ? "ring-2 ring-inset ring-brand-500" : ""
                  }`}
                  style={{
                    background: entry.isBreak || future ? undefined : rateColor(dayRate),
                    backgroundImage: entry.isBreak
                      ? "repeating-linear-gradient(135deg, rgba(148,163,184,0.18) 0 6px, transparent 6px 12px)"
                      : undefined,
                  }}
                >
                  <span className={`text-xs font-semibold ${day === today ? "text-brand-700" : "text-gray-700"}`}>
                    {Number(day.slice(8))}
                  </span>
                  {entry.isBreak ? (
                    <span className="mt-auto text-[11px] text-gray-500">Break</span>
                  ) : entry.expected === 0 ? null : (
                    <span className={`mt-auto text-[11px] ${future ? "text-gray-400" : "text-gray-700"}`}>
                      <span className="font-semibold">{entry.expected - entry.absent}</span>/{entry.expected} in
                      {entry.absent > 0 && <span className="block text-gray-500">{entry.absent} out{future ? " (planned)" : ""}</span>}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <DayPanel day={pickedDay ?? null} learners={data.learners} canRecord={canRecord} />
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 p-3">
          <h2 className="text-sm font-semibold text-gray-900">By learner</h2>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
            <input className="input w-56 pl-8" placeholder="Find a learner" value={filter} onChange={(event) => setFilter(event.target.value)} />
          </div>
        </div>
        {learners.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">No learners in view.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 font-semibold">Learner</th>
                <th className="hidden px-3 py-2 font-semibold sm:table-cell">Studio</th>
                <th className="px-3 py-2 text-right font-semibold">Expected</th>
                <th className="px-3 py-2 text-right font-semibold">Missed</th>
                <th className="w-40 px-3 py-2 font-semibold">Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {learners.map((learner) => (
                <tr key={learner.id}>
                  <td className="px-3 py-2">
                    <Link href={`/people/${learner.id}`} className="flex items-center gap-2 font-medium text-gray-900 hover:text-brand-700">
                      <Avatar name={learner.name} src={learner.avatarUrl} size={24} />
                      {learner.name}
                    </Link>
                  </td>
                  <td className="hidden px-3 py-2 text-gray-500 sm:table-cell">{studioName(learner.studioId)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{learner.expected}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                    {learner.absent}
                    {learner.absent > 0 && (
                      <span className="ml-1 text-xs text-gray-400">
                        ({learner.sick} sick)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {learner.rate === null ? (
                      <span className="text-xs text-gray-400">—</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                          <div
                            className={`h-full rounded-full ${learner.rate >= 90 ? "bg-emerald-500" : learner.rate >= 75 ? "bg-amber-500" : "bg-red-500"}`}
                            style={{ width: `${learner.rate}%` }}
                          />
                        </div>
                        <span className="w-9 text-right text-xs tabular-nums text-gray-600">{learner.rate}%</span>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="border-t border-gray-100 p-3 text-xs text-gray-500">
          Counts the month's past and planned absences against each learner's usual days, leaving out breaks. The rate
          counts the month so far, up to today.
        </p>
      </div>
    </div>
  );
}

/** Who was out on one day, and - for a guide - recording someone else. */
function DayPanel({
  day,
  learners,
  canRecord,
}: {
  day: AttendanceDay | null;
  learners: AttendanceLearner[];
  canRecord: boolean;
}) {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<number | "">("");
  const [kind, setKind] = useState<"sick" | "other">("sick");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["calendar", "attendance"] });
  const record = useMutation({
    mutationFn: () => apiPost("/calendar/attendance/absences", { userId, day: day!.day, kind, note: note.trim() || null }),
    onSuccess: async () => {
      setUserId("");
      setNote("");
      setError(null);
      await refresh();
    },
    onError: (recordError: Error) => setError(recordError.message),
  });
  const clear = useMutation({
    mutationFn: (id: number) => apiDelete(`/calendar/attendance/absences/${id}/${day!.day}`),
    onSuccess: refresh,
    onError: (clearError: Error) => setError(clearError.message),
  });

  if (!day) {
    return (
      <div className="card flex flex-col items-center justify-center p-6 text-center text-sm text-gray-500">
        <UserX className="mb-2 h-6 w-6 text-gray-300" />
        Pick a day to see who was out{canRecord ? " or record an absence" : ""}.
      </div>
    );
  }

  const outIds = new Set(day.absentees.map((entry) => entry.userId));
  return (
    <div className="card p-4">
      <h3 className="font-semibold text-gray-900">{formatDay(day.day, { weekday: "long", month: "long", day: "numeric" })}</h3>
      <p className="text-xs text-gray-500">
        {day.isBreak ? "On a break." : `${day.expected - day.absent} of ${day.expected} expected in.`}
      </p>
      {error && (
        <div className="mt-3">
          <Banner tone="error">{error}</Banner>
        </div>
      )}
      <ul className="mt-3 space-y-1.5">
        {day.absentees.length === 0 && <li className="text-sm text-gray-500">Nobody recorded as out.</li>}
        {day.absentees.map((entry) => (
          <li key={entry.userId} className="flex items-start gap-2 text-sm">
            <div className="min-w-0 flex-1">
              <span className="font-medium text-gray-900">{entry.name}</span>{" "}
              <Chip tone={entry.kind === "sick" ? "amber" : "neutral"}>{entry.kind === "sick" ? "Sick" : "Away"}</Chip>
              {entry.note && <div className="text-xs text-gray-500">{entry.note}</div>}
            </div>
            {canRecord && (
              <button
                onClick={() => clear.mutate(entry.userId)}
                className="btn-ghost p-1 text-gray-400 hover:text-red-600"
                title="Mark as in"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canRecord && !day.isBreak && (
        <div className="mt-4 space-y-2 border-t border-gray-100 pt-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Record an absence</div>
          <select className="input" value={userId} onChange={(event) => setUserId(event.target.value ? Number(event.target.value) : "")}>
            <option value="">Who?</option>
            {learners
              .filter((learner) => !outIds.has(learner.id))
              .map((learner) => (
                <option key={learner.id} value={learner.id}>
                  {learner.name}
                </option>
              ))}
          </select>
          <div className="flex gap-2">
            <select className="input w-28" value={kind} onChange={(event) => setKind(event.target.value as "sick" | "other")}>
              <option value="sick">Sick</option>
              <option value="other">Away</option>
            </select>
            <input className="input" placeholder="Note (optional)" value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
          <button onClick={() => record.mutate()} disabled={userId === "" || record.isPending} className="btn-primary btn-sm w-full">
            {record.isPending && <Spinner />} Record
          </button>
        </div>
      )}
    </div>
  );
}
