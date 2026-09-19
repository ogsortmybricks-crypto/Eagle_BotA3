import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Bot,
  Copy,
  Check,
  Mail,
  Send,
  Settings,
  Trash2,
  Users,
} from "lucide-react";
import { Link } from "wouter";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { useDateFormat, useSession } from "@/lib/session";
import {
  Avatar,
  Banner,
  Chip,
  LoadingPage,
  PageHeader,
  Spinner,
  Stat,
  type ChipTone,
} from "@/components/ui";
import { TaconPanels } from "@/pages/TaconPage";

const TABS = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "people", label: "People & studios", icon: Users },
  { id: "invites", label: "Invites", icon: Mail },
  { id: "status", label: "AI status", icon: Bot },
  { id: "activity", label: "Activity log", icon: Activity },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function Admin() {
  const { can } = useSession();
  const [tab, setTab] = useState<TabId>("overview");

  const { studio } = useSession();

  const visible = TABS.filter((entry) => {
    if (entry.id === "people" || entry.id === "invites") return can("users.manage");
    if (entry.id === "activity") return can("activity.read");
    return can("status.read");
  });

  return (
    <>
      <PageHeader
        title="Admin"
        subtitle={
          studio
            ? `What's happening in ${studio.name}. Switch studio in the sidebar, or pick All studios for the whole academy.`
            : "Everything happening across the academy."
        }
      >
        <Link href="/settings" className="btn-secondary">
          <Settings className="h-4 w-4" /> Settings
        </Link>
      </PageHeader>

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
      <TaconPanels host="admin" />
    </>
  );
}

/* -------------------------------- overview -------------------------------- */

type StudioSummary = {
  id: number;
  name: string;
  color: string;
  members: number;
  rules: number;
  openFindings: number;
  openElections: number;
  lastMeeting: string | null;
};

