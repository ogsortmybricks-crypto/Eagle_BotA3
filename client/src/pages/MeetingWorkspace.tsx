import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Gavel,
  Megaphone,
  MessageSquare,
  Play,
  Scale,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  Users,
} from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { useSession } from "@/lib/session";
import {
  Banner,
  Chip,
  LoadingPage,
  Markdown,
  Modal,
  Spinner,
  type ChipTone,
} from "@/components/ui";
import { JobProgress, useJob, type Job } from "@/components/JobStatus";

type Item = {
  id: number;
  type: string;
  title: string;
  body: string;
  orderIndex: number;
  outcome: string | null;
  votesFor: number | null;
  votesAgainst: number | null;
  votesAbstain: number | null;
  raisedBy: number | null;
  assignedTo: number | null;
  dueDate: string | null;
  completed: boolean;
};

type Meeting = {
  id: number;
  title: string;
  meetingDate: string;
  status: string;
  notes: string;
  attendance: number[];
  quorumNote: string | null;
  startedAt: string | null;
  processedAt: string | null;
  lastJobId: number | null;
  secretaryId: number | null;
};

type Person = { id: number; name: string; role: string; studio: string | null };

type MeetingResponse = { meeting: Meeting; items: Item[]; job: Job | null; roster: Person[] };

const ITEM_TYPES = [
  { value: "agenda", label: "Agenda", icon: Clock, tone: "neutral" as ChipTone },
  { value: "discussion", label: "Discussion", icon: MessageSquare, tone: "blue" as ChipTone },
  { value: "motion", label: "Motion", icon: Gavel, tone: "purple" as ChipTone },
  { value: "decision", label: "Decision", icon: Check, tone: "green" as ChipTone },
  { value: "action_item", label: "Action item", icon: Square, tone: "amber" as ChipTone },
  { value: "appeal", label: "Appeal", icon: Scale, tone: "red" as ChipTone },
  { value: "announcement", label: "Announcement", icon: Megaphone, tone: "neutral" as ChipTone },
];

const TYPE_BY_VALUE = Object.fromEntries(ITEM_TYPES.map((type) => [type.value, type]));

/** Typing "motion: " at the start of the quick-add box picks the type for you. */
const TYPE_PREFIXES: Record<string, string> = {
  "agenda:": "agenda",
  "discussion:": "discussion",
  "motion:": "motion",
  "decision:": "decision",
  "action:": "action_item",
  "todo:": "action_item",
  "appeal:": "appeal",
  "announce:": "announcement",
};

