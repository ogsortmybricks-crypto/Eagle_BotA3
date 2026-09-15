import { useState } from "react";
import { Link, Redirect, Route, Switch, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  Eye,
  LogOut,
  Shield,
  Vote,
} from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Avatar, LoadingPage, Markdown, Spinner } from "@/components/ui";

/**
 * The simple view.
 *
 * A studio of six- and seven-year-olds needs to be able to answer two
 * questions on their own: "what are our rules?" and "what am I voting on?".
 * Everything that serves an adult running the studio - provenance, revision
 * history, findings, the activity log, settings - is noise to them, and noise
 * is what stops a young Hero reading the Contract at all.
 *
 * So this is not the normal app with things hidden. It's three screens, big
 * type, and one action per screen. An admin turns it on per studio in
 * Settings, and it follows the learner rather than the studio they're looking
 * at, because their reading level doesn't change when they open another tab.
 */

const NAV = [
  { href: "/wiki", label: "Our rules", icon: BookOpen },
  { href: "/elections", label: "Voting", icon: Vote },
  { href: "/positions", label: "Jobs", icon: Shield },
] as const;

export function SimpleApp() {
  const { user, academy, studio, signOut, simpleModePreview } = useSession();
  const [location] = useLocation();

  if (!user || !academy) return <LoadingPage />;

  return (
    <div className="min-h-screen bg-white">
      {simpleModePreview && <PreviewBar />}

      <header
        className="px-5 py-5 text-white"
        style={{ background: studio?.color ?? "#3b82f6" }}
      >
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          {academy.logoUrl ? (
            <img src={academy.logoUrl} alt="" className="h-11 w-11 rounded-xl bg-white/90 p-1" />
          ) : (
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/20 text-lg font-bold">
              {academy.name.slice(0, 1)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-xl font-bold leading-tight">{studio?.name ?? academy.name}</div>
            <div className="text-sm opacity-90">Hi, {user.name.split(" ")[0]}</div>
          </div>
          <button
            onClick={signOut}
            className="rounded-xl bg-white/20 p-2.5 transition hover:bg-white/30"
            aria-label="Sign out"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-6 pb-28">
        <Switch>
          <Route path="/">{() => <Redirect to="/wiki" />}</Route>
          <Route path="/wiki" component={SimpleRules} />
          <Route path="/elections" component={SimpleVoting} />
          <Route path="/elections/:id">
            {(params) => <SimpleBallot id={Number(params.id)} />}
          </Route>
          <Route path="/positions" component={SimpleJobs} />
          <Route>{() => <Redirect to="/wiki" />}</Route>
        </Switch>
      </main>

      {/* A fixed bar of three big targets. Nothing else to get lost in. */}
      <nav className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl">
          {NAV.map((item) => {
            const active = location.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-1 flex-col items-center gap-1 py-3.5 text-sm font-semibold transition ${
                  active ? "text-brand-700" : "text-gray-400"
                }`}
              >
                <item.icon className="h-6 w-6" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

/** Reminds an admin they're in a preview, and gets them out in one click. */
function PreviewBar() {
  const queryClient = useQueryClient();
  const stop = useMutation({
    mutationFn: () => apiPost("/auth/preview-simple", { enabled: false }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      window.location.href = "/settings";
    },
  });

  return (
    <div className="flex items-center justify-center gap-3 bg-gray-900 px-4 py-2 text-sm text-white">
      <Eye className="h-4 w-4" />
      <span>You're previewing the simple view.</span>
      <button
        onClick={() => stop.mutate()}
        disabled={stop.isPending}
        className="rounded-lg bg-white/20 px-2.5 py-1 font-semibold transition hover:bg-white/30"
      >
        {stop.isPending ? "Leaving..." : "Back to normal"}
      </button>
    </div>
  );
}

/* --------------------------------- rules ---------------------------------- */

type SimpleRule = { id: number; title: string; body: string; status: string };
type SimpleSection = { id: number; title: string; summary: string | null; rules: SimpleRule[] };

function SimpleRules() {
  const { studioId } = useSession();
  const [openSection, setOpenSection] = useState<number | null>(null);

  const query = useQuery<{ sections: SimpleSection[] }>({
    queryKey: ["wiki", false, studioId],
    queryFn: () => apiGet("/wiki?includeRepealed=false"),
  });

  if (query.isLoading) return <LoadingPage label="Getting our rules..." />;

  const sections = (query.data?.sections ?? []).filter((section) => section.rules.length > 0);

  if (sections.length === 0) {
    return (
      <div className="rounded-2xl bg-gray-50 px-6 py-14 text-center">
        <BookOpen className="mx-auto h-10 w-10 text-gray-300" />
        <p className="mt-4 text-lg font-semibold text-gray-700">No rules written down yet.</p>
      </div>
    );
  }

  const active = sections.find((section) => section.id === openSection);

  if (active) {
    return (
      <div>
        <button
          onClick={() => setOpenSection(null)}
          className="mb-4 flex items-center gap-1.5 text-base font-semibold text-brand-700"
        >
          <ChevronLeft className="h-5 w-5" /> All our rules
        </button>
        <h1 className="text-2xl font-bold text-gray-900">{active.title}</h1>
        {active.summary && <p className="mt-1 text-base text-gray-600">{active.summary}</p>}
        <ol className="mt-5 space-y-4">
          {active.rules.map((rule, index) => (
            <li key={rule.id} className="rounded-2xl border-2 border-gray-100 p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-base font-bold text-brand-700">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-bold text-gray-900">{rule.title}</h2>
                  {/* No citation, no history, no edit button. Just the rule. */}
                  <div className="mt-1.5 text-[17px] leading-relaxed text-gray-700">
                    <Markdown>{rule.body}</Markdown>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Our rules</h1>
      <p className="mt-1 text-base text-gray-600">Tap one to read it.</p>
      <div className="mt-5 space-y-3">
        {sections.map((section) => (
          <button
            key={section.id}
            onClick={() => setOpenSection(section.id)}
            className="flex w-full items-center gap-4 rounded-2xl border-2 border-gray-100 p-5 text-left transition hover:border-brand-300"
          >
            <BookOpen className="h-6 w-6 shrink-0 text-brand-500" />
            <div className="min-w-0 flex-1">
              <div className="text-lg font-bold text-gray-900">{section.title}</div>
              <div className="text-sm text-gray-500">
                {section.rules.length} rule{section.rules.length === 1 ? "" : "s"}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------- voting ---------------------------------- */

type SimpleElectionRow = {
  election: { id: number; title: string; status: string; type: string };
  candidateCount: number;
  hasVoted: boolean;
  canVote: boolean;
};

function SimpleVoting() {
  const { studioId } = useSession();
  const query = useQuery<{ elections: SimpleElectionRow[] }>({
    queryKey: ["elections", studioId],
    queryFn: () => apiGet("/elections"),
  });

  if (query.isLoading) return <LoadingPage label="Checking for votes..." />;

  const open = (query.data?.elections ?? []).filter((row) => row.election.status === "open");

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Voting</h1>
      {open.length === 0 ? (
        <div className="mt-5 rounded-2xl bg-gray-50 px-6 py-14 text-center">
          <Vote className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-4 text-lg font-semibold text-gray-700">Nothing to vote on right now.</p>
          <p className="mt-1 text-base text-gray-500">We'll show it here when there is.</p>
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {open.map((row) => (
            <Link
              key={row.election.id}
              href={`/elections/${row.election.id}`}
              className="flex items-center gap-4 rounded-2xl border-2 border-gray-100 p-5 transition hover:border-brand-300"
            >
              <div className="min-w-0 flex-1">
                <div className="text-lg font-bold text-gray-900">{row.election.title}</div>
                <div className="text-sm text-gray-500">
                  {row.election.type === "position" ? "Choose a person" : "Yes or no"}
                </div>
              </div>
              {row.hasVoted ? (
                <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-sm font-semibold text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" /> Voted
                </span>
              ) : (
                <span className="shrink-0 rounded-full bg-brand-600 px-4 py-2 text-sm font-bold text-white">
                  Vote
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

type SimpleCandidate = {
  id: number;
  label: string;
  userName: string | null;
  userAvatar: string | null;
  statement: string | null;
};

function SimpleBallot({ id }: { id: number }) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [picked, setPicked] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery<{
    election: { id: number; title: string; description: string | null; seats: number; status: string };
    candidates: SimpleCandidate[];
    myVotes: number[];
    canVote: boolean;
    voteBlockedReason: string | null;
  }>({
    queryKey: ["election", id],
    queryFn: () => apiGet(`/elections/${id}`),
  });

  const vote = useMutation({
    mutationFn: () => apiPost(`/elections/${id}/vote`, { candidateIds: picked }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["elections"] });
      await queryClient.invalidateQueries({ queryKey: ["election", id] });
      navigate("/elections");
    },
    onError: (voteError: Error) => setError(voteError.message),
  });

  if (query.isLoading) return <LoadingPage />;
  if (!query.data) return null;

  const { election, candidates, myVotes, canVote, voteBlockedReason } = query.data;
  const already = myVotes.length > 0;
  const seats = election.seats;

  function toggle(candidateId: number) {
    setPicked((current) => {
      if (current.includes(candidateId)) return current.filter((value) => value !== candidateId);
      if (seats === 1) return [candidateId];
      return current.length >= seats ? current : [...current, candidateId];
    });
  }

  return (
    <div>
      <button
        onClick={() => navigate("/elections")}
        className="mb-4 flex items-center gap-1.5 text-base font-semibold text-brand-700"
      >
        <ChevronLeft className="h-5 w-5" /> Back
      </button>

      <h1 className="text-2xl font-bold text-gray-900">{election.title}</h1>
      {election.description && (
        <p className="mt-1.5 text-base text-gray-600">{election.description}</p>
      )}
      <p className="mt-2 text-base font-semibold text-gray-700">
        {seats === 1 ? "Pick one." : `Pick up to ${seats}.`}
      </p>

      {error && (
        <div className="mt-4 rounded-2xl bg-red-50 p-4 text-base font-medium text-red-700">
          {error}
        </div>
      )}
      {!canVote && voteBlockedReason && (
        <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-base font-medium text-amber-800">
          {voteBlockedReason}
        </div>
      )}
      {already && (
        <div className="mt-4 rounded-2xl bg-emerald-50 p-4 text-base font-medium text-emerald-800">
          You already voted. You can change it if you want.
        </div>
      )}

      <div className="mt-5 space-y-3">
        {candidates.map((candidate) => {
          const chosen = picked.includes(candidate.id);
          return (
            <button
              key={candidate.id}
              onClick={() => toggle(candidate.id)}
              disabled={!canVote}
              className={`flex w-full items-center gap-4 rounded-2xl border-4 p-5 text-left transition disabled:opacity-60 ${
                chosen ? "border-brand-600 bg-brand-50" : "border-gray-100 hover:border-gray-300"
              }`}
            >
              {candidate.userName && (
                <Avatar name={candidate.userName} src={candidate.userAvatar} size={52} />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-lg font-bold text-gray-900">
                  {candidate.userName ?? candidate.label}
                </div>
                {candidate.statement && (
                  <div className="mt-0.5 text-base text-gray-600">{candidate.statement}</div>
                )}
              </div>
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-4 ${
                  chosen ? "border-brand-600 bg-brand-600 text-white" : "border-gray-200"
                }`}
              >
                {chosen && <Check className="h-5 w-5" />}
              </span>
            </button>
          );
        })}
      </div>

      {canVote && (
        <button
          onClick={() => vote.mutate()}
          disabled={picked.length === 0 || vote.isPending}
          className="mt-6 w-full rounded-2xl bg-brand-600 py-5 text-xl font-bold text-white transition hover:bg-brand-700 disabled:opacity-40"
        >
          {vote.isPending ? <Spinner className="mx-auto h-6 w-6" /> : already ? "Change my vote" : "Vote"}
        </button>
      )}
    </div>
  );
}

/* --------------------------------- jobs ----------------------------------- */

type SimplePosition = {
  id: number;
  title: string;
  description: string | null;
  seats: number;
  current: { id: number; name: string; avatarUrl: string | null }[];
};

function SimpleJobs() {
  const { studioId } = useSession();
  const query = useQuery<{ positions: SimplePosition[] }>({
    queryKey: ["positions", studioId],
    queryFn: () => apiGet("/positions"),
  });

  if (query.isLoading) return <LoadingPage />;
  const positions = query.data?.positions ?? [];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Jobs in our studio</h1>
      <p className="mt-1 text-base text-gray-600">Who does what.</p>

      {positions.length === 0 ? (
        <div className="mt-5 rounded-2xl bg-gray-50 px-6 py-14 text-center">
          <Shield className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-4 text-lg font-semibold text-gray-700">No jobs yet.</p>
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {positions.map((position) => (
            <div key={position.id} className="rounded-2xl border-2 border-gray-100 p-5">
              <div className="text-lg font-bold text-gray-900">{position.title}</div>
              {position.description && (
                <p className="mt-1 text-base text-gray-600">{position.description}</p>
              )}
              {position.current.length === 0 ? (
                <p className="mt-3 text-base font-semibold text-amber-600">Nobody has this job yet.</p>
              ) : (
                <ul className="mt-3 flex flex-wrap gap-3">
                  {position.current.map((holder) => (
                    <li key={holder.id} className="flex items-center gap-2">
                      <Avatar name={holder.name} src={holder.avatarUrl} size={36} />
                      <span className="text-base font-semibold text-gray-800">{holder.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
