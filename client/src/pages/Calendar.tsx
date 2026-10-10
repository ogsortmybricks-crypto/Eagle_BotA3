import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  Plus,
  Puzzle,
  Search,
} from "lucide-react";
import { apiGet, apiPatch } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Avatar, Banner, Modal, PageHeader, Spinner } from "@/components/ui";
import { TaconPanels } from "@/pages/TaconPage";
import {
  addDays,
  addMonths,
  daysBetween,
  eachDay,
  KIND_COLORS,
  KIND_LABELS,
  localToday,
  minutesOf,
  sessionWeek,
  startOfWeek,
  timeOf,
} from "@shared/calendar";
import { CALENDAR_KIND_LIST } from "@/calendar/kinds";
import { toEntries, sessionsOn, type Entry, type Interaction } from "@/calendar/entries";
import { MonthView, monthGrid } from "@/calendar/MonthView";
import { TimeGridView } from "@/calendar/TimeGridView";
import { YearView } from "@/calendar/YearView";
import { AgendaView } from "@/calendar/AgendaView";
import { AttendanceView } from "@/calendar/AttendanceView";
import { EventDetails, EventEditor, SeriesModeModal, type SeriesMode } from "@/calendar/EventEditor";
import { downloadIcs } from "@/calendar/ics";
import {
  formatDay,
  type CalendarItem,
  type CalendarKind,
  type CalendarResponse,
  type CalendarView,
  type Draft,
  type TaconEntry,
  type ViewMode,
} from "@/calendar/types";

/* ------------------------------ preferences ------------------------------- */

const PREFS_KEY = "eagle-bot.calendar";

type Prefs = {
  mode: ViewMode;
  weekStartsOn: 0 | 1;
  hiddenKinds: CalendarKind[];
  hideTownHalls: boolean;
  hideElections: boolean;
  hiddenStudios: number[];
  /** Tac-On installs whose entries are hidden. */
  hiddenTacons: number[];
  colorBy: "studio" | "kind";
};

const DEFAULT_PREFS: Prefs = {
  mode: "month",
  weekStartsOn: 0,
  hiddenKinds: [],
  hideTownHalls: false,
  hideElections: false,
  hiddenStudios: [],
  hiddenTacons: [],
  colorBy: "studio",
};

/** Per-viewer conveniences; the calendar works the same without them. */
function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const [prefs, setPrefs] = useState<Prefs>(() => {
    try {
      return { ...DEFAULT_PREFS, ...JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "{}") };
    } catch {
      return DEFAULT_PREFS;
    }
  });
  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        // Private browsing; the choice just won't survive a reload.
      }
      return next;
    });
  }, []);
  return [prefs, update];
}

/* --------------------------------- ranges --------------------------------- */

function rangeFor(mode: ViewMode, cursor: string, weekStartsOn: number, agendaDays: number): [string, string] {
  switch (mode) {
    case "day":
      return [cursor, cursor];
    case "week": {
      const start = startOfWeek(cursor, weekStartsOn);
      return [start, addDays(start, 6)];
    }
    case "month": {
      const grid = monthGrid(cursor, weekStartsOn);
      return [grid[0], grid[grid.length - 1]];
    }
    case "year":
      return [`${cursor.slice(0, 4)}-01-01`, `${cursor.slice(0, 4)}-12-31`];
    case "agenda":
      return [cursor, addDays(cursor, agendaDays)];
  }
}

function step(mode: ViewMode, cursor: string, direction: 1 | -1): string {
  switch (mode) {
    case "day":
      return addDays(cursor, direction);
    case "week":
      return addDays(cursor, 7 * direction);
    case "month":
      return addMonths(`${cursor.slice(0, 7)}-01`, direction);
    case "year":
      return addMonths(`${cursor.slice(0, 4)}-01-01`, 12 * direction);
    case "agenda":
      return addDays(cursor, 30 * direction);
  }
}

