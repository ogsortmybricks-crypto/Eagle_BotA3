import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Clock, Copy, MapPin, Pencil, Repeat, Trash2, Users } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Banner, Chip, Markdown, Modal, Spinner } from "@/components/ui";
import { CALENDAR_KIND_LIST, KIND_HINTS } from "./kinds";
import {
  addDays,
  daysBetween,
  describeRecurrence,
  KIND_COLORS,
  KIND_LABELS,
  minutesOf,
  timeOf,
  weekday,
} from "@shared/calendar";
import {
  formatDay,
  formatTime,
  type CalendarItem,
  type CalendarKind,
  type CalendarRecurrence,
  type Draft,
} from "./types";

type StudiosResponse = {
  studios: { id: number; name: string; color: string; groupId: number | null }[];
  groups: { id: number; name: string; studioIds: number[] }[];
};

/** How far a change to a recurring entry reaches. */
export type SeriesMode = "one" | "following" | "all";

/** Asks the question every calendar asks before touching a repeating entry. */
export function SeriesModeModal({
  verb,
  onPick,
  onClose,
}: {
  verb: "Change" | "Delete";
  onPick: (mode: SeriesMode) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<SeriesMode>("one");
  return (
    <Modal
      open
      onClose={onClose}
      title={`${verb} a repeating entry`}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button onClick={() => onPick(mode)} className={verb === "Delete" ? "btn-danger" : "btn-primary"}>
            {verb}
          </button>
        </>
      }
    >
      <div className="space-y-2">
        {(
          [
            ["one", "This one"],
            ["following", "This and following"],
            ["all", "All of them"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50">
            <input type="radio" checked={mode === value} onChange={() => setMode(value)} />
            {label}
          </label>
        ))}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/*  Details                                                                    */
/* -------------------------------------------------------------------------- */

export function EventDetails({
  item,
  canEdit,
  onEdit,
  onDuplicate,
  onClose,
}: {
  item: CalendarItem;
  canEdit: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: (mode: SeriesMode) =>
      apiDelete(`/calendar/events/${item.id}?occurrence=${item.occurrenceStart}&mode=${mode}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["calendar"] });
      onClose();
    },
    onError: (removeError: Error) => setError(removeError.message),
  });

  const multiDay = item.occurrenceStart !== item.occurrenceEnd;
  const when = multiDay
    ? `${formatDay(item.occurrenceStart, { weekday: "short", month: "short", day: "numeric" })} – ${formatDay(item.occurrenceEnd, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}`
    : formatDay(item.occurrenceStart, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const weeks = Math.ceil((daysBetween(item.occurrenceStart, item.occurrenceEnd) + 1) / 7);

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={item.title}
        footer={
          canEdit ? (
            <>
              <button
                onClick={() => (item.recurrence ? setAsking(true) : window.confirm(`Delete "${item.title}"?`) && remove.mutate("all"))}
                disabled={remove.isPending}
                className="btn-danger mr-auto"
              >
                {remove.isPending ? <Spinner /> : <Trash2 className="h-4 w-4" />} Delete
              </button>
              <button onClick={onDuplicate} className="btn-secondary">
                <Copy className="h-4 w-4" /> Duplicate
              </button>
              <button onClick={onEdit} className="btn-primary">
                <Pencil className="h-4 w-4" /> Edit
              </button>
            </>
          ) : undefined
        }
      >
        <div className="space-y-3 text-sm">
          {error && <Banner tone="error">{error}</Banner>}
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="chip text-white"
              style={{ background: item.color ?? KIND_COLORS[item.kind] }}
            >
              {KIND_LABELS[item.kind]}
            </span>
            <Chip>
              <span className="h-2 w-2 rounded-full" style={{ background: item.ownerColor ?? "#94a3b8" }} />
              {item.ownerLabel}
            </Chip>
          </div>
          <div className="flex items-start gap-2.5 text-gray-700">
            <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
            <div>
              {when}
              {item.kind === "session" && multiDay && <span className="text-gray-500"> · {weeks} weeks</span>}
            </div>
          </div>
          {item.startTime && item.endTime && (
            <div className="flex items-center gap-2.5 text-gray-700">
              <Clock className="h-4 w-4 shrink-0 text-gray-400" />
              {formatTime(item.startTime)} – {formatTime(item.endTime)}
            </div>
          )}
          {item.recurrence && (
            <div className="flex items-center gap-2.5 text-gray-700">
              <Repeat className="h-4 w-4 shrink-0 text-gray-400" />
              {describeRecurrence(item.recurrence)}
            </div>
          )}
          {item.location && (
            <div className="flex items-center gap-2.5 text-gray-700">
              <MapPin className="h-4 w-4 shrink-0 text-gray-400" />
              {item.location}
            </div>
          )}
          {item.quest && (
            <div className="rounded-lg border border-purple-200 bg-purple-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">Quest</div>
              <div className="mt-0.5 font-semibold text-purple-950">{item.quest}</div>
            </div>
          )}
          {item.description && (
            <div className="border-t border-gray-100 pt-3">
              <Markdown>{item.description}</Markdown>
            </div>
          )}
        </div>
      </Modal>
      {asking && (
        <SeriesModeModal
          verb="Delete"
          onClose={() => setAsking(false)}
          onPick={(mode) => {
            setAsking(false);
            remove.mutate(mode);
          }}
        />
      )}
    </>
  );
}

/** A Town Hall or election deadline, which lives elsewhere and links there. */
export function LinkedDetails({
  item,
  onClose,
}: {
  item: { title: string; href: string; type: string };
  onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} title={item.title}>
      <p className="text-sm text-gray-600">
        {item.type === "town_hall"
          ? "A Town Hall. It's on the calendar because it's in Town Hall - change it there."
          : "An election deadline. It's on the calendar because it's set on the election."}
      </p>
      <Link href={item.href} className="btn-primary mt-4" onClick={onClose}>
        <Users className="h-4 w-4" /> Open it
      </Link>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/*  Editor                                                                     */
/* -------------------------------------------------------------------------- */

type Owner = `studio:${number}` | `group:${number}` | "academy";

type RepeatChoice = "none" | "daily" | "weekly" | "monthly";

/**
 * Creating or changing an entry. One form for every kind - a session is an
 * event that spans weeks and names a Quest, a break is one nobody comes in
 * for - with the fields that don't apply to a kind tucked away.
 */
export function EventEditor({
  item,
  draft,
  defaultOwner,
  onClose,
}: {
  /** Set when editing; when duplicating, pass the item with `id` 0. */
  item: CalendarItem | null;
  draft: Draft | null;
  defaultOwner: Owner;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { canSeeAllStudios } = useSession();
  const editing = item !== null && item.id > 0;

  const studios = useQuery<StudiosResponse>({ queryKey: ["studios"], queryFn: () => apiGet("/studios") });

  const initialOwner: Owner = item
    ? item.studioId !== null
      ? `studio:${item.studioId}`
      : item.groupId !== null
        ? `group:${item.groupId}`
        : "academy"
    : defaultOwner;

  // Editing one occurrence of a series starts from that occurrence's dates.
  const baseStart = item ? (item.recurrence ? item.occurrenceStart : item.startDate) : (draft?.startDate ?? "");
  const baseEnd = item ? (item.recurrence ? item.occurrenceEnd : item.endDate) : (draft?.endDate ?? baseStart);

  const [kind, setKind] = useState<CalendarKind>(item?.kind ?? draft?.kind ?? "event");
  const [title, setTitle] = useState(item?.title ?? "");
  const [owner, setOwner] = useState<Owner>(initialOwner);
  const [startDate, setStartDate] = useState(baseStart);
  const [endDate, setEndDate] = useState(baseEnd);
  const [allDay, setAllDay] = useState(item ? !item.startTime : !draft?.startTime);
  const [startTime, setStartTime] = useState(item?.startTime ?? draft?.startTime ?? "09:00");
  const [endTime, setEndTime] = useState(item?.endTime ?? draft?.endTime ?? "10:00");
  const [location, setLocation] = useState(item?.location ?? "");
  const [quest, setQuest] = useState(item?.quest ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [color, setColor] = useState<string | null>(item?.color ?? null);
  const [repeat, setRepeat] = useState<RepeatChoice>(item?.recurrence?.freq ?? "none");
  const [interval, setInterval] = useState(item?.recurrence?.interval ?? 1);
  const [weekdays, setWeekdays] = useState<number[]>(
    item?.recurrence?.weekdays.length ? item.recurrence.weekdays : baseStart ? [weekday(baseStart)] : [],
  );
  const [ends, setEnds] = useState<"never" | "on" | "after">(
    item?.recurrence?.until ? "on" : item?.recurrence?.count ? "after" : "never",
  );
  const [until, setUntil] = useState(item?.recurrence?.until ?? (baseStart ? addDays(baseStart, 90) : ""));
  const [count, setCount] = useState(item?.recurrence?.count ?? 10);
  const [error, setError] = useState<string | null>(null);
  const [askMode, setAskMode] = useState(false);

  const wholeDays = kind === "session" || kind === "break";
  const timed = !wholeDays && !allDay;

  const recurrence: CalendarRecurrence | null =
    repeat === "none"
      ? null
      : {
          freq: repeat,
          interval: Math.max(1, interval),
          weekdays: repeat === "weekly" ? weekdays : [],
          until: ends === "on" ? until : null,
          count: ends === "after" ? count : null,
        };

  function body() {
    const [ownerKind, ownerId] = owner.split(":");
    return {
      kind,
      title: title.trim(),
      description,
      location: location.trim() || null,
      quest: kind === "session" ? quest.trim() || null : null,
      startDate,
      endDate: endDate < startDate ? startDate : endDate,
      startTime: timed ? startTime : null,
      endTime: timed ? endTime : null,
      color,
      recurrence,
      studioId: ownerKind === "studio" ? Number(ownerId) : null,
      groupId: ownerKind === "group" ? Number(ownerId) : null,
    };
  }

  const save = useMutation({
    mutationFn: (mode: SeriesMode | null) => {
      if (!editing) return apiPost("/calendar/events", body());
      const payload = mode && mode !== "all" ? { ...body(), occurrence: item!.occurrenceStart, mode } : body();
      // Changing the whole series keeps the series' own first day unless the
      // dates were actually moved.
      if ((mode === null || mode === "all") && item!.recurrence) {
        const shift = daysBetween(item!.occurrenceStart, startDate);
        const span = daysBetween(startDate, endDate < startDate ? startDate : endDate);
        const seriesStart = addDays(item!.startDate, shift);
        Object.assign(payload, { startDate: seriesStart, endDate: addDays(seriesStart, span) });
      }
      return apiPatch(`/calendar/events/${item!.id}`, payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["calendar"] });
      onClose();
    },
    onError: (saveError: Error) => setError(saveError.message),
  });

  function submit() {
    setError(null);
    if (editing && item!.recurrence) setAskMode(true);
    else save.mutate(null);
  }

  const studioList = studios.data?.studios ?? [];
  const groupList = (studios.data?.groups ?? []).filter((group) => group.studioIds.length > 0);

  return (
    <>
      <Modal
        open
        wide
        onClose={onClose}
        title={editing ? `Edit ${KIND_LABELS[item!.kind].toLowerCase()}` : `New ${KIND_LABELS[kind].toLowerCase()}`}
        footer={
          <>
            <button onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={save.isPending || title.trim().length === 0 || !startDate}
              className="btn-primary"
            >
              {save.isPending && <Spinner />} Save
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <Banner tone="error">{error}</Banner>}

          <div className="flex flex-wrap gap-1.5">
            {CALENDAR_KIND_LIST.map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => setKind(entry)}
                className={`chip border transition ${
                  kind === entry ? "border-transparent text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                }`}
                style={kind === entry ? { background: KIND_COLORS[entry] } : undefined}
              >
                {KIND_LABELS[entry]}
              </button>
            ))}
          </div>
          <p className="hint -mt-2">{KIND_HINTS[kind]}</p>

          <input
            className="input text-base font-semibold"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={
              kind === "session" ? "Session 2" : kind === "field_trip" ? "Trip to the science museum" : kind === "break" ? "Winter break" : "Title"
            }
            autoFocus
          />

          {kind === "session" && (
            <div>
              <label className="label" htmlFor="cal-quest">
                Quest for this session
              </label>
              <input
                id="cal-quest"
                className="input"
                value={quest}
                onChange={(event) => setQuest(event.target.value)}
                placeholder="Build a business"
              />
              <p className="hint">Shown on every week of the session, so everyone knows what they're working toward.</p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="cal-start">
                {wholeDays ? "First day" : "Starts"}
              </label>
              <input
                id="cal-start"
                type="date"
                className="input"
                value={startDate}
                onChange={(event) => {
                  const next = event.target.value;
                  // Keep the length when the start moves, the way calendars do.
                  if (next && startDate && endDate) setEndDate(addDays(next, daysBetween(startDate, endDate)));
                  // A weekly repeat on the start's own day follows the start.
                  if (next && startDate && weekdays.length === 1 && weekdays[0] === weekday(startDate)) {
                    setWeekdays([weekday(next)]);
                  }
                  setStartDate(next);
                }}
              />
            </div>
            <div>
              <label className="label" htmlFor="cal-end">
                {wholeDays ? "Last day" : "Ends"}
              </label>
              <input
                id="cal-end"
                type="date"
                className="input"
                value={endDate}
                min={startDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </div>
          </div>
          {kind === "session" && startDate && endDate >= startDate && (
            <p className="hint -mt-2">
              {Math.ceil((daysBetween(startDate, endDate) + 1) / 7)} weeks
            </p>
          )}

          {!wholeDays && (
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex items-center gap-2 pb-2 text-sm text-gray-700">
                <input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} />
                All day
              </label>
              {!allDay && (
                <>
                  <div>
                    <label className="label" htmlFor="cal-start-time">
                      From
                    </label>
                    <input
                      id="cal-start-time"
                      type="time"
                      className="input"
                      value={startTime}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (next && startTime && endTime) {
                          setEndTime(timeOf(minutesOf(next) + minutesOf(endTime) - minutesOf(startTime)));
                        }
                        setStartTime(next);
                      }}
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="cal-end-time">
                      To
                    </label>
                    <input
                      id="cal-end-time"
                      type="time"
                      className="input"
                      value={endTime}
                      onChange={(event) => setEndTime(event.target.value)}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="cal-owner">
                Whose calendar
              </label>
              <select
                id="cal-owner"
                className="input"
                value={owner}
                onChange={(event) => setOwner(event.target.value as Owner)}
              >
                {studioList.map((studio) => (
                  <option key={studio.id} value={`studio:${studio.id}`}>
                    {studio.name}
                  </option>
                ))}
                {groupList.map((group) => (
                  <option key={group.id} value={`group:${group.id}`}>
                    {group.name} (group)
                  </option>
                ))}
                {(canSeeAllStudios || owner === "academy") && <option value="academy">Whole academy</option>}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="cal-repeat">
                Repeats
              </label>
              <select
                id="cal-repeat"
                className="input"
                value={repeat}
                onChange={(event) => setRepeat(event.target.value as RepeatChoice)}
              >
                <option value="none">Does not repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          </div>

          {repeat !== "none" && (
            <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
                Every
                <input
                  type="number"
                  min={1}
                  max={52}
                  className="input w-20"
                  value={interval}
                  onChange={(event) => setInterval(Number(event.target.value) || 1)}
                />
                {repeat === "daily" ? "day(s)" : repeat === "weekly" ? "week(s)" : "month(s)"}
              </div>
              {repeat === "weekly" && (
                <div className="flex gap-1">
                  {["S", "M", "T", "W", "T", "F", "S"].map((letter, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() =>
                        setWeekdays((current) =>
                          current.includes(index) ? current.filter((entry) => entry !== index) : [...current, index],
                        )
                      }
                      className={`h-8 w-8 rounded-full text-xs font-semibold transition ${
                        weekdays.includes(index) ? "bg-brand-600 text-white" : "bg-white text-gray-600 ring-1 ring-gray-200"
                      }`}
                    >
                      {letter}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3 text-sm text-gray-700">
                Ends
                <select className="input w-auto" value={ends} onChange={(event) => setEnds(event.target.value as typeof ends)}>
                  <option value="never">Never</option>
                  <option value="on">On</option>
                  <option value="after">After</option>
                </select>
                {ends === "on" && (
                  <input type="date" className="input w-auto" value={until} min={startDate} onChange={(event) => setUntil(event.target.value)} />
                )}
                {ends === "after" && (
                  <span className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={500}
                      className="input w-20"
                      value={count}
                      onChange={(event) => setCount(Number(event.target.value) || 1)}
                    />
                    times
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500">{describeRecurrence(recurrence)}</p>
            </div>
          )}

          {kind !== "break" && (
            <div>
              <label className="label" htmlFor="cal-location">
                Where
              </label>
              <input
                id="cal-location"
                className="input"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder={kind === "field_trip" ? "Address, meeting point, bus time" : "Studio, Commons, online..."}
              />
            </div>
          )}

          <div>
            <label className="label" htmlFor="cal-desc">
              Details
            </label>
            <textarea
              id="cal-desc"
              className="input min-h-[96px]"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={
                kind === "field_trip"
                  ? "What to bring, permission slips, when you'll be back."
                  : kind === "session"
                    ? "The Spark, the Exhibition date, what badges are in play."
                    : "Markdown works here."
              }
            />
          </div>

          <div>
            <span className="label">Colour</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setColor(null)}
                className={`rounded-full px-2.5 py-1 text-xs ring-1 ${color === null ? "bg-gray-900 text-white ring-gray-900" : "text-gray-600 ring-gray-200"}`}
              >
                Automatic
              </button>
              {["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#64748b"].map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  onClick={() => setColor(swatch)}
                  className={`h-6 w-6 rounded-full ring-offset-2 ${color === swatch ? "ring-2 ring-gray-900" : ""}`}
                  style={{ background: swatch }}
                  aria-label={swatch}
                />
              ))}
            </div>
          </div>
        </div>
      </Modal>
      {askMode && (
        <SeriesModeModal
          verb="Change"
          onClose={() => setAskMode(false)}
          onPick={(mode) => {
            setAskMode(false);
            save.mutate(mode);
          }}
        />
      )}
    </>
  );
}
