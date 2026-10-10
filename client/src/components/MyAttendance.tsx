import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { Banner, Chip, Spinner } from "./ui";
import { SettingCard } from "./SettingControls";
import { localToday } from "@shared/calendar";

type Personal = {
  attendanceDays: number[];
  absences: { day: string; kind: "sick" | "other"; note: string | null }[];
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The days you're normally in, and the days you weren't.
 *
 * This is what the calendar's attendance overview is built from, so it lives
 * with the person: nobody takes a register, everyone keeps their own.
 */
export function MyAttendance() {
  const queryClient = useQueryClient();
  const [day, setDay] = useState(localToday);
  const [kind, setKind] = useState<"sick" | "other">("sick");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const query = useQuery<Personal>({ queryKey: ["me-personal"], queryFn: () => apiGet("/me/personal") });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["me-personal"] });

  const saveDays = useMutation({
    mutationFn: (days: number[]) => apiPut("/me/attendance", { days }),
    onSuccess: refresh,
    onError: (saveError: Error) => setError(saveError.message),
  });
  const record = useMutation({
    mutationFn: () => apiPost("/me/absences", { day, kind, note: note.trim() || undefined }),
    onSuccess: async () => {
      setNote("");
      setError(null);
      await refresh();
    },
    onError: (recordError: Error) => setError(recordError.message),
  });
  const remove = useMutation({
    mutationFn: (absentDay: string) => apiDelete(`/me/absences/${absentDay}`),
    onSuccess: refresh,
  });

  const days = query.data?.attendanceDays ?? [];
  const absences = query.data?.absences ?? [];

  return (
    <SettingCard
      title="My attendance"
      description="The days you're normally in, and any you missed. Your guides see this on the calendar."
    >
      <div className="space-y-4 p-5">
        {error && <Banner tone="error">{error}</Banner>}
        <div>
          <div className="label">Days I'm normally in</div>
          <div className="flex flex-wrap gap-1.5">
            {DAY_NAMES.map((name, index) => {
              const on = days.includes(index);
              return (
                <button
                  key={name}
                  type="button"
                  disabled={query.isLoading || saveDays.isPending}
                  onClick={() => saveDays.mutate(on ? days.filter((entry) => entry !== index) : [...days, index])}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    on ? "bg-brand-600 text-white" : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="label">Record a day I missed</div>
          <div className="flex flex-wrap gap-2">
            <input type="date" className="input w-auto" value={day} onChange={(event) => setDay(event.target.value)} />
            <select className="input w-auto" value={kind} onChange={(event) => setKind(event.target.value as "sick" | "other")}>
              <option value="sick">Sick</option>
              <option value="other">Away</option>
            </select>
            <input
              className="input min-w-0 flex-1"
              placeholder="Note (optional)"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <button onClick={() => record.mutate()} disabled={!day || record.isPending} className="btn-secondary">
              {record.isPending && <Spinner />} Record
            </button>
          </div>
          <p className="hint">You can record up to a month ahead, for an appointment you already know about.</p>
        </div>

        {absences.length > 0 && (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {absences.slice(0, 12).map((absence) => (
              <li key={absence.day} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="w-28 tabular-nums text-gray-700">{absence.day}</span>
                <Chip tone={absence.kind === "sick" ? "amber" : "neutral"}>{absence.kind === "sick" ? "Sick" : "Away"}</Chip>
                <span className="min-w-0 flex-1 truncate text-gray-500">{absence.note}</span>
                <button
                  onClick={() => remove.mutate(absence.day)}
                  className="btn-ghost p-1 text-gray-400 hover:text-red-600"
                  aria-label={`Remove ${absence.day}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SettingCard>
  );
}