function heading(mode: ViewMode, cursor: string, weekStartsOn: number): string {
  switch (mode) {
    case "day":
      return formatDay(cursor, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    case "week": {
      const start = startOfWeek(cursor, weekStartsOn);
      const end = addDays(start, 6);
      return start.slice(0, 7) === end.slice(0, 7)
        ? `${formatDay(start, { month: "long", day: "numeric" })} – ${Number(end.slice(8))}, ${end.slice(0, 4)}`
        : `${formatDay(start, { month: "short", day: "numeric" })} – ${formatDay(end, { month: "short", day: "numeric", year: "numeric" })}`;
    }
    case "month":
      return formatDay(cursor, { month: "long", year: "numeric" });
    case "year":
      return cursor.slice(0, 4);
    case "agenda":
      return `From ${formatDay(cursor, { month: "long", day: "numeric", year: "numeric" })}`;
  }
}

const MODES: { id: ViewMode; label: string; key: string }[] = [
  { id: "day", label: "Day", key: "d" },
  { id: "week", label: "Week", key: "w" },
  { id: "month", label: "Month", key: "m" },
  { id: "year", label: "Year", key: "y" },
  { id: "agenda", label: "Schedule", key: "a" },
];

type StudiosResponse = { groups: { id: number; name: string; studioIds: number[] }[] };

/* ---------------------------------- page ---------------------------------- */

/**
 * The studio calendar.
 *
 * One calendar, three ways of looking at it: a studio (with whatever its
 * group and the academy have on), a studio group, or the whole academy with
 * every studio overlaid in its own colour. Guides and admins plan on it -
 * sessions and their Quests, breaks, field trips, Exhibitions - and everyone
 * else reads it. Town Halls and election deadlines appear on their own.
 */
export function Calendar() {
  const { can, studioId, studios, studioGroup, selectStudio } = useSession();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [prefs, setPrefs] = usePrefs();
  const canEdit = can("calendar.manage");
  const canAttendance = can("attendance.read");

  const [tab, setTab] = useState<"calendar" | "attendance">("calendar");
  const [cursor, setCursor] = useState(localToday);
  const [agendaDays, setAgendaDays] = useState(60);
  const [lensView, setLensView] = useState<CalendarView>(studioId !== null ? "studio" : "academy");
  const [groupTarget, setGroupTarget] = useState<number | null>(studioGroup?.id ?? null);
  const [opened, setOpened] = useState<CalendarItem | null>(null);
  const [openedTacon, setOpenedTacon] = useState<TaconEntry | null>(null);
  const [editing, setEditing] = useState<{ item: CalendarItem | null; draft: Draft | null } | null>(null);
  const [moving, setMoving] = useState<{ entry: Entry; startDate: string; startTime?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // No studio selected means there's no studio view to show.
  const view: CalendarView = lensView === "studio" && studioId === null ? "academy" : lensView;
  const target = view === "group" ? (groupTarget ?? studioGroup?.id ?? null) : null;

  const studiosQuery = useQuery<StudiosResponse>({ queryKey: ["studios"], queryFn: () => apiGet("/studios") });
  const groupOptions = useMemo(() => {
    const list = new Map<number, string>();
    for (const group of studiosQuery.data?.groups ?? []) list.set(group.id, group.name);
    if (studioGroup) list.set(studioGroup.id, studioGroup.name);
    return [...list.entries()].map(([id, name]) => ({ id, name }));
  }, [studiosQuery.data, studioGroup]);

  const [from, to] = rangeFor(prefs.mode, cursor, prefs.weekStartsOn, agendaDays);
  const query = useQuery<CalendarResponse>({
    queryKey: ["calendar", view, view === "studio" ? studioId : target, from, to],
    queryFn: () =>
      apiGet(
        `/calendar?from=${from}&to=${to}&view=${view}${view === "group" && target !== null ? `&target=${target}` : ""}`,
      ),
    enabled: view !== "group" || target !== null,
    placeholderData: (previous) => previous,
  });
  const data = query.data;

  const byStudio = prefs.colorBy === "studio";
  const items = useMemo(
    () =>
      (data?.items ?? []).filter(
        (item) =>
          !prefs.hiddenKinds.includes(item.kind) &&
          !(item.studioId !== null && prefs.hiddenStudios.includes(item.studioId)),
      ),
    [data, prefs.hiddenKinds, prefs.hiddenStudios],
  );
  const linked = useMemo(
    () =>
      (data?.linked ?? []).filter(
        (entry) => !(entry.type === "town_hall" ? prefs.hideTownHalls : prefs.hideElections),
      ),
    [data, prefs.hideTownHalls, prefs.hideElections],
  );
  const taconEntries = useMemo(
    () => (data?.tacons ?? []).filter((entry) => !prefs.hiddenTacons.includes(entry.installId)),
    [data, prefs.hiddenTacons],
  );
  const taconSources = useMemo(() => {
    const seen = new Map<number, { installId: number; name: string; color: string }>();
    for (const entry of data?.tacons ?? []) {
      if (!seen.has(entry.installId)) {
        seen.set(entry.installId, { installId: entry.installId, name: entry.taconName, color: entry.color ?? KIND_COLORS[entry.kind] });
      }
    }
    return [...seen.values()];
  }, [data]);
  const entries = useMemo(
    () => toEntries(items, linked, byStudio, taconEntries),
    [items, linked, byStudio, taconEntries],
  );

  /* -------------------------------- moving -------------------------------- */

  const move = useMutation({
    mutationFn: ({ entry, startDate, startTime, mode }: { entry: Entry; startDate: string; startTime?: string; mode: SeriesMode }) => {
      const item = entry.item!;
      const shift = daysBetween(item.occurrenceStart, startDate);
      const body: Record<string, unknown> = {};
      if (mode === "all") {
        body.startDate = addDays(item.startDate, shift);
        body.endDate = addDays(item.endDate, shift);
      } else {
        body.startDate = startDate;
        body.endDate = addDays(item.occurrenceEnd, shift);
        body.occurrence = item.occurrenceStart;
        body.mode = mode;
      }
      if (startTime !== undefined) {
        // Dropped on the hours: keep its length, or make an all-day thing an hour.
        const length = item.startTime && item.endTime ? minutesOf(item.endTime) - minutesOf(item.startTime) : 60;
        body.startTime = startTime;
        body.endTime = timeOf(Math.min(23 * 60 + 59, minutesOf(startTime) + length));
      }
      return apiPatch(`/calendar/events/${item.id}`, body);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["calendar"] }),
    onError: (moveError: Error) => setNotice(moveError.message),
  });

  const defaultOwner =
    view === "group" && target !== null
      ? (`group:${target}` as const)
      : studioId !== null
        ? (`studio:${studioId}` as const)
        : ("academy" as const);

  const interaction: Interaction = useMemo(
    () => ({
      canEdit,
      onOpen: (entry) => {
        if (entry.linked) navigate(entry.linked.href);
        else if (entry.tacon) setOpenedTacon(entry.tacon);
        else if (entry.item) setOpened(entry.item);
      },
      onCreate: (draft) => canEdit && setEditing({ item: null, draft }),
      onMove: (entry, startDate, startTime) => {
        if (!entry.item) return;
        const sameDay = startDate === entry.start;
        if (sameDay && (startTime === undefined || startTime === entry.startTime)) return;
        // A session or break is whole days; dropping it on the hours just moves the day.
        const time = entry.item.kind === "session" || entry.item.kind === "break" ? undefined : startTime;
        if (entry.item.recurrence) setMoving({ entry, startDate, startTime: time });
        else move.mutate({ entry, startDate, startTime: time, mode: "all" });
      },
      onDay: (day) => {
        setCursor(day);
        setPrefs({ mode: "day" });
      },
    }),
    // `move.mutate` is stable; the mutation object itself is new every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit, move.mutate, navigate, setPrefs],
  );

  /* ------------------------------- shortcuts ------------------------------ */

  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Nothing behind an open dialog, and nothing on the Attendance tab.
    const busy = tab !== "calendar" || opened !== null || openedTacon !== null || editing !== null || moving !== null;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (busy || event.metaKey || event.ctrlKey || event.altKey) return;
      if (target.closest("input, textarea, select, [role=dialog]")) return;
      const key = event.key.toLowerCase();
      const mode = MODES.find((entry) => entry.key === key);
      if (mode) return setPrefs({ mode: mode.id });
      if (key === "t") return setCursor(localToday());
      if (key === "j" || key === "n" || event.key === "ArrowRight") return setCursor((current) => step(prefs.mode, current, 1));
      if (key === "k" || key === "p" || event.key === "ArrowLeft") return setCursor((current) => step(prefs.mode, current, -1));
      if (key === "c" && canEdit) return setEditing({ item: null, draft: { startDate: cursor, endDate: cursor } });
      if (key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prefs.mode, setPrefs, canEdit, cursor, tab, opened, openedTacon, editing, moving]);

  /* -------------------------------- render -------------------------------- */

  const today = localToday();
  const todaysSessions = sessionsOn(data?.items ?? [], today);
  const switchStudio = (id: number) => {
    setLensView("studio");
    if (id !== studioId) void selectStudio(id);
  };

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle={
          data
            ? `${data.label}${data.view === "studio" && studioGroup ? ` · with ${studioGroup.name}` : ""}`
            : "Sessions, Quests, trips and breaks."
        }
      >
        {canAttendance && (
          <div className="flex rounded-lg border border-gray-200 bg-white p-0.5">
            {(
              [
                ["calendar", "Calendar", CalendarDays],
                ["attendance", "Attendance", CalendarCheck],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  tab === id ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
        )}
        {canEdit && tab === "calendar" && (
          <button onClick={() => setEditing({ item: null, draft: { startDate: cursor, endDate: cursor } })} className="btn-primary">
            <Plus className="h-4 w-4" /> Create
          </button>
        )}
      </PageHeader>

      {notice && (
        <div className="mb-4">
          <Banner tone="error" action={<button className="btn-ghost btn-sm" onClick={() => setNotice(null)}>Dismiss</button>}>
            {notice}
          </Banner>
        </div>
      )}

      {/* Which calendar: studio, group, academy */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
          {(
            [
              ["studio", "Studio", studioId === null],
              ["group", "Studio group", groupOptions.length === 0],
              ["academy", "Whole academy", false],
            ] as const
          ).map(([id, label, disabled]) => (
            <button
              key={id}
              disabled={disabled}
              onClick={() => setLensView(id)}
              className={`rounded-md px-3 py-1.5 font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                view === id ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {view === "studio" && studios.length > 1 && (
          <select className="input w-auto" value={studioId ?? ""} onChange={(event) => switchStudio(Number(event.target.value))}>
            {studios.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        )}
        {view === "group" && groupOptions.length > 0 && (
          <select
            className="input w-auto"
            value={target ?? ""}
            onChange={(event) => setGroupTarget(Number(event.target.value))}
          >
            {target === null && <option value="">Pick a group</option>}
            {groupOptions.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        )}
        {data && data.guides.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span className="text-gray-400">Guides</span>
            <div className="flex -space-x-1.5">
              {data.guides.slice(0, 5).map((guide) => (
                <span key={guide.userId} title={guide.name} className="rounded-full ring-2 ring-white">
                  <Avatar name={guide.name} src={guide.avatarUrl} size={24} />
                </span>
              ))}
            </div>
            <span className="hidden truncate sm:inline">{data.guides.map((guide) => guide.name.split(" ")[0]).join(", ")}</span>
          </div>
        )}
      </div>

      {tab === "attendance" && canAttendance ? (
        <>
          <Toolbar
            mode="month"
            cursor={cursor}
            weekStartsOn={prefs.weekStartsOn}
            onCursor={setCursor}
            fixedMonth
          />
          <AttendanceView
            cursor={cursor}
            weekStartsOn={prefs.weekStartsOn}
            view={view}
            target={target}
            studios={data?.studios ?? []}
            canRecord={canEdit}
          />
        </>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[15rem_minmax(0,1fr)]">
          {/* Sidebar */}
          <aside className="hidden space-y-4 xl:block">
            <MiniMonth cursor={cursor} weekStartsOn={prefs.weekStartsOn} items={data?.items ?? []} onPick={setCursor} />

            {todaysSessions.length > 0 && (
              <div className="card p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Right now</div>
                {todaysSessions.map((session) => (
                  <button key={session.key} onClick={() => setOpened(session)} className="mt-1.5 block w-full text-left">
                    <div className="text-sm font-semibold text-gray-900">
                      {session.title} · Week {sessionWeek(session.occurrenceStart, today, prefs.weekStartsOn)}
                    </div>
                    {session.quest && <div className="text-sm text-purple-700">Quest: {session.quest}</div>}
                    <div className="text-xs text-gray-500">
                      {daysBetween(today, session.occurrenceEnd)} days left · {session.ownerLabel}
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div className="card p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Show</div>
              <div className="space-y-1">
                {CALENDAR_KIND_LIST.map((kind) => (
                  <label key={kind} className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={!prefs.hiddenKinds.includes(kind)}
                      onChange={(event) =>
                        setPrefs({
                          hiddenKinds: event.target.checked
                            ? prefs.hiddenKinds.filter((entry) => entry !== kind)
                            : [...prefs.hiddenKinds, kind],
                        })
                      }
                      style={{ accentColor: KIND_COLORS[kind] }}
                    />
                    {KIND_LABELS[kind]}s
                  </label>
                ))}
                <label className="flex cursor-pointer items-center gap-2 border-t border-gray-100 pt-1.5 text-sm text-gray-700">
                  <input type="checkbox" checked={!prefs.hideTownHalls} onChange={(event) => setPrefs({ hideTownHalls: !event.target.checked })} />
                  Town Halls
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={!prefs.hideElections} onChange={(event) => setPrefs({ hideElections: !event.target.checked })} />
                  Election deadlines
                </label>
              </div>
            </div>

            {taconSources.length > 0 && (
              <div className="card p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">From Tac-Ons</div>
                <div className="space-y-1">
                  {taconSources.map((source) => (
                    <label key={source.installId} className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={!prefs.hiddenTacons.includes(source.installId)}
                        onChange={(event) =>
                          setPrefs({
                            hiddenTacons: event.target.checked
                              ? prefs.hiddenTacons.filter((id) => id !== source.installId)
                              : [...prefs.hiddenTacons, source.installId],
                          })
                        }
                        style={{ accentColor: source.color }}
                      />
                      <Puzzle className="h-3.5 w-3.5 text-gray-400" />
                      <span className="truncate">{source.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {data && data.studios.length > 1 && (
              <div className="card p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Studios</div>
                <div className="space-y-1">
                  {data.studios.map((entry) => (
                    <label key={entry.id} className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={!prefs.hiddenStudios.includes(entry.id)}
                        onChange={(event) =>
                          setPrefs({
                            hiddenStudios: event.target.checked
                              ? prefs.hiddenStudios.filter((id) => id !== entry.id)
                              : [...prefs.hiddenStudios, entry.id],
                          })
                        }
                        style={{ accentColor: entry.color }}
                      />
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: entry.color }} />
                      {entry.name}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="card space-y-2 p-3 text-sm text-gray-700">
              <label className="flex items-center justify-between gap-2">
                Colour by
                <select
                  className="input w-auto py-1 text-xs"
                  value={prefs.colorBy}
                  onChange={(event) => setPrefs({ colorBy: event.target.value as Prefs["colorBy"] })}
                >
                  <option value="studio">Studio</option>
                  <option value="kind">Kind</option>
                </select>
              </label>
              <label className="flex items-center justify-between gap-2">
                Week starts
                <select
                  className="input w-auto py-1 text-xs"
                  value={prefs.weekStartsOn}
                  onChange={(event) => setPrefs({ weekStartsOn: Number(event.target.value) as 0 | 1 })}
                >
                  <option value={0}>Sunday</option>
                  <option value={1}>Monday</option>
                </select>
              </label>
              <button onClick={() => downloadIcs(items, data?.label ?? "Calendar")} className="btn-secondary btn-sm w-full">
                <Download className="h-3.5 w-3.5" /> Export what's shown (.ics)
              </button>
              <p className="text-[11px] leading-snug text-gray-400">
                Shortcuts: <kbd>t</kbd> today, <kbd>d w m y a</kbd> views, <kbd>j</kbd>/<kbd>k</kbd> next/previous
                {canEdit && (
                  <>
                    , <kbd>c</kbd> create
                  </>
                )}
                , <kbd>/</kbd> search.
              </p>
            </div>
          </aside>

          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Toolbar mode={prefs.mode} cursor={cursor} weekStartsOn={prefs.weekStartsOn} onCursor={setCursor} />
              {query.isFetching && <Spinner className="h-4 w-4 text-gray-400" />}
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <SearchBox inputRef={searchRef} onPick={(item) => {
                  setCursor(item.occurrenceStart);
                  setOpened(item);
                }} />
                <div className="flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
                  {MODES.map((entry) => (
                    <button
                      key={entry.id}
                      onClick={() => setPrefs({ mode: entry.id })}
                      title={`${entry.label} (${entry.key})`}
                      className={`rounded-md px-2.5 py-1 font-medium transition ${
                        prefs.mode === entry.id ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-100"
                      }`}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {query.error && <Banner tone="error">{(query.error as Error).message}</Banner>}
            {view === "group" && target === null && <Banner tone="info">Pick a studio group to see its calendar.</Banner>}

            {prefs.mode === "month" && (
              <MonthView cursor={cursor} weekStartsOn={prefs.weekStartsOn} entries={entries} items={items} byStudio={byStudio} interaction={interaction} />
            )}
            {(prefs.mode === "week" || prefs.mode === "day") && (
              <TimeGridView
                days={prefs.mode === "day" ? [cursor] : eachDay(from, to)}
                weekStartsOn={prefs.weekStartsOn}
                entries={entries}
                items={items}
                byStudio={byStudio}
                interaction={interaction}
              />
            )}
            {prefs.mode === "year" && (
              <YearView
                year={Number(cursor.slice(0, 4))}
                weekStartsOn={prefs.weekStartsOn}
                entries={entries}
                items={items}
                byStudio={byStudio}
                onDay={interaction.onDay}
                onOpen={setOpened}
              />
            )}
            {prefs.mode === "agenda" && (
              <AgendaView
                from={from}
                weekStartsOn={prefs.weekStartsOn}
                to={to}
                entries={entries}
                items={items}
                onOpen={interaction.onOpen}
                onDay={interaction.onDay}
                onMore={() => setAgendaDays((days) => Math.min(380, days + 60))}
              />
            )}
            {!canEdit && (
              <p className="text-xs text-gray-400">Your guides keep this calendar. Ask them if something's missing.</p>
            )}
          </div>
        </div>
      )}

      <TaconPanels host="calendar" />

      {opened && (
        <EventDetails
          item={opened}
          canEdit={canEdit}
          onClose={() => setOpened(null)}
          onEdit={() => {
            setEditing({ item: opened, draft: null });
            setOpened(null);
          }}
          onDuplicate={() => {
            setEditing({ item: { ...opened, id: 0, recurrence: null, startDate: opened.occurrenceStart, endDate: opened.occurrenceEnd }, draft: null });
            setOpened(null);
          }}
        />
      )}
      {openedTacon && (
        <Modal open onClose={() => setOpenedTacon(null)} title={openedTacon.title}>
          <div className="space-y-2 text-sm text-gray-700">
            <div>
              {openedTacon.start === openedTacon.end
                ? formatDay(openedTacon.start, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
                : `${formatDay(openedTacon.start, { month: "short", day: "numeric" })} – ${formatDay(openedTacon.end, { month: "short", day: "numeric", year: "numeric" })}`}
              {openedTacon.startTime && ` · ${openedTacon.startTime}`}
            </div>
            <div className="flex items-center gap-1.5 text-gray-500">
              <Puzzle className="h-4 w-4" /> {KIND_LABELS[openedTacon.kind]} from the {openedTacon.taconName} Tac-On. Change it there.
            </div>
            {openedTacon.href && (
              <button
                onClick={() => {
                  navigate(openedTacon.href!);
                  setOpenedTacon(null);
                }}
                className="btn-primary mt-2"
              >
                Open {openedTacon.taconName}
              </button>
            )}
          </div>
        </Modal>
      )}
      {editing && (
        <EventEditor
          item={editing.item}
          draft={editing.draft}
          defaultOwner={defaultOwner}
          onClose={() => setEditing(null)}
        />
      )}
      {moving && (
        <SeriesModeModal
          verb="Change"
          onClose={() => setMoving(null)}
          onPick={(mode) => {
            move.mutate({ ...moving, mode });
            setMoving(null);
          }}
        />
      )}
    </>
  );
}

/* -------------------------------- toolbar --------------------------------- */

function Toolbar({
  mode,
  cursor,
  weekStartsOn,
  onCursor,
  fixedMonth = false,
}: {
  mode: ViewMode;
  cursor: string;
  weekStartsOn: number;
  onCursor: (day: string) => void;
  fixedMonth?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 ${fixedMonth ? "mb-4" : ""}`}>
      <button onClick={() => onCursor(localToday())} className="btn-secondary btn-sm">
        Today
      </button>
      <button onClick={() => onCursor(step(mode, cursor, -1))} className="btn-ghost p-1.5" aria-label="Previous">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button onClick={() => onCursor(step(mode, cursor, 1))} className="btn-ghost p-1.5" aria-label="Next">
        <ChevronRight className="h-4 w-4" />
      </button>
      <h2 className="text-lg font-semibold text-gray-900">{heading(mode, cursor, weekStartsOn)}</h2>
    </div>
  );
}

/* ------------------------------- mini month ------------------------------- */

function MiniMonth({
  cursor,
  weekStartsOn,
  items,
  onPick,
}: {
  cursor: string;
  weekStartsOn: number;
  items: CalendarItem[];
  onPick: (day: string) => void;
}) {
  const [shown, setShown] = useState(cursor.slice(0, 7));
  useEffect(() => setShown(cursor.slice(0, 7)), [cursor]);
  const days = monthGrid(`${shown}-01`, weekStartsOn);
  const today = localToday();
  const busy = new Set(
    items.flatMap((item) => eachDay(item.occurrenceStart, item.occurrenceEnd < item.occurrenceStart ? item.occurrenceStart : item.occurrenceEnd)),
  );

  return (
    <div className="card p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-900">{formatDay(`${shown}-01`, { month: "long", year: "numeric" })}</span>
        <div className="flex">
          <button onClick={() => setShown(addMonths(`${shown}-01`, -1).slice(0, 7))} className="btn-ghost p-1" aria-label="Previous month">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setShown(addMonths(`${shown}-01`, 1).slice(0, 7))} className="btn-ghost p-1" aria-label="Next month">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px]">
        {days.slice(0, 7).map((day) => (
          <div key={day} className="py-1 font-semibold text-gray-400">
            {formatDay(day, { weekday: "narrow" })}
          </div>
        ))}
        {days.map((day) => (
          <button
            key={day}
            onClick={() => onPick(day)}
            className={`relative mx-auto flex h-7 w-7 items-center justify-center rounded-full ${
              day === today
                ? "bg-brand-600 font-semibold text-white"
                : day === cursor
                  ? "bg-brand-100 font-semibold text-brand-800"
                  : day.slice(0, 7) === shown
                    ? "text-gray-700 hover:bg-gray-100"
                    : "text-gray-300 hover:bg-gray-100"
            }`}
          >
            {Number(day.slice(8))}
            {busy.has(day) && day !== today && <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-gray-400" />}
          </button>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------- search --------------------------------- */

function SearchBox({
  inputRef,
  onPick,
}: {
  inputRef: React.RefObject<HTMLInputElement>;
  onPick: (item: CalendarItem) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [q]);

  const results = useQuery<{ items: CalendarItem[] }>({
    queryKey: ["calendar", "search", debounced],
    queryFn: () => apiGet(`/calendar/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
  });

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-gray-400" />
      <input
        ref={inputRef}
        value={q}
        onChange={(event) => {
          setQ(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => event.key === "Escape" && (event.currentTarget.blur(), setQ(""))}
        placeholder="Search"
        className="input w-44 py-1.5 pl-8"
      />
      {open && debounced.length >= 2 && (
        <div className="absolute right-0 z-30 mt-1 max-h-80 w-80 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {results.isLoading && (
            <div className="p-3 text-sm text-gray-500">
              <Spinner className="inline h-3.5 w-3.5" /> Searching...
            </div>
          )}
          {results.data?.items.length === 0 && <div className="p-3 text-sm text-gray-500">Nothing matches.</div>}
          {results.data?.items.map((item) => (
            <button
              key={item.key}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onPick(item);
                setOpen(false);
              }}
              className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-gray-50"
            >
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: item.color ?? KIND_COLORS[item.kind] }} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-gray-900">{item.title}</span>
                <span className="block text-xs text-gray-500">
                  {formatDay(item.startDate, { month: "short", day: "numeric", year: "numeric" })} · {KIND_LABELS[item.kind]} · {item.ownerLabel}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
