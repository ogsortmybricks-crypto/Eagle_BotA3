/**
 * Accountability partners: the pairing screen, each partner's dashboard, and
 * the guide's overview.
 *
 * The server sends raw check-in dates and the weekly standing is worked out
 * here, on the viewer's own calendar, with the same helpers the server uses.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarCheck,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  ImageOff,
  Plus,
  Shuffle,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { apiPost, getApiStudio } from "@/lib/api";
import { Banner, Chip, Spinner, type ChipTone } from "@/components/ui";
import {
  ON_TRACK,
  ON_TRACK_LABELS,
  SHOT_MAX_CHARS,
  SHOTS_PER_SUBJECT,
  WEEKDAY_LABELS,
  WEEKDAYS,
  addDays,
  localDay,
  weekDays,
  weekStanding,
  weekStart,
  type OnTrack,
  type WeekStatus,
} from "@shared/tacons/partners";
import type {
  PartnerCheckin,
  PartnerGroup,
  PartnerPerson,
  ViewPartners,
} from "@shared/tacons/view";
import type { RenderTarget } from "./Renderer";

type Props = { view: ViewPartners; target: RenderTarget };
type Notice = { tone: "success" | "error"; text: string } | null;

const targetFields = (target: RenderTarget) => ({
  ...(target.page ? { page: target.page } : {}),
  ...(target.panel ? { panel: target.panel } : {}),
  ...(target.position ? { position: target.position } : {}),
});

const STATUS_CHIP: Record<WeekStatus, { tone: ChipTone; label: string }> = {
  met: { tone: "green", label: "Met" },
  "on-pace": { tone: "blue", label: "On pace" },
  behind: { tone: "amber", label: "Behind" },
  missed: { tone: "red", label: "Missed" },
};

const ON_TRACK_TONE: Record<OnTrack, ChipTone> = {
  "on-track": "green",
  "slightly-behind": "amber",
  "off-track": "red",
};

function firstName(name: string) {
  return name.split(/\s+/)[0] || name;
}

function prettyDay(day: string) {
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** Distinct days `checker` checked in on `targetId`. */
function daysChecked(checkins: PartnerCheckin[], checkerId: number, targetId: number) {
  return checkins.filter((c) => c.checkerId === checkerId && c.targetId === targetId).map((c) => c.date);
}

function usePartnersApi(view: ViewPartners, target: RenderTarget) {
  const queryClient = useQueryClient();
  const base = `/tacons/view/${target.installId}/partners/${encodeURIComponent(view.partners)}`;
  const body = (extra: Record<string, unknown>) => ({ ...targetFields(target), index: view.index, ...extra });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["tacon-view"] });
    void queryClient.invalidateQueries({ queryKey: ["tacon-desks"] });
    target.onChanged();
  };
  const shotUrl = (id: number) => {
    const params = new URLSearchParams({ ...targetFields(target), index: String(view.index) });
    return `/api${base}/shots/${id}?${params}`;
  };
  return { base, body, refresh, shotUrl };
}

/* -------------------------------------------------------------------------- */
/*  The widget                                                                 */
/* -------------------------------------------------------------------------- */

type Tab = { key: string; label: string };

export function PartnersView({ view, target }: Props) {
  const today = localDay();
  const manager = view.manage !== null;
  const noGroupsYet = manager && view.manage!.groups.every((group) => !group.active);

  const tabs: Tab[] = [];
  if (view.group) tabs.push({ key: "mine", label: "My AP dashboard" });
  if (manager) {
    tabs.push({ key: "overview", label: "This week" });
    tabs.push({ key: "pairings", label: "Pairings" });
  }
  const [tab, setTab] = useState(() => (noGroupsYet ? "pairings" : tabs[0]?.key ?? "mine"));

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
            <Users className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">{view.title}</h2>
            <p className="text-xs text-gray-500">
              Check in at least {view.required} day{view.required === 1 ? "" : "s"} a week
              {view.due !== null && <>, including {WEEKDAYS[view.due].replace(/^./, (c) => c.toUpperCase())}</>}.
              Every day is better.
            </p>
          </div>
        </div>
        {tabs.length > 1 && (
          <nav className="flex flex-wrap gap-1 rounded-lg bg-white p-1 ring-1 ring-gray-200" aria-label="Partner views">
            {tabs.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => setTab(entry.key)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === entry.key ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}
              >
                {entry.label}
              </button>
            ))}
          </nav>
        )}
      </header>

      <div className="p-4 sm:p-6">
        {tab === "pairings" && manager ? (
          <Pairings view={view} target={target} />
        ) : tab === "overview" && manager ? (
          <Overview view={view} target={target} today={today} />
        ) : view.group && view.me ? (
          <MemberDashboard view={view} target={target} me={view.me} group={view.group} today={today} />
        ) : (
          <div className="rounded-xl border border-dashed border-gray-300 px-5 py-10 text-center">
            <Users className="mx-auto h-7 w-7 text-gray-400" aria-hidden="true" />
            <p className="mt-2 font-medium text-gray-800">You don't have an accountability partner yet</p>
            <p className="mt-1 text-sm text-gray-500">A guide or admin will pair you up. Your dashboard appears here once they do.</p>
          </div>
        )}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  A partner's dashboard: "You" plus one tab per partner                      */
