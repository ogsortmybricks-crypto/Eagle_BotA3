import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Award, Check, Lock, Send, Trophy, UserPlus } from "lucide-react";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { useSession } from "@/lib/session";
import {
  Avatar,
  Banner,
  Chip,
  LoadingPage,
  Markdown,
  Modal,
  Spinner,
} from "@/components/ui";
import { JobProgress, useJob, type Job } from "@/components/JobStatus";
import { STATUS_TONE } from "./Elections";

type Candidate = {
  id: number;
  userId: number | null;
  label: string;
  statement: string | null;
  userName: string | null;
  userBio: string | null;
  userAvatar: string | null;
  userStudio: string | null;
  userNga: string | null;
  pastPositions: string[];
  votes: number | null;
};

type Detail = {
  election: {
    id: number;
    title: string;
    description: string | null;
    type: string;
    status: string;
    seats: number;
    proposalBody: string | null;
    selfNomination: boolean;
    closesAt: string | null;
    certifiedAt: string | null;
    results: { winners?: { label: string; votes: number }[] } | null;
  };
  candidates: Candidate[];
  myVotes: number[];
  turnout: { voters: number; eligible: number };
  canVote: boolean;
};

export function ElectionDetail({ id }: { id: number }) {
  const { can, user } = useSession();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nominating, setNominating] = useState(false);
  const [tieResults, setTieResults] = useState<{ label: string; votes: number }[] | null>(null);

  const query = useQuery<Detail>({
    queryKey: ["election", id],
    queryFn: () => apiGet(`/elections/${id}`),
  });

  const jobQuery = useQuery<{ job: Job | null }>({
    queryKey: ["election-job", id],
    queryFn: () => apiGet(`/elections/${id}/job`),
    refetchInterval: (q) => {
      const status = q.state.data?.job?.status;
      return status === "running" || status === "queued" ? 1500 : false;
    },
  });

  useEffect(() => {
    if (query.data) setSelected(query.data.myVotes);
  }, [query.data]);

  const vote = useMutation({
    mutationFn: () => apiPost(`/elections/${id}/vote`, { candidateIds: selected }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["election", id] });
      setError(null);
    },
    onError: (voteError: Error) => setError(voteError.message),
  });

  const setStatus = useMutation({
    mutationFn: (status: string) => apiPost(`/elections/${id}/status`, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["election", id] });
      void queryClient.invalidateQueries({ queryKey: ["elections"] });
      setError(null);
    },
    onError: (statusError: Error) => setError(statusError.message),
  });

  const certify = useMutation({
    mutationFn: () => apiPost<{ jobId: number | null }>(`/elections/${id}/certify`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["election", id] });
      void queryClient.invalidateQueries({ queryKey: ["election-job", id] });
      void queryClient.invalidateQueries({ queryKey: ["positions"] });
      setTieResults(null);
      setError(null);
    },
    onError: (certifyError: Error & { payload?: Record<string, unknown> }) => {
      if (certifyError.payload?.tie) {
        setTieResults(certifyError.payload.results as { label: string; votes: number }[]);
      }
      setError(certifyError.message);
    },
  });

  const withdraw = useMutation({
    mutationFn: (candidateId: number) => apiDelete(`/elections/${id}/candidates/${candidateId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["election", id] }),
  });

  if (query.isLoading) return <LoadingPage />;
  if (!query.data) return <Banner tone="error">That election doesn't exist.</Banner>;

  const { election, candidates, turnout, canVote } = query.data;
  const isOpen = election.status === "open";
  const isDecided = election.status === "closed" || election.status === "certified";
  const alreadyOnBallot = candidates.some((candidate) => candidate.userId === user?.id);
  const maxPicks = election.seats;
  const job = jobQuery.data?.job ?? null;

  function toggle(candidateId: number) {
    setSelected((current) => {
      if (current.includes(candidateId)) return current.filter((value) => value !== candidateId);
      if (current.length >= maxPicks) return maxPicks === 1 ? [candidateId] : current;
      return [...current, candidateId];
    });
  }

  const maxVotes = Math.max(1, ...candidates.map((candidate) => candidate.votes ?? 0));
  const winnerIds = new Set(
    isDecided
      ? [...candidates]
          .sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0))
          .slice(0, election.seats)
          .map((candidate) => candidate.id)
      : [],
  );

  return (
    <>
      <Link href="/elections" className="btn-ghost btn-sm -ml-2 mb-3">
        <ArrowLeft className="h-3.5 w-3.5" /> All elections
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">{election.title}</h1>
            <Chip tone={STATUS_TONE[election.status] ?? "neutral"}>{election.status}</Chip>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {election.type === "position"
              ? `${election.seats} seat${election.seats === 1 ? "" : "s"} to fill`
              : "Rule change"}
            {election.closesAt && ` · closes ${new Date(election.closesAt).toLocaleDateString()}`}
            {isOpen && ` · ${turnout.voters} of ${turnout.eligible} have voted`}
          </p>
        </div>

        {can("elections.manage") && (
          <div className="flex flex-wrap gap-2">
            {election.status === "draft" && (
              <button onClick={() => setStatus.mutate("open")} className="btn-primary">
                <Send className="h-4 w-4" /> Open voting
              </button>
            )}
            {election.status === "open" && (
              <button onClick={() => setStatus.mutate("closed")} className="btn-secondary">
                <Lock className="h-4 w-4" /> Close voting
              </button>
            )}
            {election.status === "closed" && (
              <button
                onClick={() => certify.mutate()}
                disabled={certify.isPending}
                className="btn-primary"
              >
                {certify.isPending ? <Spinner /> : <Trophy className="h-4 w-4" />} Certify result
              </button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-4">
        {error && <Banner tone="error">{error}</Banner>}
        {job && <JobProgress job={job} />}

        {tieResults && (
          <Banner tone="warning" title="It's a tie at the cut line">
            <p>
              The studio has to break this one — a runoff, a coin flip, whatever your rules say.
              Record the decision in a Town Hall, then adjust the ballot and certify.
            </p>
            <ul className="mt-2 space-y-0.5">
              {tieResults.map((row) => (
                <li key={row.label}>
                  {row.label}: {row.votes}
                </li>
              ))}
            </ul>
          </Banner>
        )}

        {election.description && (
          <div className="card-pad">
            <Markdown>{election.description}</Markdown>
          </div>
        )}

        {election.type === "rule" && election.proposalBody && (
          <div className="card">
            <h2 className="border-b border-gray-200 p-4 text-sm font-semibold text-gray-900">
              The proposal, word for word
            </h2>
            <div className="p-4">
              <Markdown>{election.proposalBody}</Markdown>
            </div>
          </div>
        )}

        {election.status === "certified" && (
          <Banner tone="success" title="Certified">
            {election.type === "position"
              ? "The winners have been seated in the Positions tab."
              : "The result has been recorded in the wiki."}
          </Banner>
        )}

        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-900">
              {election.type === "position" ? "On the ballot" : "Options"}
            </h2>
            {election.type === "position" &&
              election.selfNomination &&
              (election.status === "draft" || election.status === "open") &&
              !alreadyOnBallot &&
              user?.role !== "guide" && (
                <button onClick={() => setNominating(true)} className="btn-secondary btn-sm">
                  <UserPlus className="h-3.5 w-3.5" /> Put my name in
                </button>
              )}
          </div>

          {candidates.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-400">
              Nobody on the ballot yet.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {candidates.map((candidate) => {
                const chosen = selected.includes(candidate.id);
                const isMe = candidate.userId === user?.id;
                return (
                  <li key={candidate.id} className="p-4">
                    <label
                      className={`flex cursor-pointer items-start gap-3 ${
                        isOpen && canVote ? "" : "cursor-default"
                      }`}
                    >
                      {isOpen && canVote && (
                        <input
                          type={maxPicks === 1 ? "radio" : "checkbox"}
                          name="ballot"
                          checked={chosen}
                          onChange={() => toggle(candidate.id)}
                          className="mt-1.5 h-4 w-4 border-gray-300 text-brand-600"
                        />
                      )}

                      {candidate.userId && (
                        <Avatar name={candidate.userName ?? candidate.label} src={candidate.userAvatar} />
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-gray-900">
                            {candidate.userName ?? candidate.label}
                          </span>
                          {winnerIds.has(candidate.id) && (
                            <Chip tone="green">
                              <Award className="h-3 w-3" /> winner
                            </Chip>
                          )}
                          {isMe && <Chip tone="brand">you</Chip>}
                          {candidate.userStudio && <Chip>{candidate.userStudio}</Chip>}
                        </div>

                        {candidate.userNga && (
                          <p className="mt-0.5 text-xs text-gray-500">
                            Working toward: {candidate.userNga}
                          </p>
                        )}
                        {candidate.statement && (
                          <p className="mt-1.5 text-sm text-gray-700">{candidate.statement}</p>
                        )}
                        {candidate.userBio && !candidate.statement && (
                          <p className="mt-1.5 text-sm text-gray-600">{candidate.userBio}</p>
                        )}

                        {candidate.pastPositions.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            <span className="text-xs text-gray-400">Has served as:</span>
                            {[...new Set(candidate.pastPositions)].map((title) => (
                              <Chip key={title}>{title}</Chip>
                            ))}
                          </div>
                        )}

                        {candidate.votes !== null && (
                          <div className="mt-2.5">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-medium tabular-nums text-gray-700">
                                {candidate.votes} vote{candidate.votes === 1 ? "" : "s"}
                              </span>
                            </div>
                            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                              <div
                                className={`h-full rounded-full ${
                                  winnerIds.has(candidate.id) ? "bg-emerald-500" : "bg-brand-400"
                                }`}
                                style={{ width: `${((candidate.votes ?? 0) / maxVotes) * 100}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      {isMe && (election.status === "draft" || election.status === "open") && (
                        <button
                          onClick={(event) => {
                            event.preventDefault();
                            withdraw.mutate(candidate.id);
                          }}
                          className="btn-ghost btn-sm shrink-0"
                        >
                          Withdraw
                        </button>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          {isOpen && canVote && candidates.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 p-4">
              <div className="text-xs text-gray-500">
                {maxPicks > 1
                  ? `Pick up to ${maxPicks}. You've picked ${selected.length}.`
                  : "Pick one."}
                {query.data.myVotes.length > 0 && " You can change your vote until voting closes."}
              </div>
              <button
                onClick={() => vote.mutate()}
                disabled={selected.length === 0 || vote.isPending}
                className="btn-primary"
              >
                {vote.isPending ? <Spinner /> : <Check className="h-4 w-4" />}
                {query.data.myVotes.length > 0 ? "Update my vote" : "Cast my vote"}
              </button>
            </div>
          )}
        </div>
      </div>

      {nominating && (
        <NominateModal
          electionId={id}
          onClose={() => setNominating(false)}
          onDone={() => {
            setNominating(false);
            void queryClient.invalidateQueries({ queryKey: ["election", id] });
          }}
        />
      )}
    </>
  );
}

function NominateModal({
  electionId,
  onClose,
  onDone,
}: {
  electionId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [statement, setStatement] = useState("");
  const [error, setError] = useState<string | null>(null);

  const nominate = useMutation({
    mutationFn: () => apiPost(`/elections/${electionId}/candidates`, { statement }),
    onSuccess: onDone,
    onError: (nominateError: Error) => setError(nominateError.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Put your name in"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={() => nominate.mutate()}
            disabled={nominate.isPending}
            className="btn-primary"
          >
            {nominate.isPending && <Spinner />} Add me to the ballot
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-4">
          <Banner tone="error">{error}</Banner>
        </div>
      )}
      <label className="label" htmlFor="statement">
        Why you? (optional)
      </label>
      <textarea
        id="statement"
        className="input min-h-[120px]"
        value={statement}
        onChange={(event) => setStatement(event.target.value)}
        placeholder="What you'd do with the role, and why the studio should trust you with it."
        autoFocus
      />
      <p className="hint">
        This shows next to your name on the ballot, along with any positions you've held before.
      </p>
    </Modal>
  );
}