function Overview() {
  const { studio, studioId, selectStudio } = useSession();
  const formatDate = useDateFormat();

  const counts = useQuery<{
    counts: Record<string, number>;
    studios: StudioSummary[];
    scopedTo: string | null;
  }>({
    queryKey: ["admin-overview", studioId],
    queryFn: () => apiGet("/admin/overview"),
  });

  const status = useQuery<{
    config: {
      aiConfigured: boolean;
      emailConfigured: boolean;
      aiEnabled: boolean;
      model: string;
      effort: string;
      appUrl: string;
    };
  }>({
    queryKey: ["admin-status", studioId],
    queryFn: () => apiGet("/admin/status"),
  });

  if (counts.isLoading) return <LoadingPage />;
  const c = counts.data?.counts ?? {};
  const perStudio = counts.data?.studios ?? [];
  const config = status.data?.config;

  return (
    <div className="space-y-5">
      {config && !config.aiConfigured && (
        <Banner tone="warning" title="The AI is switched off">
          <code>ANTHROPIC_API_KEY</code> isn't set on the server, so building the wiki and
          processing Town Hall notes won't work. Everything else does.
        </Banner>
      )}
      {config && config.aiConfigured && !config.aiEnabled && (
        <Banner tone="info" title="AI features are switched off">
          The key is set, but this academy has turned the AI off in{" "}
          <Link href="/settings" className="font-semibold underline">
            Settings
          </Link>
          .
        </Banner>
      )}
      {config && !config.emailConfigured && (
        <Banner tone="info" title="Email isn't set up">
          Invites still work — you'll just get a link to send yourself instead of an automatic
          email. Set <code>SMTP_USER</code> and <code>SMTP_PASS</code> (a Google App Password) to
          turn it on.
        </Banner>
      )}

      <p className="text-sm text-gray-500">
        {studio
          ? `Counts for ${studio.name}, plus anything filed academy-wide.`
          : "Counts across every studio."}
      </p>

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

      {/* The point of this table is spotting the studio that's fallen behind. */}
      {perStudio.length > 0 && (
        <div className="card scroll-x">
          <h2 className="border-b border-gray-200 p-4 text-sm font-semibold text-gray-900">
            Studio by studio
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="p-3 font-medium">Studio</th>
                <th className="p-3 font-medium">People</th>
                <th className="p-3 font-medium">Rules</th>
                <th className="p-3 font-medium">Open questions</th>
                <th className="p-3 font-medium">Open votes</th>
                <th className="p-3 font-medium">Last Town Hall</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {perStudio.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="p-3">
                    <button
                      onClick={() => selectStudio(row.id)}
                      className="flex items-center gap-2 font-medium text-gray-900 hover:underline"
                      title={`Switch to ${row.name}`}
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: row.color }}
                      />
                      {row.name}
                    </button>
                  </td>
                  <td className="p-3 tabular-nums text-gray-600">{row.members}</td>
                  <td className="p-3 tabular-nums text-gray-600">{row.rules}</td>
                  <td className="p-3">
                    {row.openFindings > 0 ? (
                      <Chip tone="amber">{row.openFindings}</Chip>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    {row.openElections > 0 ? (
                      <Chip tone="green">{row.openElections}</Chip>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap p-3 text-xs text-gray-500">
                    {row.lastMeeting ? formatDate(row.lastMeeting) : "never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {config && (
        <div className="card-pad text-xs text-gray-500">
          <div className="font-medium text-gray-700">Server configuration</div>
          <dl className="mt-2 grid gap-1 sm:grid-cols-2">
            <div>
              Model: <span className="font-mono">{config.model}</span> ({config.effort} effort)
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
  studioId: number | null;
  studioName: string | null;
  active: boolean;
  avatarUrl: string | null;
  lastLoginAt: string | null;
  positions: string[];
};

type AdminStudio = { id: number; name: string; ageRange: string | null; color: string };

const ROLE_HELP: Record<string, string> = {
  admin: "Full control: settings, invites, the wiki, elections.",
  secretary: "Takes Town Hall notes and processes them into the wiki.",
  guide: "Reads everything, decides nothing.",
  learner: "Reads the wiki, runs for positions, votes.",
};

/**
 * The roster, and where each person belongs.
 *
 * Assigning a studio is the single most consequential thing on this page: it
 * decides which Contract someone reads, which Town Halls they sit in, which
 * ballots they can cast, and - in a studio running the simple view - which
 * version of the app they get. So it's a column, not a buried setting.
 */
function PeopleAdmin() {
  const queryClient = useQueryClient();
  const formatDate = useDateFormat();
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const query = useQuery<{ users: AdminUser[]; studios: AdminStudio[] }>({
    queryKey: ["admin-users"],
    queryFn: () => apiGet("/admin/users"),
  });

  const update = useMutation({
    mutationFn: (input: { id: number; patch: Record<string, unknown> }) =>
      apiPatch(`/admin/users/${input.id}`, input.patch),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      void queryClient.invalidateQueries({ queryKey: ["studios"] });
    },
    onError: (updateError: Error) => setError(updateError.message),
  });

  if (query.isLoading) return <LoadingPage />;

  const studios = query.data?.studios ?? [];
  const users = (query.data?.users ?? []).filter((person) => {
    if (filter === "all") return true;
    if (filter === "none") return person.studioId === null;
    return person.studioId === Number(filter);
  });
  const unplaced = (query.data?.users ?? []).filter(
    (person) => person.studioId === null && person.active,
  ).length;

  return (
    <div className="space-y-4">
      {error && <Banner tone="error">{error}</Banner>}

      {unplaced > 0 && (
        <Banner tone="warning" title={`${unplaced} ${unplaced === 1 ? "person isn't" : "people aren't"} in a studio`}>
          Until someone has a studio they can't see a Contract, sit in a Town Hall, or vote. Set
          one in the Studio column.
        </Banner>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-gray-600" htmlFor="studio-filter">
          Show
        </label>
        <select
          id="studio-filter"
          className="input w-auto"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="all">Everyone</option>
          {studios.map((studio) => (
            <option key={studio.id} value={studio.id}>
              {studio.name}
            </option>
          ))}
          <option value="none">Not in a studio</option>
        </select>
        <span className="text-sm text-gray-400">{users.length} shown</span>
      </div>

      <div className="card scroll-x">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="p-3 font-medium">Person</th>
              <th className="p-3 font-medium">Studio</th>
              <th className="p-3 font-medium">Role</th>
              <th className="p-3 font-medium">Positions</th>
              <th className="p-3 font-medium">Last seen</th>
              <th className="p-3 font-medium">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((person) => (
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
                    className={`input w-auto py-1 text-xs ${
                      person.studioId === null ? "border-amber-300 bg-amber-50" : ""
                    }`}
                    value={person.studioId ?? ""}
                    onChange={(event) =>
                      update.mutate({
                        id: person.id,
                        patch: {
                          studioId: event.target.value === "" ? null : Number(event.target.value),
                        },
                      })
                    }
                  >
                    <option value="">Not set</option>
                    {studios.map((studio) => (
                      <option key={studio.id} value={studio.id}>
                        {studio.name}
                      </option>
                    ))}
                  </select>
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
                  {person.lastLoginAt ? formatDate(person.lastLoginAt) : "never"}
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
        they held — but they can't sign in. Moving someone between studios doesn't move their
        history: past positions and votes stay recorded where they happened.
      </p>
    </div>
  );
}

/* --------------------------------- invites -------------------------------- */

type Invite = {
  id: number;
  email: string;
  role: string;
  studioName: string | null;
  acceptedAt: string | null;
  expired: boolean;
  emailError: string | null;
  link: string;
  createdAt: string;
};

function Invites() {
  const { academy, settings, studioId, studios } = useSession();
  const queryClient = useQueryClient();
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<string>(settings.access.defaultInviteRole);
  const [targetStudio, setTargetStudio] = useState<number | null>(studioId ?? null);
  const [results, setResults] = useState<
    { email: string; status: string; detail?: string; link?: string }[] | null
  >(null);
  const [copied, setCopied] = useState<string | null>(null);

  const query = useQuery<{
    invites: Invite[];
    studios: { id: number; name: string }[];
    emailConfigured: boolean;
  }>({
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
        // Whoever accepts lands straight in the right studio, which is the
        // difference between a working account and one that shows nothing.
        studioId: targetStudio,
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
          Only addresses on <strong>@{academy?.emailDomain}</strong> can be invited. Invites expire
          after {settings.notifications.inviteExpiryDays} days.
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
              <label className="label" htmlFor="invite-studio">
                Joining which studio
              </label>
              <select
                id="invite-studio"
                className="input w-auto"
                value={targetStudio ?? ""}
                onChange={(event) =>
                  setTargetStudio(event.target.value === "" ? null : Number(event.target.value))
                }
              >
                <option value="">No studio yet</option>
                {studios.map((studio) => (
                  <option key={studio.id} value={studio.id}>
                    {studio.name}
                  </option>
                ))}
              </select>
            </div>
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
          <p className="text-xs text-gray-500">
            {ROLE_HELP[role]}
            {targetStudio === null &&
              " They won't see any rules or votes until someone puts them in a studio."}
          </p>
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
                  {invite.studioName ? (
                    <Chip>{invite.studioName}</Chip>
                  ) : (
                    <Chip tone="amber">no studio</Chip>
                  )}
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
    studioName: string | null;
    createdAt: string;
    finishedAt: string | null;
  }[];
  activeMeetings: { id: number; title: string; status: string; studioName: string | null }[];
  openElections: { id: number; title: string; status: string; studioName: string | null }[];
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
  const { studioId, studio } = useSession();
  const formatDate = useDateFormat();
  const query = useQuery<StatusResponse>({
    queryKey: ["admin-status", studioId],
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
                  <li key={meeting.id} className="flex flex-wrap items-center gap-2 p-3.5 text-sm">
                    <a href={`/town-hall/${meeting.id}`} className="flex-1 hover:underline">
                      {meeting.title}
                    </a>
                    {meeting.studioName && <Chip>{meeting.studioName}</Chip>}
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
                  <li key={election.id} className="flex flex-wrap items-center gap-2 p-3.5 text-sm">
                    <a href={`/elections/${election.id}`} className="flex-1 hover:underline">
                      {election.title}
                    </a>
                    {election.studioName && <Chip>{election.studioName}</Chip>}
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
                  {job.studioName ? (
                    <Chip>{job.studioName}</Chip>
                  ) : (
                    <Chip tone="neutral">academy-wide</Chip>
                  )}
                  <Chip tone={JOB_TONE[job.status] ?? "neutral"}>
                    {job.status.replace("_", " ")}
                  </Chip>
                  <span className="text-xs text-gray-400">{formatDate(job.createdAt, true)}</span>
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
  studioName: string | null;
};

function ActivityLog() {
  const [search, setSearch] = useState("");
  const [actorType, setActorType] = useState("all");
  const { studioId, studio } = useSession();
  const formatDate = useDateFormat();

  const query = useQuery<{ entries: LogEntry[]; nextCursor: number | null }>({
    queryKey: ["activity", search, actorType, studioId],
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
        <span className="self-center text-xs text-gray-500">
          {studio
            ? `${studio.name} and academy-wide events.`
            : "Every studio."}
        </span>
      </div>

      {query.isLoading ? (
        <LoadingPage />
      ) : (query.data?.entries.length ?? 0) === 0 ? (
        <div className="card px-6 py-10 text-center text-sm text-gray-500">Nothing logged yet.</div>
      ) : (
        <div className="card divide-y divide-gray-100">
          {query.data!.entries.map(({ entry, actorName, studioName }) => (
            <div key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-3.5">
              <span className="w-36 shrink-0 text-xs tabular-nums text-gray-400">
                {formatDate(entry.createdAt, true)}
              </span>
              <Chip tone={entry.actorType === "ai" ? "purple" : "neutral"}>
                {entry.actorType === "ai" ? "AI" : (actorName ?? entry.actorType)}
              </Chip>
              {studioId === null && studioName && <Chip>{studioName}</Chip>}
              <span className="min-w-0 flex-1 text-sm text-gray-700">{entry.summary}</span>
              <code className="text-xs text-gray-400">{entry.action}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