/* -------------------------------------------------------------------------- */

function MemberDashboard({
  view, target, me, group, today,
}: Props & { me: PartnerPerson; group: PartnerGroup; today: string }) {
  const others = group.members.filter((member) => member.id !== me.id);
  const [tab, setTab] = useState<number>(0); // 0 = You, otherwise a partner's id

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2 border-b border-gray-200" role="tablist">
        {[{ id: 0, name: "You" }, ...others].map((person) => (
          <button
            key={person.id}
            type="button"
            role="tab"
            aria-selected={tab === person.id}
            onClick={() => setTab(person.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === person.id ? "border-brand-600 text-brand-700" : "border-transparent text-gray-500 hover:text-gray-800"}`}
          >
            {person.name}
          </button>
        ))}
      </div>
      {tab === 0 ? (
        <YouTab view={view} target={target} me={me} others={others} today={today} onOpen={setTab} />
      ) : (
        <PartnerTab
          key={tab}
          view={view}
          target={target}
          me={me}
          partner={others.find((person) => person.id === tab) ?? others[0]}
          today={today}
        />
      )}
    </div>
  );
}

function YouTab({
  view, target, me, others, today, onOpen,
}: Props & { me: PartnerPerson; others: PartnerPerson[]; today: string; onOpen: (id: number) => void }) {
  const week = weekStart(today);
  const aboutMe = view.checkins.filter((checkin) => checkin.targetId === me.id);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-2">
        {others.map((partner) => {
          const days = daysChecked(view.checkins, me.id, partner.id);
          const standing = weekStanding({ days, required: view.required, due: view.due, today, week });
          const doneToday = days.includes(today);
          return (
            <div key={partner.id} className="card-pad">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Your check-ins on {firstName(partner.name)}</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">
                    {standing.done}<span className="text-base font-medium text-gray-400"> / {view.required}</span>
                  </p>
                </div>
                <Chip tone={STATUS_CHIP[standing.status].tone}>{STATUS_CHIP[standing.status].label}</Chip>
              </div>
              <WeekStrip days={days} week={week} today={today} due={view.due} />
              <p className="mt-3 text-sm text-gray-600">{standing.summary}</p>
              <button type="button" className={`${doneToday ? "btn-secondary" : "btn-primary"} mt-3 w-full`} onClick={() => onOpen(partner.id)}>
                {doneToday ? <><Check className="h-4 w-4" /> Checked in today — review</> : <>Check in on {firstName(partner.name)} now</>}
              </button>
            </div>
          );
        })}
      </div>

      <GoalsEditor view={view} target={target} me={me} today={today} />

      <section>
        <h3 className="font-semibold text-gray-900">What your partner{others.length > 1 ? "s" : ""} recorded about you</h3>
        <p className="mt-1 text-sm text-gray-500">This is what your guide sees too.</p>
        <div className="mt-3">
          <CheckinList view={view} target={target} checkins={aboutMe} empty="No check-ins on you yet this period." />
        </div>
      </section>

      {others.map((partner) => (
        <PastWeeks key={partner.id} view={view} checkerId={me.id} targetId={partner.id} today={today}
          label={`Your record checking in on ${firstName(partner.name)}`} />
      ))}
    </div>
  );
}

function PartnerTab({
  view, target, me, partner, today,
}: Props & { me: PartnerPerson; partner: PartnerPerson; today: string }) {
  const week = weekStart(today);
  const days = daysChecked(view.checkins, me.id, partner.id);
  const standing = weekStanding({ days, required: view.required, due: view.due, today, week });
  const goals = view.goals.find((entry) => entry.personId === partner.id && entry.week === week);
  const aboutThem = view.checkins.filter((checkin) => checkin.targetId === partner.id);
  const todays = view.checkins.find((c) => c.checkerId === me.id && c.targetId === partner.id && c.date === today) ?? null;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="card-pad">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-gray-900">This week</h3>
            <Chip tone={STATUS_CHIP[standing.status].tone}>{STATUS_CHIP[standing.status].label}</Chip>
          </div>
          <WeekStrip days={days} week={week} today={today} due={view.due} />
          <p className="mt-3 text-sm text-gray-600">
            {standing.done} of {view.required} check-ins done. {standing.summary}
          </p>
        </div>
        <div className="card-pad">
          <h3 className="font-semibold text-gray-900">{firstName(partner.name)}'s goals this week</h3>
          {view.core.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">No core goals are tracked here.</p>
          ) : (
            <dl className="mt-2 space-y-2 text-sm">
              {view.core.map((subject) => (
                <div key={subject}>
                  <dt className="font-medium text-gray-700">{subject}</dt>
                  <dd className="text-gray-600">{goals?.goals[subject] || <span className="italic text-gray-400">Not set yet — ask them at your check-in.</span>}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>

      <CheckinForm view={view} target={target} partner={partner} today={today} existing={todays} goals={goals?.goals ?? {}} />

      <section>
        <h3 className="font-semibold text-gray-900">Check-ins on {firstName(partner.name)}</h3>
        <div className="mt-3">
          <CheckinList view={view} target={target} checkins={aboutThem} empty={`Nobody has checked in on ${firstName(partner.name)} yet.`} />
        </div>
      </section>
    </div>
  );
}

/* --------------------------------- calendar -------------------------------- */

function WeekStrip({ days, week, today, due }: { days: string[]; week: string; today: string; due: number | null }) {
  const checked = new Set(days);
  const all = weekDays(week);
  // Weekends only show if something happened on them.
  const shown = all.filter((day, index) => index < 5 || checked.has(day));
  return (
    <ol className="mt-3 flex gap-1.5" aria-label="Check-ins this week">
      {shown.map((day) => {
        const isDue = due !== null && new Date(`${day}T00:00:00Z`).getUTCDay() === due;
        const done = checked.has(day);
        const past = day < today;
        const label = WEEKDAY_LABELS[new Date(`${day}T00:00:00Z`).getUTCDay()];
        return (
          <li
            key={day}
            title={`${prettyDay(day)}${done ? " — checked in" : ""}${isDue ? " (required)" : ""}`}
            className={`flex flex-1 flex-col items-center rounded-lg border px-1 py-1.5 text-xs ${
              done
                ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                : day === today
                  ? "border-brand-400 bg-brand-50 text-brand-800"
                  : past
                    ? "border-gray-200 bg-gray-50 text-gray-400"
                    : "border-gray-200 text-gray-600"
            }`}
          >
            <span className={`font-semibold ${isDue ? "underline decoration-2 underline-offset-2" : ""}`}>{label}</span>
            <span className="mt-0.5 h-4">
              {done ? <Check className="h-4 w-4" aria-label="done" /> : day === today ? "today" : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function PastWeeks({
  view, checkerId, targetId, today, label,
}: { view: ViewPartners; checkerId: number; targetId: number; today: string; label: string }) {
  const days = daysChecked(view.checkins, checkerId, targetId);
  const current = weekStart(today);
  const weeks = [1, 2, 3, 4, 5].map((back) => addDays(current, -7 * back));
  return (
    <section>
      <h3 className="text-sm font-semibold text-gray-700">{label}</h3>
      <ul className="mt-2 flex flex-wrap gap-2">
        {weeks.map((week) => {
          const standing = weekStanding({ days, required: view.required, due: view.due, today, week });
          return (
            <li key={week} className="rounded-lg border border-gray-200 px-3 py-2 text-xs">
              <div className="text-gray-500">Week of {prettyDay(week)}</div>
              <div className="mt-1 flex items-center gap-2">
                <span className="font-semibold tabular-nums text-gray-800">{standing.done}/{view.required}</span>
                <Chip tone={STATUS_CHIP[standing.status].tone}>{STATUS_CHIP[standing.status].label}</Chip>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ----------------------------------- goals --------------------------------- */

function GoalsEditor({ view, target, me, today }: Props & { me: PartnerPerson; today: string }) {
  const api = usePartnersApi(view, target);
  const week = weekStart(today);
  const saved = view.goals.find((entry) => entry.personId === me.id && entry.week === week);
  const [goals, setGoals] = useState<Record<string, string>>(saved?.goals ?? {});
  const [notice, setNotice] = useState<Notice>(null);
  useEffect(() => setGoals(saved?.goals ?? {}), [saved?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => apiPost(`${api.base}/goals`, api.body({ week, goals })),
    onSuccess: () => {
      setNotice({ tone: "success", text: "Goals saved. Your partner can see them." });
      api.refresh();
    },
    onError: (error: Error) => setNotice({ tone: "error", text: error.message }),
  });

  if (view.core.length === 0) return null;
  const empty = view.core.every((subject) => !saved?.goals[subject]);

  return (
    <section className="card-pad">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-gray-900">Your goals for the week of {prettyDay(week)}</h3>
        {saved && <span className="text-xs text-gray-400">Saved {new Date(saved.updatedAt).toLocaleString()}</span>}
      </div>
      {empty && (
        <p className="mt-1 text-sm text-amber-700">Set these on Monday so your partner knows what to hold you to.</p>
      )}
      {notice && <div className="mt-3"><Banner tone={notice.tone}>{notice.text}</Banner></div>}
      <form
        className="mt-3 grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          setNotice(null);
          save.mutate();
        }}
      >
        {view.core.map((subject) => (
          <label key={subject} className="text-sm">
            <span className="label">{subject}</span>
            <input
              className="input"
              maxLength={300}
              placeholder={`e.g. Finish 3 ${subject.toLowerCase()} units`}
              value={goals[subject] ?? ""}
              onChange={(event) => setGoals({ ...goals, [subject]: event.target.value })}
            />
          </label>
        ))}
        <div className="sm:col-span-2">
          <button className="btn-primary" type="submit" disabled={save.isPending}>
            {save.isPending && <Spinner />} Save my goals
          </button>
        </div>
      </form>
    </section>
  );
}

/* --------------------------------- check-in -------------------------------- */

type CoreDraft = { goal: string; progress: string; percent: string };
type EvidenceDraft = { notes: string; shots: number[] };

function CheckinForm({
  view, target, partner, today, existing, goals,
}: Props & { partner: PartnerPerson; today: string; existing: PartnerCheckin | null; goals: Record<string, string> }) {
  const api = usePartnersApi(view, target);
  const initialCore = () => Object.fromEntries(view.core.map((subject) => {
    const entry = existing?.core.find((candidate) => candidate.subject === subject);
    return [subject, {
      goal: entry?.goal || goals[subject] || "",
      progress: entry?.progress ?? "",
      percent: entry?.percent === null || entry?.percent === undefined ? "" : String(entry.percent),
    }];
  })) as Record<string, CoreDraft>;
  const initialEvidence = () => Object.fromEntries(view.evidence.map((subject) => {
    const entry = existing?.evidence.find((candidate) => candidate.subject === subject);
    return [subject, { notes: entry?.notes ?? "", shots: entry?.shots ?? [] }];
  })) as Record<string, EvidenceDraft>;

  const [core, setCore] = useState(initialCore);
  const [evidence, setEvidence] = useState(initialEvidence);
  const [onTrack, setOnTrack] = useState<OnTrack | "">(existing?.onTrack ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [notice, setNotice] = useState<Notice>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      apiPost(`${api.base}/checkins`, api.body({
        targetId: partner.id,
        date: today,
        core: view.core.map((subject) => ({
          subject,
          goal: core[subject].goal.trim(),
          progress: core[subject].progress.trim(),
          percent: core[subject].percent === "" ? null : Number(core[subject].percent),
        })),
        evidence: view.evidence.map((subject) => ({ subject, notes: evidence[subject].notes.trim(), shots: evidence[subject].shots })),
        onTrack,
        notes: notes.trim(),
      })),
    onSuccess: () => {
      setNotice({ tone: "success", text: existing ? "Today's check-in updated." : `Check-in saved. Nice work holding ${firstName(partner.name)} to it.` });
      api.refresh();
    },
    onError: (error: Error) => setNotice({ tone: "error", text: error.message }),
  });

  const addShots = async (subject: string, files: FileList | null) => {
    if (!files) return;
    setNotice(null);
    setUploading(subject);
    try {
      for (const file of Array.from(files)) {
        if (evidence[subject].shots.length >= SHOTS_PER_SUBJECT) break;
        const image = await compressImage(file);
        const { id } = await apiPost<{ id: number }>(`${api.base}/shots`, api.body({ image }));
        setEvidence((current) => ({
          ...current,
          [subject]: { ...current[subject], shots: [...current[subject].shots, id].slice(0, SHOTS_PER_SUBJECT) },
        }));
      }
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "That screenshot couldn't be uploaded." });
    } finally {
      setUploading(null);
    }
  };

  return (
    <section className="rounded-xl border border-brand-200 bg-brand-50/40 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold text-gray-900">
          <CalendarCheck className="h-5 w-5 text-brand-600" aria-hidden="true" />
          {existing ? `Today's check-in on ${firstName(partner.name)}` : `Check in on ${firstName(partner.name)} — ${prettyDay(today)}`}
        </h3>
        {existing && <Chip tone="green"><Check className="h-3 w-3" /> Counted for today</Chip>}
      </div>
      <p className="mt-1 text-sm text-gray-600">
        {existing
          ? "You've already checked in today. Saving again updates it — it still counts once."
          : "Ask them to show you their work. Write what you saw, not what they said they'd do."}
      </p>
      {notice && <div className="mt-3"><Banner tone={notice.tone}>{notice.text}</Banner></div>}

      <form
        className="mt-4 space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!onTrack) {
            setNotice({ tone: "error", text: `Choose whether ${firstName(partner.name)} is on track for the week.` });
            return;
          }
          setNotice(null);
          save.mutate();
        }}
      >
        {view.core.length > 0 && (
          <fieldset>
            <legend className="text-sm font-semibold uppercase tracking-wide text-gray-500">Core goals</legend>
            <div className="mt-2 space-y-3">
              {view.core.map((subject) => (
                <div key={subject} className="grid gap-2 rounded-lg border border-gray-200 bg-white p-3 sm:grid-cols-[1fr_1fr_110px]">
                  <label className="text-sm">
                    <span className="label">{subject} — goal this week</span>
                    <input className="input" maxLength={300} value={core[subject].goal}
                      onChange={(event) => setCore({ ...core, [subject]: { ...core[subject], goal: event.target.value } })} />
                  </label>
                  <label className="text-sm">
                    <span className="label">Progress so far</span>
                    <input className="input" maxLength={500} placeholder="What have they actually finished?" value={core[subject].progress}
                      onChange={(event) => setCore({ ...core, [subject]: { ...core[subject], progress: event.target.value } })} />
                  </label>
                  <label className="text-sm">
                    <span className="label">% done</span>
                    <input className="input" type="number" min={0} max={100} step={5} inputMode="numeric" value={core[subject].percent}
                      onChange={(event) => setCore({ ...core, [subject]: { ...core[subject], percent: event.target.value } })} />
                  </label>
                </div>
              ))}
            </div>
          </fieldset>
        )}

        {view.evidence.length > 0 && (
          <fieldset>
            <legend className="text-sm font-semibold uppercase tracking-wide text-gray-500">Show the work</legend>
            <div className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {view.evidence.map((subject) => (
                <div key={subject} className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-800">{subject}</span>
                    <span className="text-xs text-gray-400">{evidence[subject].shots.length}/{SHOTS_PER_SUBJECT} screenshots</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {evidence[subject].shots.map((id) => (
                      <div key={id} className="relative">
                        <Shot url={api.shotUrl(id)} className="h-16 w-24" />
                        <button
                          type="button"
                          aria-label="Remove screenshot"
                          className="absolute -right-1.5 -top-1.5 rounded-full bg-white p-0.5 shadow ring-1 ring-gray-200"
                          onClick={() => setEvidence({ ...evidence, [subject]: { ...evidence[subject], shots: evidence[subject].shots.filter((shot) => shot !== id) } })}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    {evidence[subject].shots.length < SHOTS_PER_SUBJECT && (
                      <label className="flex h-16 w-24 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-gray-300 text-xs text-gray-500 hover:bg-gray-50">
                        {uploading === subject ? <Spinner /> : <Camera className="h-4 w-4" aria-hidden="true" />}
                        <span className="mt-1">Add</span>
                        <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="sr-only"
                          disabled={uploading !== null}
                          onChange={(event) => { void addShots(subject, event.target.files); event.target.value = ""; }} />
                      </label>
                    )}
                  </div>
                  <label className="mt-2 block text-sm">
                    <span className="sr-only">{subject} notes</span>
                    <textarea className="input min-h-[72px]" maxLength={1000}
                      placeholder="How much is done? If some isn't, why not?"
                      value={evidence[subject].notes}
                      onChange={(event) => setEvidence({ ...evidence, [subject]: { ...evidence[subject], notes: event.target.value } })} />
                  </label>
                </div>
              ))}
            </div>
          </fieldset>
        )}

        <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
          <label className="text-sm">
            <span className="label">Is {firstName(partner.name)} on track for the week?</span>
            <select className="input" value={onTrack} required onChange={(event) => setOnTrack(event.target.value as OnTrack)}>
              <option value="">Choose one</option>
              {ON_TRACK.map((value) => <option key={value} value={value}>{ON_TRACK_LABELS[value]}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="label">Notes</span>
            <textarea className="input min-h-[42px]" maxLength={1000} placeholder="Anything they need to fix before the next check-in?"
              value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
        </div>

        <button className="btn-primary" type="submit" disabled={save.isPending || uploading !== null}>
          {save.isPending && <Spinner />} {existing ? "Update today's check-in" : "Save check-in"}
        </button>
      </form>
    </section>
  );
}

/** Shrinks a screenshot to something a phone can upload over school Wi-Fi. */
async function compressImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name} isn't an image.`);
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error(`${file.name} couldn't be opened.`));
      element.src = url;
    });
    for (const [edge, quality] of [[1600, 0.8], [1280, 0.7], [960, 0.6]] as const) {
      const scale = Math.min(1, edge / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) break;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/jpeg", quality);
      if (data.length <= SHOT_MAX_CHARS) return data;
    }
    throw new Error(`${file.name} is too large even after shrinking it.`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Screenshots are fetched with the studio header, so plain <img src> won't do. */
function Shot({ url, className = "" }: { url: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    const studio = getApiStudio();
    fetch(url, { credentials: "include", headers: { "X-Studio-Id": studio === null ? "all" : String(studio) } })
      .then((response) => (response.ok ? response.blob() : Promise.reject(new Error("unavailable"))))
      .then((blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => !revoked && setFailed(true));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (failed) {
    return <div className={`flex items-center justify-center rounded-md bg-gray-100 text-gray-400 ${className}`}><ImageOff className="h-4 w-4" /></div>;
  }
  if (!src) return <div className={`flex items-center justify-center rounded-md bg-gray-100 ${className}`}><Spinner /></div>;
  return (
    <a href={src} target="_blank" rel="noreferrer" title="Open full size">
      <img src={src} alt="Screenshot" className={`rounded-md object-cover ring-1 ring-gray-200 ${className}`} />
    </a>
  );
}

/* ------------------------------- check-in list ----------------------------- */

function CheckinList({
  view, target, checkins, empty,
}: Props & { checkins: PartnerCheckin[]; empty: string }) {
  const [showAll, setShowAll] = useState(false);
  if (checkins.length === 0) {
    return <p className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500">{empty}</p>;
  }
  const sorted = [...checkins].sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
  const shown = showAll ? sorted : sorted.slice(0, 5);
  return (
    <div className="space-y-3">
      {shown.map((checkin) => <CheckinCard key={checkin.id} view={view} target={target} checkin={checkin} />)}
      {sorted.length > shown.length && (
        <button type="button" className="btn-ghost btn-sm" onClick={() => setShowAll(true)}>
          Show {sorted.length - shown.length} older check-in{sorted.length - shown.length === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
}

function CheckinCard({ view, target, checkin }: Props & { checkin: PartnerCheckin }) {
  const api = usePartnersApi(view, target);
  const core = checkin.core.filter((entry) => entry.goal || entry.progress || entry.percent !== null);
  const evidence = checkin.evidence.filter((entry) => entry.notes || entry.shots.length > 0);
  return (
    <article className="rounded-xl border border-gray-200 bg-white p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-700">
          <span className="font-semibold text-gray-900">{prettyDay(checkin.date)}</span> · {checkin.checkerName} checked in on {checkin.targetName}
        </p>
        <Chip tone={ON_TRACK_TONE[checkin.onTrack]}>{ON_TRACK_LABELS[checkin.onTrack]}</Chip>
      </header>
      {core.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-sm">
          {core.map((entry) => (
            <li key={entry.subject} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-gray-800">{entry.subject}:</span>
              <span className="text-gray-600">{entry.progress || "—"}</span>
              {entry.goal && <span className="text-xs text-gray-400">(goal: {entry.goal})</span>}
              {entry.percent !== null && (
                <span className="ml-auto flex items-center gap-2 text-xs text-gray-500">
                  <span className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-100">
                    <span className="block h-full bg-brand-500" style={{ width: `${entry.percent}%` }} />
                  </span>
                  {entry.percent}%
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {evidence.length > 0 && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {evidence.map((entry) => (
            <div key={entry.subject} className="rounded-lg bg-gray-50 p-3">
              <p className="text-sm font-medium text-gray-800">{entry.subject}</p>
              {entry.notes && <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">{entry.notes}</p>}
              {entry.shots.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {entry.shots.map((id) => <Shot key={id} url={api.shotUrl(id)} className="h-20 w-28" />)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {checkin.notes && <p className="mt-3 whitespace-pre-wrap border-t border-gray-100 pt-3 text-sm text-gray-600">{checkin.notes}</p>}
    </article>
  );
}

/* --------------------------------- pairings -------------------------------- */

type Draft = number[][]; // each row: up to three ids, 0 for "nobody yet"

function draftFrom(groups: PartnerGroup[], trios: boolean): Draft {
  const rows = groups.filter((group) => group.active).map((group) => {
    const ids = group.members.map((member) => member.id);
    return trios ? [ids[0] ?? 0, ids[1] ?? 0, ids[2] ?? 0] : [ids[0] ?? 0, ids[1] ?? 0];
  });
  return rows.length > 0 ? rows : [trios ? [0, 0, 0] : [0, 0]];
}

function Pairings({ view, target }: Props) {
  const manage = view.manage!;
  const api = usePartnersApi(view, target);
  const width = view.trios ? 3 : 2;
  const savedDraft = useMemo(() => draftFrom(manage.groups, view.trios), [manage.groups, view.trios]);
  const [rows, setRows] = useState<Draft>(savedDraft);
  const [notice, setNotice] = useState<Notice>(null);
  // Keyed on content, so a background refetch doesn't wipe an edit in progress.
  const savedKey = JSON.stringify(savedDraft);
  useEffect(() => setRows(savedDraft), [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const names = new Map(manage.candidates.map((person) => [person.id, person]));
  for (const group of manage.groups) for (const member of group.members) {
    if (!names.has(member.id)) names.set(member.id, { ...member, role: "" });
  }
  const used = new Set(rows.flat().filter(Boolean));
  const unpaired = manage.candidates.filter((person) => !used.has(person.id));
  const dirty = JSON.stringify(rows) !== savedKey;

  const set = (row: number, column: number, id: number) =>
    setRows(rows.map((entry, index) => (index === row ? entry.map((value, col) => (col === column ? id : value)) : entry)));

  const pairTheRest = () => {
    const pool = [...unpaired.filter((person) => person.role === "learner")].sort(() => Math.random() - 0.5).map((p) => p.id);
    const next = rows.filter((row) => row.some(Boolean));
    while (pool.length >= 2) {
      const pair = pool.splice(0, view.trios && pool.length === 3 ? 3 : 2);
      next.push(Array.from({ length: width }, (_, index) => pair[index] ?? 0));
    }
    if (pool.length === 1) next.push(Array.from({ length: width }, (_, index) => (index === 0 ? pool[0] : 0)));
    setRows(next.length > 0 ? next : rows);
  };

  const save = useMutation({
    mutationFn: () => {
      const groups = rows.map((row) => row.filter(Boolean)).filter((row) => row.length > 0);
      const lonely = groups.find((row) => row.length < 2);
      if (lonely) throw new Error(`${names.get(lonely[0])?.name ?? "Someone"} needs a partner, or remove that row.`);
      return apiPost<{ kept: number; started: number; ended: number }>(`${api.base}/pairings`, api.body({ groups }));
    },
    onSuccess: (result) => {
      setNotice({ tone: "success", text: `Pairings saved: ${result.started} new, ${result.kept} unchanged, ${result.ended} ended. Past check-ins are kept.` });
      api.refresh();
    },
    onError: (error: Error) => setNotice({ tone: "error", text: error.message }),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-gray-900">Who holds who accountable</h3>
          <p className="mt-1 text-sm text-gray-500">
            Pick partners for each row{view.trios && "; fill AP 3 for a group of three"}. You can change these at any time —
            ending a pairing keeps its check-in history.
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Learners, secretaries and learner admins can be APs. Guides and other admins can't.
          </p>
        </div>
      </div>

      {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}

      <div className="scroll-x">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <th className="w-8 pb-2" />
              <th className="pb-2 pr-2">AP 1</th>
              <th className="pb-2 pr-2">AP 2</th>
              {view.trios && <th className="pb-2 pr-2">AP 3 <span className="font-normal normal-case text-gray-400">(optional)</span></th>}
              <th className="w-10 pb-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="align-top">
                <td className="py-1.5 pr-2 pt-3.5 text-xs tabular-nums text-gray-400">{rowIndex + 1}</td>
                {row.map((value, column) => (
                  <td key={column} className="py-1.5 pr-2">
                    <select className="input" value={value} aria-label={`Row ${rowIndex + 1}, AP ${column + 1}`}
                      onChange={(event) => set(rowIndex, column, Number(event.target.value))}>
                      <option value={0}>{column === 2 ? "— none —" : "Choose…"}</option>
                      {value !== 0 && !manage.candidates.some((person) => person.id === value) && (
                        <option value={value}>{names.get(value)?.name ?? "Someone"} (not eligible)</option>
                      )}
                      {manage.candidates
                        .filter((person) => person.id === value || !used.has(person.id))
                        .map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.name}{person.role !== "learner" ? ` (${person.role})` : ""}
                          </option>
                        ))}
                    </select>
                  </td>
                ))}
                <td className="py-1.5">
                  <button type="button" className="btn-ghost p-2" aria-label={`Remove row ${rowIndex + 1}`}
                    onClick={() => setRows(rows.length === 1 ? [Array(width).fill(0)] : rows.filter((_, index) => index !== rowIndex))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={() => setRows([...rows, Array(width).fill(0)])}>
          <Plus className="h-4 w-4" /> Add a row
        </button>
        {unpaired.some((person) => person.role === "learner") && (
          <button type="button" className="btn-secondary" onClick={pairTheRest}>
            <Shuffle className="h-4 w-4" /> Pair the rest randomly
          </button>
        )}
        <button type="button" className="btn-primary" disabled={!dirty || save.isPending} onClick={() => { setNotice(null); save.mutate(); }}>
          {save.isPending && <Spinner />} Save pairings
        </button>
        {dirty && <button type="button" className="btn-ghost" onClick={() => setRows(savedDraft)}>Undo changes</button>}
      </div>

      <div className="rounded-lg bg-gray-50 p-3 text-sm">
        <span className="font-medium text-gray-700">Not paired yet ({unpaired.length}): </span>
        <span className="text-gray-600">{unpaired.length === 0 ? "Everyone has a partner." : unpaired.map((person) => person.name).join(", ")}</span>
      </div>
    </div>
  );
}

/* --------------------------------- overview -------------------------------- */

function Overview({ view, target, today }: Props & { today: string }) {
  const current = weekStart(today);
  const [week, setWeek] = useState(current);
  const [open, setOpen] = useState<number | null>(null);
  const groups = view.manage!.groups.filter((group) => group.active);
  const oldest = addDays(current, -35);
  const weekEnd = addDays(week, 6);

  if (groups.length === 0) {
    return <p className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500">No pairings yet. Set them up under Pairings.</p>;
  }

  const groupRows = groups.map((group) => {
    const links = group.members.flatMap((checker) =>
      group.members.filter((other) => other.id !== checker.id).map((other) => {
        const days = daysChecked(view.checkins.filter((c) => c.groupId === group.id), checker.id, other.id);
        return { checker, other, standing: weekStanding({ days, required: view.required, due: view.due, today, week }) };
      }));
    const latest = (personId: number) =>
      view.checkins
        .filter((c) => c.groupId === group.id && c.targetId === personId && c.date >= week && c.date <= weekEnd)
        .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
    const worst: WeekStatus = (["missed", "behind", "on-pace", "met"] as WeekStatus[])
      .find((status) => links.some((link) => link.standing.status === status)) ?? "met";
    return { group, links, latest, worst };
  });
  const counts = { met: 0, "on-pace": 0, behind: 0, missed: 0 } as Record<WeekStatus, number>;
  for (const row of groupRows) counts[row.worst] += 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" className="btn-ghost p-2" aria-label="Previous week" disabled={week <= oldest} onClick={() => setWeek(addDays(week, -7))}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold text-gray-800">
            {week === current ? "This week" : `Week of ${prettyDay(week)}`}
          </span>
          <button type="button" className="btn-ghost p-2" aria-label="Next week" disabled={week >= current} onClick={() => setWeek(addDays(week, 7))}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {(Object.keys(counts) as WeekStatus[]).map((status) => (
            <Chip key={status} tone={STATUS_CHIP[status].tone}>{counts[status]} {STATUS_CHIP[status].label.toLowerCase()}</Chip>
          ))}
        </div>
      </div>
      <p className="text-xs text-gray-500">
        A group's standing is its weakest link: if one partner misses their check-ins, the whole group shows it.
      </p>

      <ul className="space-y-2">
        {groupRows.map(({ group, links, latest, worst }) => (
          <li key={group.id} className="rounded-xl border border-gray-200">
            <button type="button" className="flex w-full flex-wrap items-center justify-between gap-3 p-3 text-left hover:bg-gray-50"
              aria-expanded={open === group.id} onClick={() => setOpen(open === group.id ? null : group.id)}>
              <span className="font-medium text-gray-900">{group.members.map((m) => m.name).join(" · ")}</span>
              <span className="flex flex-wrap items-center gap-2">
                {group.members.map((member) => {
                  const last = latest(member.id);
                  return last ? (
                    <Chip key={member.id} tone={ON_TRACK_TONE[last.onTrack]}>{firstName(member.name)}: {ON_TRACK_LABELS[last.onTrack]}</Chip>
                  ) : null;
                })}
                <Chip tone={STATUS_CHIP[worst].tone}>{STATUS_CHIP[worst].label}</Chip>
              </span>
            </button>
            {open === group.id && (
              <div className="space-y-4 border-t border-gray-200 p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  {links.map(({ checker, other, standing }) => (
                    <div key={`${checker.id}-${other.id}`} className="rounded-lg bg-gray-50 p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-gray-700">{firstName(checker.name)} → {firstName(other.name)}</span>
                        <Chip tone={STATUS_CHIP[standing.status].tone}>{standing.done}/{view.required}</Chip>
                      </div>
                      <WeekStrip
                        days={daysChecked(view.checkins.filter((c) => c.groupId === group.id), checker.id, other.id)}
                        week={week} today={today} due={view.due} />
                      <p className="mt-2 text-xs text-gray-500">{standing.summary}</p>
                    </div>
                  ))}
                </div>
                <CheckinList
                  view={view}
                  target={target}
                  checkins={view.checkins.filter((c) => c.groupId === group.id && c.date >= week && c.date <= weekEnd)}
                  empty="No check-ins this week."
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