export function MeetingWorkspace({ id }: { id: number }) {
  const { can, user } = useSession();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [processOpen, setProcessOpen] = useState(false);

  const meetingQuery = useQuery<MeetingResponse>({
    queryKey: ["meeting", id],
    queryFn: () => apiGet(`/town-hall/${id}`),
  });

  const meeting = meetingQuery.data?.meeting;
  const items = meetingQuery.data?.items ?? [];
  const roster = meetingQuery.data?.roster ?? [];

  const [jobId, setJobId] = useState<number | null>(null);
  const activeJobId = jobId ?? meeting?.lastJobId ?? null;
  const jobQuery = useJob(activeJobId);
  const job = jobQuery.data?.job ?? meetingQuery.data?.job ?? null;

  // Refresh the meeting once the AI run lands so its status catches up.
  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    if (!job) return;
    if (job.status === lastStatus.current) return;
    lastStatus.current = job.status;
    if (["succeeded", "awaiting_input", "failed"].includes(job.status)) {
      void queryClient.invalidateQueries({ queryKey: ["meeting", id] });
      void queryClient.invalidateQueries({ queryKey: ["wiki"] });
      void queryClient.invalidateQueries({ queryKey: ["findings"] });
    }
  }, [job, id, queryClient]);

  const patchMeeting = useMutation({
    mutationFn: (patch: Partial<Meeting>) => apiPatch(`/town-hall/${id}`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["meeting", id] }),
    onError: (patchError: Error) => setError(patchError.message),
  });

  const process = useMutation({
    mutationFn: () => apiPost<{ jobId: number }>(`/town-hall/${id}/process`),
    onSuccess: (data) => {
      setJobId(data.jobId);
      setProcessOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["meeting", id] });
    },
    onError: (processError: Error) => {
      setError(processError.message);
      setProcessOpen(false);
    },
  });

  if (meetingQuery.isLoading) return <LoadingPage />;
  if (!meeting) return <Banner tone="error">That meeting doesn't exist.</Banner>;

  const editable = can("meetings.write") && meeting.status !== "processing";
  const decisions = items.filter(
    (item) => item.type === "decision" || (item.type === "motion" && item.outcome),
  );

  return (
    <>
      <Link href="/town-hall" className="btn-ghost btn-sm -ml-2 mb-3">
        <ArrowLeft className="h-3.5 w-3.5" /> All meetings
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {editable ? (
            <input
              className="-ml-2 w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-2xl font-bold tracking-tight text-gray-900 hover:border-gray-200 focus:border-brand-500 focus:bg-white focus:outline-none"
              defaultValue={meeting.title}
              onBlur={(event) => {
                if (event.target.value.trim() !== meeting.title) {
                  patchMeeting.mutate({ title: event.target.value.trim() });
                }
              }}
            />
          ) : (
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">{meeting.title}</h1>
          )}
          <p className="mt-1 px-0.5 text-sm text-gray-500">
            {new Date(meeting.meetingDate).toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
            {meeting.startedAt && <MeetingClock startedAt={meeting.startedAt} />}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {editable && meeting.status === "draft" && (
            <button
              onClick={() => patchMeeting.mutate({ status: "in_progress" })}
              className="btn-secondary"
            >
              <Play className="h-4 w-4" /> Start the clock
            </button>
          )}
          {can("meetings.process") && meeting.status !== "processing" && (
            <button onClick={() => setProcessOpen(true)} className="btn-primary">
              <Sparkles className="h-4 w-4" />
              {meeting.processedAt ? "Process again" : "Process with AI"}
            </button>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {error && <Banner tone="error">{error}</Banner>}
        {job && <JobProgress job={job} />}
        {job && ["succeeded", "awaiting_input"].includes(job.status) && (
          <AiReviewPanel job={job} meetingId={id} />
        )}

        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="min-w-0 flex-1 space-y-4">
            <ItemsPanel
              meetingId={id}
              items={items}
              roster={roster}
              editable={editable}
              currentUserId={user?.id ?? null}
            />
            <NotesPanel
              meetingId={id}
              initialNotes={meeting.notes}
              editable={editable}
            />
          </div>

          <aside className="space-y-4 lg:w-72 lg:shrink-0">
            <AttendancePanel
              meeting={meeting}
              roster={roster}
              editable={editable}
              onChange={(attendance, quorumNote) =>
                patchMeeting.mutate({ attendance, quorumNote })
              }
            />

            {decisions.length > 0 && (
              <div className="card">
                <h3 className="border-b border-gray-200 p-4 text-sm font-semibold text-gray-900">
                  Decisions so far
                </h3>
                <ul className="divide-y divide-gray-100">
                  {decisions.map((item) => (
                    <li key={item.id} className="p-3.5 text-sm">
                      <div className="font-medium text-gray-900">{item.title}</div>
                      {item.outcome && (
                        <Chip
                          tone={
                            item.outcome === "passed"
                              ? "green"
                              : item.outcome === "failed"
                                ? "red"
                                : "amber"
                          }
                          className="mt-1"
                        >
                          {item.outcome}
                          {item.votesFor !== null &&
                            ` · ${item.votesFor}-${item.votesAgainst ?? 0}`}
                        </Chip>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="card-pad text-xs text-gray-500">
              <p className="font-medium text-gray-700">How processing works</p>
              <p className="mt-1.5">
                The AI reads these notes against the whole wiki. It adds what you decided, and
                repeals anything anywhere that now contradicts it.
              </p>
              <p className="mt-1.5">
                It won't create elections on its own — it proposes them and waits for you.
              </p>
            </div>
          </aside>
        </div>
      </div>

      <Modal
        open={processOpen}
        onClose={() => setProcessOpen(false)}
        title="Send these notes to the AI?"
        footer={
          <>
            <button onClick={() => setProcessOpen(false)} className="btn-secondary">
              Not yet
            </button>
            <button
              onClick={() => process.mutate()}
              disabled={process.isPending}
              className="btn-primary"
            >
              {process.isPending && <Spinner />} Process with AI
            </button>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          Claude will read {items.length} item{items.length === 1 ? "" : "s"} and update the wiki:
          adding what passed, amending what changed, and repealing anything the meeting
          contradicted.
        </p>
        <ul className="mt-3 space-y-1.5 text-sm text-gray-600">
          <li className="flex gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            Every change is logged with a reason and can be undone in one click.
          </li>
          <li className="flex gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            Anything ambiguous comes back as a question instead of a guess.
          </li>
        </ul>
        {meeting.processedAt && (
          <div className="mt-4">
            <Banner tone="warning">
              These notes were already processed once. Running it again may duplicate rules — undo
              the previous run first if that's what you want.
            </Banner>
          </div>
        )}
      </Modal>
    </>
  );
}

/* --------------------------------- clock ---------------------------------- */

function MeetingClock({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return (
    <span className="ml-2 inline-flex items-center gap-1 font-medium tabular-nums text-brand-600">
      <Clock className="h-3.5 w-3.5" />
      {minutes}:{String(seconds).padStart(2, "0")}
    </span>
  );
}

/* --------------------------------- items ---------------------------------- */

function ItemsPanel({
  meetingId,
  items,
  roster,
  editable,
  currentUserId,
}: {
  meetingId: number;
  items: Item[];
  roster: Person[];
  editable: boolean;
  currentUserId: number | null;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [draftType, setDraftType] = useState("discussion");
  const inputRef = useRef<HTMLInputElement>(null);

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["meeting", meetingId] }),
    [queryClient, meetingId],
  );

  const add = useMutation({
    mutationFn: (input: { type: string; title: string }) =>
      apiPost(`/town-hall/${meetingId}/items`, { ...input, raisedBy: currentUserId }),
    onSuccess: () => {
      setDraft("");
      void invalidate();
      inputRef.current?.focus();
    },
  });

  const update = useMutation({
    mutationFn: (input: { id: number; patch: Partial<Item> }) =>
      apiPatch(`/town-hall/${meetingId}/items/${input.id}`, input.patch),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (itemId: number) => apiDelete(`/town-hall/${meetingId}/items/${itemId}`),
    onSuccess: invalidate,
  });

  const reorder = useMutation({
    mutationFn: (order: number[]) => apiPost(`/town-hall/${meetingId}/reorder`, { order }),
    onSuccess: invalidate,
  });

  function submitDraft() {
    const raw = draft.trim();
    if (!raw) return;
    let type = draftType;
    let title = raw;
    const lower = raw.toLowerCase();
    for (const [prefix, mapped] of Object.entries(TYPE_PREFIXES)) {
      if (lower.startsWith(prefix)) {
        type = mapped;
        title = raw.slice(prefix.length).trim();
        break;
      }
    }
    if (!title) return;
    add.mutate({ type, title });
  }

  function move(index: number, direction: -1 | 1) {
    const next = [...items];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    reorder.mutate(next.map((item) => item.id));
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between border-b border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-gray-900">Proceedings</h2>
        <span className="text-xs text-gray-500">{items.length} items</span>
      </div>

      {items.length === 0 ? (
        <p className="p-8 text-center text-sm text-gray-400">
          Nothing recorded yet. Start typing below.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {items.map((item, index) => (
            <ItemRow
              key={item.id}
              item={item}
              index={index}
              total={items.length}
              roster={roster}
              editable={editable}
              onUpdate={(patch) => update.mutate({ id: item.id, patch })}
              onDelete={() => remove.mutate(item.id)}
              onMove={(direction) => move(index, direction)}
            />
          ))}
        </ul>
      )}

      {editable && (
        <div className="border-t border-gray-200 bg-gray-50 p-3">
          <div className="flex gap-2">
            <select
              value={draftType}
              onChange={(event) => setDraftType(event.target.value)}
              className="input w-auto shrink-0 py-1.5 text-xs"
              aria-label="Item type"
            >
              {ITEM_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
            <input
              ref={inputRef}
              className="input"
              placeholder="What just happened? (try 'motion: raise appeal cost to 2 bucks')"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitDraft();
                }
              }}
            />
            <button
              onClick={submitDraft}
              disabled={!draft.trim() || add.isPending}
              className="btn-primary shrink-0"
            >
              {add.isPending ? <Spinner /> : "Add"}
            </button>
          </div>
          <p className="hint px-0.5">
            Enter adds the line. Prefixes work too: <code>motion:</code>, <code>decision:</code>,{" "}
            <code>action:</code>, <code>appeal:</code>.
          </p>
        </div>
      )}
    </div>
  );
}

function ItemRow({
  item,
  index,
  total,
  roster,
  editable,
  onUpdate,
  onDelete,
  onMove,
}: {
  item: Item;
  index: number;
  total: number;
  roster: Person[];
  editable: boolean;
  onUpdate: (patch: Partial<Item>) => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const config = TYPE_BY_VALUE[item.type] ?? TYPE_BY_VALUE.discussion;
  const Icon = config.icon;
  const isMotion = item.type === "motion" || item.type === "decision" || item.type === "appeal";

  return (
    <li className="group p-3.5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0 rounded-md bg-gray-100 p-1.5">
          <Icon className="h-3.5 w-3.5 text-gray-500" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={config.tone}>{config.label}</Chip>
            {item.outcome && (
              <Chip
                tone={
                  item.outcome === "passed" ? "green" : item.outcome === "failed" ? "red" : "amber"
                }
              >
                {item.outcome}
                {item.votesFor !== null &&
                  ` ${item.votesFor}-${item.votesAgainst ?? 0}${
                    item.votesAbstain ? `-${item.votesAbstain}` : ""
                  }`}
              </Chip>
            )}
            {item.type === "action_item" && item.dueDate && (
              <Chip tone={new Date(item.dueDate) < new Date() ? "red" : "neutral"}>
                due {new Date(item.dueDate).toLocaleDateString()}
              </Chip>
            )}
          </div>

          {editable ? (
            <input
              className="-ml-1.5 mt-1 w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-medium text-gray-900 hover:border-gray-200 focus:border-brand-500 focus:bg-white focus:outline-none"
              defaultValue={item.title}
              onBlur={(event) => {
                if (event.target.value.trim() && event.target.value !== item.title) {
                  onUpdate({ title: event.target.value.trim() });
                }
              }}
            />
          ) : (
            <div className="mt-1 text-sm font-medium text-gray-900">{item.title}</div>
          )}

          {item.body && !expanded && (
            <p className="mt-1 line-clamp-2 text-sm text-gray-500">{item.body}</p>
          )}

          {expanded && (
            <div className="mt-3 space-y-3 rounded-lg bg-gray-50 p-3">
              <div>
                <label className="label text-xs">Detail</label>
                <textarea
                  className="input min-h-[70px] text-sm"
                  defaultValue={item.body}
                  disabled={!editable}
                  placeholder="What was said, who said it, the reasoning..."
                  onBlur={(event) => {
                    if (event.target.value !== item.body) onUpdate({ body: event.target.value });
                  }}
                />
              </div>

              {isMotion && editable && (
                <div>
                  <label className="label text-xs">Outcome</label>
                  <div className="flex flex-wrap gap-1.5">
                    {["passed", "failed", "tabled", "withdrawn"].map((outcome) => (
                      <button
                        key={outcome}
                        onClick={() =>
                          onUpdate({ outcome: item.outcome === outcome ? null : outcome })
                        }
                        className={`btn btn-sm ${
                          item.outcome === outcome
                            ? "bg-brand-600 text-white"
                            : "border border-gray-300 bg-white text-gray-600"
                        }`}
                      >
                        {outcome}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {(
                      [
                        ["votesFor", "For"],
                        ["votesAgainst", "Against"],
                        ["votesAbstain", "Abstain"],
                      ] as const
                    ).map(([field, label]) => (
                      <div key={field}>
                        <label className="label text-xs">{label}</label>
                        <input
                          type="number"
                          min={0}
                          className="input py-1 text-sm"
                          defaultValue={item[field] ?? ""}
                          onBlur={(event) =>
                            onUpdate({
                              [field]: event.target.value === "" ? null : Number(event.target.value),
                            } as Partial<Item>)
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {item.type === "action_item" && editable && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label text-xs">Who's doing it</label>
                    <select
                      className="input py-1 text-sm"
                      defaultValue={item.assignedTo ?? ""}
                      onChange={(event) =>
                        onUpdate({
                          assignedTo: event.target.value ? Number(event.target.value) : null,
                        })
                      }
                    >
                      <option value="">Nobody yet</option>
                      {roster.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label text-xs">By when</label>
                    <input
                      type="date"
                      className="input py-1 text-sm"
                      defaultValue={item.dueDate ? item.dueDate.slice(0, 10) : ""}
                      onChange={(event) => onUpdate({ dueDate: event.target.value || null })}
                    />
                  </div>
                </div>
              )}

              {item.type === "action_item" && (
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={item.completed}
                    disabled={!editable}
                    onChange={(event) => onUpdate({ completed: event.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-brand-600"
                  />
                  Done
                </label>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
          {editable && (
            <>
              <button
                onClick={() => onMove(-1)}
                disabled={index === 0}
                className="btn-ghost p-1 disabled:opacity-20"
                title="Move up"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => onMove(1)}
                disabled={index === total - 1}
                className="btn-ghost p-1 disabled:opacity-20"
                title="Move down"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={onDelete}
                className="btn-ghost p-1 text-gray-400 hover:text-red-600"
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          <button
            onClick={() => setExpanded((value) => !value)}
            className="btn-ghost btn-sm px-2 !opacity-100"
          >
            {expanded ? "Less" : "More"}
          </button>
        </div>
      </div>
    </li>
  );
}

/* -------------------------------- notes ----------------------------------- */

function NotesPanel({
  meetingId,
  initialNotes,
  editable,
}: {
  meetingId: number;
  initialNotes: string;
  editable: boolean;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [saved, setSaved] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Autosave a second after typing stops - a secretary should never have to
  // remember to hit save mid-meeting.
  useEffect(() => {
    if (notes === initialNotes) return;
    setSaved(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void apiPatch(`/town-hall/${meetingId}`, { notes }).then(() => setSaved(true));
    }, 1000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [notes, initialNotes, meetingId]);

  return (
    <div className="card">
      <div className="flex items-center justify-between border-b border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-gray-900">Running notes</h2>
        <span className="text-xs text-gray-400">
          {saved ? "Saved" : "Saving..."}
        </span>
      </div>
      <textarea
        className="min-h-[180px] w-full resize-y border-0 p-4 font-mono text-[13px] leading-relaxed text-gray-700 placeholder:text-gray-400 focus:outline-none"
        placeholder="Anything that doesn't fit an item above — context, side conversations, who was upset about what. The AI reads this too."
        value={notes}
        disabled={!editable}
        onChange={(event) => setNotes(event.target.value)}
      />
    </div>
  );
}

/* ------------------------------- attendance -------------------------------- */

function AttendancePanel({
  meeting,
  roster,
  editable,
  onChange,
}: {
  meeting: Meeting;
  roster: Person[];
  editable: boolean;
  onChange: (attendance: number[], quorumNote: string | null) => void;
}) {
  const present = new Set(meeting.attendance ?? []);
  const eligible = roster.filter((person) => person.role !== "guide");
  const quorum = Math.ceil(eligible.length * (2 / 3));
  const presentEligible = eligible.filter((person) => present.has(person.id)).length;
  const hasQuorum = presentEligible >= quorum;

  function toggle(personId: number) {
    const next = new Set(present);
    if (next.has(personId)) next.delete(personId);
    else next.add(personId);
    onChange([...next], meeting.quorumNote);
  }

  return (
    <div className="card">
      <div className="flex items-center gap-2 border-b border-gray-200 p-4">
        <Users className="h-4 w-4 text-gray-400" />
        <h3 className="text-sm font-semibold text-gray-900">Who's here</h3>
        <span className="ml-auto text-xs tabular-nums text-gray-500">
          {present.size}/{roster.length}
        </span>
      </div>

      <div className={`px-4 py-2.5 text-xs ${hasQuorum ? "bg-emerald-50" : "bg-amber-50"}`}>
        <span className={hasQuorum ? "text-emerald-800" : "text-amber-800"}>
          {presentEligible} of {eligible.length} voting members present.{" "}
          <strong>
            {hasQuorum ? "Quorum met" : `Need ${quorum - presentEligible} more for two-thirds`}
          </strong>
          .
        </span>
      </div>

      <ul className="max-h-72 overflow-y-auto p-2">
        {roster.map((person) => (
          <li key={person.id}>
            <label
              className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50 ${
                editable ? "" : "cursor-default"
              }`}
            >
              <input
                type="checkbox"
                checked={present.has(person.id)}
                disabled={!editable}
                onChange={() => toggle(person.id)}
                className="h-4 w-4 rounded border-gray-300 text-brand-600"
              />
              <span className="min-w-0 flex-1 truncate text-gray-700">{person.name}</span>
              {person.role === "guide" && <Chip>guide</Chip>}
            </label>
          </li>
        ))}
      </ul>

      <div className="border-t border-gray-200 p-3">
        <input
          className="input py-1.5 text-xs"
          placeholder="Note about quorum (optional)"
          defaultValue={meeting.quorumNote ?? ""}
          disabled={!editable}
          onBlur={(event) => onChange(meeting.attendance ?? [], event.target.value || null)}
        />
      </div>
    </div>
  );
}

/* ------------------------------ AI review ---------------------------------- */

type ProposedElection = {
  title: string;
  description: string;
  type: "position" | "rule";
  positionTitle: string;
  proposalBody: string;
  seats: number;
  rationale: string;
};

function AiReviewPanel({ job, meetingId }: { job: Job; meetingId: number }) {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const result = (job.result ?? {}) as {
    summary?: string;
    created?: number;
    amended?: number;
    repealed?: number;
    skipped?: string[];
    proposedElections?: ProposedElection[];
    unresolvedQuestions?: string[];
  };

  const [dismissed, setDismissed] = useState<number[]>([]);
  const [created, setCreated] = useState<number[]>([]);
  const [confirmRevert, setConfirmRevert] = useState(false);

  const createElection = useMutation({
    mutationFn: (input: { proposal: ProposedElection; index: number }) =>
      apiPost("/elections", {
        title: input.proposal.title,
        description: `${input.proposal.description}\n\n_Proposed by the AI from the Town Hall notes: ${input.proposal.rationale}_`,
        type: input.proposal.type,
        proposalBody: input.proposal.type === "rule" ? input.proposal.proposalBody : null,
        seats: input.proposal.seats,
        sourceMeetingId: meetingId,
      }),
    onSuccess: (_data, variables) => {
      setCreated((current) => [...current, variables.index]);
      void queryClient.invalidateQueries({ queryKey: ["elections"] });
    },
  });

  const revert = useMutation({
    mutationFn: () =>
      apiPost(`/wiki/jobs/${job.id}/revert`, { reason: "Undone from the Town Hall review." }),
    onSuccess: () => {
      setConfirmRevert(false);
      void queryClient.invalidateQueries({ queryKey: ["wiki"] });
      void queryClient.invalidateQueries({ queryKey: ["meeting", meetingId] });
    },
  });

  const proposals = result.proposedElections ?? [];
  const questions = result.unresolvedQuestions ?? [];

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Sparkles className="h-4 w-4 text-brand-600" /> What the AI did
        </h2>
        {can("wiki.edit") && (
          <button onClick={() => setConfirmRevert(true)} className="btn-ghost btn-sm">
            <Undo2 className="h-3.5 w-3.5" /> Undo this run
          </button>
        )}
      </div>

      <div className="space-y-4 p-4">
        <div className="flex flex-wrap gap-2 text-xs">
          <Chip tone="green">{result.created ?? 0} added</Chip>
          <Chip tone="amber">{result.amended ?? 0} amended</Chip>
          <Chip tone="red">{result.repealed ?? 0} repealed</Chip>
        </div>

        {result.summary && (
          <div className="rounded-lg bg-gray-50 p-3.5">
            <Markdown>{result.summary}</Markdown>
          </div>
        )}

        {(result.skipped?.length ?? 0) > 0 && (
          <Banner tone="warning" title="Some changes couldn't be applied">
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {result.skipped!.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </Banner>
        )}

        {questions.length > 0 && (
          <Banner tone="info" title="The AI wasn't sure about these">
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {questions.map((question, index) => (
                <li key={index}>{question}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs">
              Nothing was written for these. Add detail to the notes and process again, or handle
              them at the next Town Hall.
            </p>
          </Banner>
        )}

        {proposals.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              {proposals.length} thing{proposals.length === 1 ? "" : "s"} that might need a vote
            </h3>
            <p className="mt-0.5 text-xs text-gray-500">
              The AI won't start an election on its own. Your call.
            </p>
            <ul className="mt-3 space-y-2.5">
              {proposals.map((proposal, index) => {
                const isCreated = created.includes(index);
                const isDismissed = dismissed.includes(index);
                return (
                  <li
                    key={index}
                    className={`rounded-lg border p-3.5 ${
                      isDismissed ? "border-gray-200 bg-gray-50 opacity-60" : "border-gray-200"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tone={proposal.type === "position" ? "purple" : "blue"}>
                        {proposal.type === "position" ? "Position" : "Rule change"}
                      </Chip>
                      <span className="text-sm font-medium text-gray-900">{proposal.title}</span>
                    </div>
                    <p className="mt-1.5 text-sm text-gray-600">{proposal.description}</p>
                    <p className="mt-1 text-xs italic text-gray-500">{proposal.rationale}</p>

                    {isCreated ? (
                      <div className="mt-2.5 flex items-center gap-1.5 text-sm text-emerald-700">
                        <Check className="h-4 w-4" /> Created as a draft election.{" "}
                        <Link href="/elections" className="font-medium underline">
                          Open it
                        </Link>
                      </div>
                    ) : isDismissed ? (
                      <div className="mt-2.5 text-sm text-gray-500">Skipped.</div>
                    ) : (
                      can("elections.manage") && (
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={() => createElection.mutate({ proposal, index })}
                            disabled={createElection.isPending}
                            className="btn-primary btn-sm"
                          >
                            {createElection.isPending && <Spinner className="h-3 w-3" />} Create the
                            election
                          </button>
                          <button
                            onClick={() => setDismissed((current) => [...current, index])}
                            className="btn-secondary btn-sm"
                          >
                            Skip it
                          </button>
                        </div>
                      )
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <Modal
        open={confirmRevert}
        onClose={() => setConfirmRevert(false)}
        title="Undo everything this run changed?"
        footer={
          <>
            <button onClick={() => setConfirmRevert(false)} className="btn-secondary">
              Keep it
            </button>
            <button
              onClick={() => revert.mutate()}
              disabled={revert.isPending}
              className="btn-danger"
            >
              {revert.isPending && <Spinner />} Undo the run
            </button>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          Rules this run added get repealed, rules it amended go back to their previous text, and
          rules it repealed come back. The history keeps a record of both the change and the undo —
          nothing is erased.
        </p>
      </Modal>
    </div>
  );
}
