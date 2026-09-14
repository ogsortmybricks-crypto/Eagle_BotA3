import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Bot,
  Copy,
  Check,
  Mail,
  Palette,
  Send,
  Settings,
  Trash2,
  Users,
} from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost, fileToDataUrl } from "@/lib/api";
import { useSession, applyPalette, type Palette as PaletteType } from "@/lib/session";
import {
  Avatar,
  Banner,
  Chip,
  LoadingPage,
  Modal,
  PageHeader,
  Spinner,
  Stat,
  type ChipTone,
} from "@/components/ui";

const TABS = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "people", label: "People", icon: Users },
  { id: "invites", label: "Invites", icon: Mail },
  { id: "status", label: "AI status", icon: Bot },
  { id: "activity", label: "Activity log", icon: Activity },
  { id: "settings", label: "Settings", icon: Settings },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function Admin() {
  const { can } = useSession();
  const [tab, setTab] = useState<TabId>("overview");

  const visible = TABS.filter((entry) => {
    if (entry.id === "people" || entry.id === "invites" || entry.id === "settings") {
      return can("users.manage");
    }
    if (entry.id === "activity") return can("activity.read");
    return can("status.read");
  });

  return (
    <>
      <PageHeader title="Admin" subtitle="Everything happening inside the academy." />

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-gray-200">
        {visible.map((entry) => (
          <button
            key={entry.id}
            onClick={() => setTab(entry.id)}
            className={`flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-medium transition ${
              tab === entry.id
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            <entry.icon className="h-4 w-4" /> {entry.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <Overview />}
      {tab === "people" && <PeopleAdmin />}
      {tab === "invites" && <Invites />}
      {tab === "status" && <AiStatus />}
      {tab === "activity" && <ActivityLog />}
      {tab === "settings" && <AcademySettings />}
    </>
  );
}

/* -------------------------------- overview -------------------------------- */

function Overview() {
  const counts = useQuery<{ counts: Record<string, number> }>({
    queryKey: ["admin-overview"],
    queryFn: () => apiGet("/admin/overview"),
  });

  const status = useQuery<{
    config: { aiConfigured: boolean; emailConfigured: boolean; model: string; appUrl: string };
  }>({
    queryKey: ["admin-status"],
    queryFn: () => apiGet("/admin/status"),
  });

  if (counts.isLoading) return <LoadingPage />;
  const c = counts.data?.counts ?? {};
  const config = status.data?.config;

  return (
    <div className="space-y-5">
      {config && !config.aiConfigured && (
        <Banner tone="warning" title="The AI is switched off">
          <code>ANTHROPIC_API_KEY</code> isn't set on the server, so building the wiki and
          processing Town Hall notes won't work. Everything else does.
        </Banner>
      )}
      {config && !config.emailConfigured && (
        <Banner tone="info" title="Email isn't set up">
          Invites still work — you'll just get a link to send yourself instead of an automatic
          email. Set <code>SMTP_USER</code> and <code>SMTP_PASS</code> (a Google App Password) to
          turn it on.
        </Banner>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="People" value={c.people ?? 0} />
        <Stat label="Rules in force" value={c.rules ?? 0} />
        <Stat
          label="Open questions"
          value={c.openFindings ?? 0}
          tone={(c.openFindings ?? 0) > 0 ? "warn" : "good"}
          hint={(c.openFindings ?? 0) > 0 ? "Things the AI flagged for a human" : "Nothing pending"}
        />
        <Stat label="Town Halls" value={c.meetings ?? 0} />
        <Stat label="Open votes" value={c.openElections ?? 0} />
        <Stat label="Invites outstanding" value={c.pendingInvites ?? 0} />
      </div>

      {config && (
        <div className="card-pad text-xs text-gray-500">
          <div className="font-medium text-gray-700">Server configuration</div>
          <dl className="mt-2 grid gap-1 sm:grid-cols-2">
            <div>
              Model: <span className="font-mono">{config.model}</span>
            </div>
            <div>
              Public URL: <span className="font-mono">{config.appUrl}</span>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}

/* --------------------------------- people --------------------------------- */

type AdminUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  studio: string | null;
  active: boolean;
  avatarUrl: string | null;
  lastLoginAt: string | null;
  positions: string[];
};

const ROLE_HELP: Record<string, string> = {
  admin: "Full control: settings, invites, the wiki, elections.",
  secretary: "Takes Town Hall notes and processes them into the wiki.",
  guide: "Reads everything, decides nothing.",
  learner: "Reads the wiki, runs for positions, votes.",
};

function PeopleAdmin() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const query = useQuery<{ users: AdminUser[] }>({
    queryKey: ["admin-users"],
    queryFn: () => apiGet("/admin/users"),
  });

  const update = useMutation({
    mutationFn: (input: { id: number; patch: Partial<AdminUser> }) =>
      apiPatch(`/admin/users/${input.id}`, input.patch),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (updateError: Error) => setError(updateError.message),
  });

  if (query.isLoading) return <LoadingPage />;

  return (
    <div className="space-y-4">
      {error && <Banner tone="error">{error}</Banner>}
      <div className="card scroll-x">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="p-3 font-medium">Person</th>
              <th className="p-3 font-medium">Role</th>
              <th className="p-3 font-medium">Positions</th>
              <th className="p-3 font-medium">Last seen</th>
              <th className="p-3 font-medium">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {query.data?.users.map((person) => (
              <tr key={person.id} className={person.active ? "" : "opacity-50"}>
                <td className="p-3">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={person.name} src={person.avatarUrl} size={30} />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-gray-900">{person.name}</div>
                      <div className="truncate text-xs text-gray-500">{person.email}</div>
                    </div>
                  </div>
                </td>
                <td className="p-3">
                  <select
                    className="input w-auto py-1 text-xs"
                    value={person.role}
                    title={ROLE_HELP[person.role]}
                    onChange={(event) =>
                      update.mutate({ id: person.id, patch: { role: event.target.value } })
                    }
                  >
                    {["admin", "secretary", "guide", "learner"].map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1">
                    {person.positions.map((title) => (
                      <Chip key={title} tone="purple">
                        {title}
                      </Chip>
                    ))}
                  </div>
                </td>
                <td className="whitespace-nowrap p-3 text-xs text-gray-500">
                  {person.lastLoginAt
                    ? new Date(person.lastLoginAt).toLocaleDateString()
                    : "never"}
                </td>
                <td className="p-3">
                  <input
                    type="checkbox"
                    checked={person.active}
                    onChange={(event) =>
                      update.mutate({ id: person.id, patch: { active: event.target.checked } })
                    }
                    className="h-4 w-4 rounded border-gray-300 text-brand-600"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">
        Deactivating someone keeps everything they did — their votes, their notes, the positions
        they held — but they can't sign in.
      </p>
    </div>
  );
}

/* --------------------------------- invites -------------------------------- */

type Invite = {
  id: number;
  email: string;
  role: string;
  acceptedAt: string | null;
  expired: boolean;
  emailError: string | null;
  link: string;
  createdAt: string;
};

function Invites() {
  const { academy } = useSession();
  const queryClient = useQueryClient();
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState("learner");
  const [results, setResults] = useState<
    { email: string; status: string; detail?: string; link?: string }[] | null
  >(null);
  const [copied, setCopied] = useState<string | null>(null);

  const query = useQuery<{ invites: Invite[]; emailConfigured: boolean }>({
    queryKey: ["invites"],
    queryFn: () => apiGet("/admin/invites"),
  });

  const send = useMutation({
    mutationFn: () =>
      apiPost<{ results: NonNullable<typeof results> }>("/admin/invites", {
        emails: emails
          .split(/[\s,;]+/)
          .map((entry) => entry.trim())
          .filter(Boolean),
        role,
      }),
    onSuccess: (data) => {
      setResults(data.results);
      setEmails("");
      void queryClient.invalidateQueries({ queryKey: ["invites"] });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: number) => apiDelete(`/admin/invites/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["invites"] }),
  });

  function copy(link: string) {
    void navigator.clipboard.writeText(link);
    setCopied(link);
    setTimeout(() => setCopied(null), 1800);
  }

  const parsed = emails
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  return (
    <div className="space-y-5">
      {query.data && !query.data.emailConfigured && (
        <Banner tone="info" title="Sending by email is off">
          Invites still get created — you'll get a link for each one to pass along however you
          like.
        </Banner>
      )}

      <div className="card-pad">
        <h2 className="text-sm font-semibold text-gray-900">Invite people</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Only addresses on <strong>@{academy?.emailDomain}</strong> can be invited.
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="label" htmlFor="emails">
              Email addresses
            </label>
            <textarea
              id="emails"
              className="input min-h-[90px] font-mono text-[13px]"
              value={emails}
              onChange={(event) => setEmails(event.target.value)}
              placeholder={`ada@${academy?.emailDomain ?? "youracton.com"}\nlin@${academy?.emailDomain ?? "youracton.com"}`}
            />
            <p className="hint">One per line, or separated by commas.</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label" htmlFor="invite-role">
                Join as
              </label>
              <select
                id="invite-role"
                className="input w-auto"
                value={role}
                onChange={(event) => setRole(event.target.value)}
              >
                {["learner", "secretary", "guide", "admin"].map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() => send.mutate()}
              disabled={parsed.length === 0 || send.isPending}
              className="btn-primary"
            >
              {send.isPending ? <Spinner /> : <Send className="h-4 w-4" />}
              Invite {parsed.length > 0 ? parsed.length : ""}
            </button>
          </div>
          <p className="text-xs text-gray-500">{ROLE_HELP[role]}</p>
        </div>
      </div>

      {results && (
        <div className="card">
          <h3 className="border-b border-gray-200 p-4 text-sm font-semibold text-gray-900">
            Results
          </h3>
          <ul className="divide-y divide-gray-100">
            {results.map((result, index) => (
              <li key={index} className="flex flex-wrap items-center gap-2 p-3.5 text-sm">
                <span className="font-mono text-xs text-gray-700">{result.email}</span>
                <Chip
                  tone={
                    (
                      {
                        sent: "green",
                        link_only: "amber",
                        skipped: "neutral",
                        rejected: "red",
                      } as Record<string, ChipTone>
                    )[result.status] ?? "neutral"
                  }
                >
                  {result.status === "link_only" ? "link only" : result.status}
                </Chip>
                {result.detail && (
                  <span className="min-w-0 flex-1 text-xs text-gray-500">{result.detail}</span>
                )}
                {result.link && (
                  <button onClick={() => copy(result.link!)} className="btn-ghost btn-sm">
                    {copied === result.link ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    {copied === result.link ? "Copied" : "Copy link"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h3 className="border-b border-gray-200 p-4 text-sm font-semibold text-gray-900">
          Outstanding invites
        </h3>
        {query.isLoading ? (
          <LoadingPage />
        ) : (query.data?.invites.filter((invite) => !invite.acceptedAt).length ?? 0) === 0 ? (
          <p className="p-6 text-center text-sm text-gray-400">Nothing outstanding.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {query.data!.invites
              .filter((invite) => !invite.acceptedAt)
              .map((invite) => (
                <li key={invite.id} className="flex flex-wrap items-center gap-2 p-3.5 text-sm">
                  <span className="font-mono text-xs text-gray-700">{invite.email}</span>
                  <Chip tone="brand">{invite.role}</Chip>
                  {invite.expired && <Chip tone="red">expired</Chip>}
                  {invite.emailError && <Chip tone="amber">email failed</Chip>}
                  <span className="flex-1" />
                  <button onClick={() => copy(invite.link)} className="btn-ghost btn-sm">
                    {copied === invite.link ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    Link
                  </button>
                  <button
                    onClick={() => revoke.mutate(invite.id)}
                    className="btn-ghost btn-sm text-gray-400 hover:text-red-600"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* -------------------------------- AI status -------------------------------- */

type StatusResponse = {
  jobs: {
    id: number;
    kind: string;
    status: string;
    message: string | null;
    progress: number;
    error: string | null;
    awaitingReason: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    createdAt: string;
    finishedAt: string | null;
  }[];
  activeMeetings: { id: number; title: string; status: string }[];
  openElections: { id: number; title: string; status: string }[];
  openFindings: number;
  aiBusy: boolean;
  awaiting: { id: number; awaitingReason: string | null }[];
};

const JOB_LABEL: Record<string, string> = {
  build_wiki: "Building the wiki",
  process_meeting: "Processing Town Hall notes",
  apply_election: "Recording an election result",
};

const JOB_TONE: Record<string, ChipTone> = {
  queued: "neutral",
  running: "blue",
  awaiting_input: "amber",
  succeeded: "green",
  failed: "red",
};

function AiStatus() {
  const queryClient = useQueryClient();
  const query = useQuery<StatusResponse>({
    queryKey: ["admin-status"],
    queryFn: () => apiGet("/admin/status"),
    refetchInterval: (q) => (q.state.data?.aiBusy ? 2000 : 15000),
  });

  const acknowledge = useMutation({
    mutationFn: (id: number) => apiPost(`/admin/jobs/${id}/acknowledge`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-status"] }),
  });

  if (query.isLoading) return <LoadingPage />;
  const data = query.data!;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="AI right now"
          value={data.aiBusy ? "Working" : "Idle"}
          tone={data.aiBusy ? "warn" : "good"}
        />
        <Stat
          label="Waiting on a human"
          value={data.awaiting.length}
          tone={data.awaiting.length > 0 ? "warn" : "good"}
        />
        <Stat
          label="Open questions in the wiki"
          value={data.openFindings}
          tone={data.openFindings > 0 ? "warn" : "good"}
        />
      </div>

      {(data.activeMeetings.length > 0 || data.openElections.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="card">
            <h3 className="border-b border-gray-200 p-4 text-sm font-semibold text-gray-900">
              Meetings in flight
            </h3>
            {data.activeMeetings.length === 0 ? (
              <p className="p-4 text-sm text-gray-400">None.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {data.activeMeetings.map((meeting) => (
                  <li key={meeting.id} className="flex items-center gap-2 p-3.5 text-sm">
                    <a href={`/town-hall/${meeting.id}`} className="flex-1 hover:underline">
                      {meeting.title}
                    </a>
                    <Chip tone="brand">{meeting.status.replace("_", " ")}</Chip>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="card">
            <h3 className="border-b border-gray-200 p-4 text-sm font-semibold text-gray-900">
              Votes not yet certified
            </h3>
            {data.openElections.length === 0 ? (
              <p className="p-4 text-sm text-gray-400">None.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {data.openElections.map((election) => (
                  <li key={election.id} className="flex items-center gap-2 p-3.5 text-sm">
                    <a href={`/elections/${election.id}`} className="flex-1 hover:underline">
                      {election.title}
                    </a>
                    <Chip tone="amber">{election.status}</Chip>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <h3 className="border-b border-gray-200 p-4 text-sm font-semibold text-gray-900">
          AI runs
        </h3>
        {data.jobs.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-400">The AI hasn't run yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {data.jobs.map((job) => (
              <li key={job.id} className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">
                    {JOB_LABEL[job.kind] ?? job.kind}
                  </span>
                  <Chip tone={JOB_TONE[job.status] ?? "neutral"}>
                    {job.status.replace("_", " ")}
                  </Chip>
                  <span className="text-xs text-gray-400">
                    {new Date(job.createdAt).toLocaleString()}
                  </span>
                </div>
                {job.message && <p className="mt-1 text-sm text-gray-600">{job.message}</p>}
                {job.awaitingReason && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <p className="flex-1 text-sm text-amber-700">{job.awaitingReason}</p>
                    <button
                      onClick={() => acknowledge.mutate(job.id)}
                      className="btn-secondary btn-sm"
                    >
                      Handled
                    </button>
                  </div>
                )}
                {job.error && <p className="mt-1 text-sm text-red-600">{job.error}</p>}
                {job.status === "running" && (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-brand-500 transition-all"
                      style={{ width: `${Math.max(5, job.progress)}%` }}
                    />
                  </div>
                )}
                {job.outputTokens !== null && (
                  <p className="mt-1.5 text-xs text-gray-400">
                    {(job.inputTokens ?? 0).toLocaleString()} tokens in ·{" "}
                    {job.outputTokens.toLocaleString()} out
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ------------------------------- activity log ------------------------------ */

type LogEntry = {
  entry: {
    id: number;
    action: string;
    summary: string;
    actorType: string;
    createdAt: string;
    entityType: string | null;
  };
  actorName: string | null;
};

function ActivityLog() {
  const [search, setSearch] = useState("");
  const [actorType, setActorType] = useState("all");

  const query = useQuery<{ entries: LogEntry[]; nextCursor: number | null }>({
    queryKey: ["activity", search, actorType],
    queryFn: () =>
      apiGet(
        `/admin/activity?limit=150&actorType=${actorType}${search ? `&q=${encodeURIComponent(search)}` : ""}`,
      ),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <input
          className="input max-w-xs"
          placeholder="Search the log"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          className="input w-auto"
          value={actorType}
          onChange={(event) => setActorType(event.target.value)}
        >
          <option value="all">Everyone</option>
          <option value="user">People</option>
          <option value="ai">The AI</option>
          <option value="system">System</option>
        </select>
      </div>

      {query.isLoading ? (
        <LoadingPage />
      ) : (query.data?.entries.length ?? 0) === 0 ? (
        <div className="card px-6 py-10 text-center text-sm text-gray-500">Nothing logged yet.</div>
      ) : (
        <div className="card divide-y divide-gray-100">
          {query.data!.entries.map(({ entry, actorName }) => (
            <div key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-3.5">
              <span className="w-36 shrink-0 text-xs tabular-nums text-gray-400">
                {new Date(entry.createdAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <Chip tone={entry.actorType === "ai" ? "purple" : "neutral"}>
                {entry.actorType === "ai" ? "AI" : (actorName ?? entry.actorType)}
              </Chip>
              <span className="min-w-0 flex-1 text-sm text-gray-700">{entry.summary}</span>
              <code className="text-xs text-gray-400">{entry.action}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------- settings --------------------------------- */

const PALETTES: { name: string; palette: PaletteType }[] = [
  { name: "Sky", palette: { primary: "#0284c7", accent: "#f97316", surface: "#f8fafc" } },
  { name: "Forest", palette: { primary: "#15803d", accent: "#ca8a04", surface: "#f7faf7" } },
  { name: "Ember", palette: { primary: "#b91c1c", accent: "#0891b2", surface: "#fbf8f7" } },
  { name: "Ink", palette: { primary: "#1e293b", accent: "#d97706", surface: "#f8fafc" } },
  { name: "Violet", palette: { primary: "#6d28d9", accent: "#059669", surface: "#faf9fd" } },
  { name: "Clay", palette: { primary: "#9a3412", accent: "#0f766e", surface: "#fcf9f6" } },
];

function AcademySettings() {
  const { academy, refresh } = useSession();
  const [name, setName] = useState(academy?.name ?? "");
  const [learnerNoun, setLearnerNoun] = useState(academy?.learnerNoun ?? "Hero");
  const [guidesCanVote, setGuidesCanVote] = useState(academy?.guidesCanVote ?? false);
  const [logoUrl, setLogoUrl] = useState(academy?.logoUrl ?? null);
  const [palette, setPalette] = useState<PaletteType>(
    academy?.palette ?? PALETTES[0].palette,
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      apiPatch("/admin/academy", { name, learnerNoun, guidesCanVote, logoUrl, palette }),
    onSuccess: async () => {
      applyPalette(palette);
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (saveError: Error) => setError(saveError.message),
  });

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    try {
      setLogoUrl(await fileToDataUrl(file, 500_000));
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : "Couldn't read that image.");
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      {error && <Banner tone="error">{error}</Banner>}
      {saved && <Banner tone="success">Saved.</Banner>}

      <div className="card-pad space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Academy</h2>
        <div>
          <label className="label" htmlFor="academy-name">
            Name
          </label>
          <input
            id="academy-name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="noun">
            What you call your learners
          </label>
          <input
            id="noun"
            className="input"
            value={learnerNoun}
            onChange={(event) => setLearnerNoun(event.target.value)}
          />
        </div>
        <div>
          <span className="label">Email domain</span>
          <div className="input bg-gray-50 text-gray-500">@{academy?.emailDomain}</div>
          <p className="hint">
            Fixed at setup. Changing it would orphan everyone's account, so it's not editable here.
          </p>
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3.5">
          <input
            type="checkbox"
            checked={guidesCanVote}
            onChange={(event) => setGuidesCanVote(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600"
          />
          <span className="text-sm">
            <span className="font-medium text-gray-900">Guides can vote in elections</span>
            <span className="mt-0.5 block text-gray-500">
              Off by default — most Actons keep the ballot box with the learners.
            </span>
          </span>
        </label>
      </div>

      <div className="card-pad space-y-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Palette className="h-4 w-4" /> Look
        </h2>
        <div className="grid grid-cols-3 gap-2.5">
          {PALETTES.map((option) => (
            <button
              key={option.name}
              type="button"
              onClick={() => {
                setPalette(option.palette);
                applyPalette(option.palette);
              }}
              className={`rounded-lg border-2 p-3 text-left transition ${
                palette.primary === option.palette.primary
                  ? "border-gray-900"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="mb-2 flex gap-1">
                <span
                  className="h-5 w-5 rounded-full"
                  style={{ background: option.palette.primary }}
                />
                <span
                  className="h-5 w-5 rounded-full"
                  style={{ background: option.palette.accent }}
                />
              </div>
              <span className="text-xs font-medium text-gray-700">{option.name}</span>
            </button>
          ))}
        </div>

        <div>
          <span className="label">Logo</span>
          <div className="flex items-center gap-4">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt=""
                className="h-16 w-16 rounded-xl border border-gray-200 object-contain p-1"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-gray-300 text-xs text-gray-400">
                None
              </div>
            )}
            <div>
              <label className="btn-secondary btn-sm cursor-pointer">
                Choose image
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => pickLogo(event.target.files?.[0])}
                />
              </label>
              {logoUrl && (
                <button onClick={() => setLogoUrl(null)} className="btn-ghost btn-sm ml-1">
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary">
          {save.isPending && <Spinner />} Save settings
        </button>
        <button onClick={() => setPasswordOpen(true)} className="btn-secondary">
          Change my password
        </button>
      </div>

      {passwordOpen && <PasswordModal onClose={() => setPasswordOpen(false)} />}
    </div>
  );
}

function PasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const change = useMutation({
    mutationFn: () => apiPost("/auth/password", { current, next }),
    onSuccess: () => setDone(true),
    onError: (changeError: Error) => setError(changeError.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Change your password"
      footer={
        done ? (
          <button onClick={onClose} className="btn-primary">
            Done
          </button>
        ) : (
          <>
            <button onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button
              onClick={() => change.mutate()}
              disabled={change.isPending || next.length < 8}
              className="btn-primary"
            >
              {change.isPending && <Spinner />} Change it
            </button>
          </>
        )
      }
    >
      {done ? (
        <Banner tone="success">Password changed.</Banner>
      ) : (
        <div className="space-y-4">
          {error && <Banner tone="error">{error}</Banner>}
          <div>
            <label className="label" htmlFor="current-pw">
              Current password
            </label>
            <input
              id="current-pw"
              type="password"
              className="input"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="label" htmlFor="new-pw">
              New password
            </label>
            <input
              id="new-pw"
              type="password"
              className="input"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              placeholder="At least 8 characters"
            />
          </div>
        </div>
      )}
    </Modal>
  );
}
