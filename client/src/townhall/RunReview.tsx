/**
 * A processed Town Hall waiting to go into the Contract - reviewed like a pull
 * request. Everyone in the studio except the Secretary who submitted it can
 * approve it or ask for changes; once it has enough approvals and nobody is
 * still asking for changes, the Secretary pushes it into the wiki.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, GitCommitHorizontal, GitPullRequestClosed, MessageSquareWarning, Upload } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { useDateFormat } from "@/lib/session";
import { Banner, Chip, Markdown, Spinner } from "@/components/ui";
import { RUN_STATUS_LABEL, RUN_STATUS_TONE, type RunChange, type RunView } from "./types";

const OP_LABEL: Record<RunChange["op"], { label: string; tone: "green" | "amber" | "red" | "brand" | "neutral" }> = {
  create_section: { label: "New section", tone: "brand" },
  create_rule: { label: "Add", tone: "green" },
  amend_rule: { label: "Amend", tone: "amber" },
  repeal_rule: { label: "Repeal", tone: "red" },
  move_rule: { label: "Move", tone: "neutral" },
};

export function RunReview({ meetingId }: { meetingId: number }) {
  const query = useQuery<{ runs: RunView[] }>({
    queryKey: ["meeting-runs", meetingId],
    queryFn: () => apiGet(`/town-hall/${meetingId}/runs`),
    refetchInterval: 15_000,
  });
  const runs = query.data?.runs ?? [];
  if (runs.length === 0) return null;
  const [current, ...older] = runs;
  return (
    <div className="space-y-3">
      <RunCard run={current} meetingId={meetingId} />
      {older.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer p-3.5 text-sm font-medium text-gray-700">
            {older.length} earlier run{older.length === 1 ? "" : "s"} of this meeting
          </summary>
          <ul className="divide-y divide-gray-100 border-t border-gray-100">
            {older.map((run) => (
              <li key={run.id}>
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 p-3 text-sm">
                    <span className="font-mono text-xs text-gray-500">#{run.id}</span>
                    <Chip tone={RUN_STATUS_TONE[run.status]}>{RUN_STATUS_LABEL[run.status]}</Chip>
                    <span className="text-xs text-gray-500">
                      {run.approvals} of {run.approvalsRequired} approvals
                    </span>
                  </summary>
                  <div className="p-3 pt-0">
                    <RunCard run={run} meetingId={meetingId} compact />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function RunCard({ run, meetingId, compact = false }: { run: RunView; meetingId: number; compact?: boolean }) {
  const formatDate = useDateFormat();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [comment, setComment] = useState("");
  const [closing, setClosing] = useState(false);
  const [closeNote, setCloseNote] = useState("");

  const refresh = () => {
    setError(null);
    for (const key of [["meeting-runs", meetingId], ["meeting", meetingId], ["town-hall-graph"], ["wiki"], ["findings"], ["job"], ["meetings"]]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };
  const review = useMutation({
    mutationFn: (input: { verdict: "approve" | "changes"; comment?: string }) =>
      apiPost(`/town-hall/runs/${run.id}/review`, input),
    onSuccess: () => {
      setAsking(false);
      setComment("");
      refresh();
    },
    onError: (failure: Error) => setError(failure.message),
  });
  const push = useMutation({
    mutationFn: () => apiPost(`/town-hall/runs/${run.id}/push`),
    onSuccess: refresh,
    onError: (failure: Error) => setError(failure.message),
  });
  const close = useMutation({
    mutationFn: () => apiPost(`/town-hall/runs/${run.id}/close`, { note: closeNote || null }),
    onSuccess: () => {
      setClosing(false);
      refresh();
    },
    onError: (failure: Error) => setError(failure.message),
  });

  const share = Math.min(1, run.approvals / Math.max(1, run.approvalsRequired));
  const pending = run.status === "pending";

  return (
    <div className={compact ? "space-y-3" : "card"}>
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <GitCommitHorizontal className="h-4 w-4 text-brand-600" />
            Run #{run.id}
            <Chip tone={RUN_STATUS_TONE[run.status]}>{RUN_STATUS_LABEL[run.status]}</Chip>
          </h2>
          <span className="text-xs text-gray-500">
            {run.submittedBy ? `Submitted by ${run.submittedBy.name}` : "Submitted"} · {formatDate(run.createdAt)}
          </span>
        </div>
      )}

      <div className={compact ? "space-y-3" : "space-y-4 p-4"}>
        {error && <Banner tone="error">{error}</Banner>}

        {pending && (
          <div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium text-gray-800">
                {run.approvals} of {run.approvalsRequired} approvals
              </span>
              {run.changesRequested > 0 && (
                <Chip tone="red">
                  {run.changesRequested} asking for changes
                </Chip>
              )}
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={run.approvals} aria-valuemax={run.approvalsRequired}>
              <div className={`h-full rounded-full ${share >= 1 ? "bg-emerald-500" : "bg-brand-600"}`} style={{ width: `${share * 100}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-gray-500">
              Nothing in the wiki changes until {run.approvalsRequired} people have checked this and the Secretary pushes it.
            </p>
          </div>
        )}
        {run.status === "pushed" && run.pushedAt && (
          <Banner tone="success" title="Pushed into the Contract">
            {formatDate(run.pushedAt)}, after {run.approvals} approvals
            {run.outcome ? `: ${run.outcome.created ?? 0} added, ${run.outcome.amended ?? 0} amended, ${run.outcome.repealed ?? 0} repealed.` : "."}
          </Banner>
        )}
        {run.status === "closed" && (
          <Banner tone="info" title="Closed without being pushed">
            {run.closeNote ?? "Nothing from this run went into the wiki."}
          </Banner>
        )}
        {run.status === "superseded" && (
          <Banner tone="info">The meeting was processed again, so this run was replaced. Nothing from it went into the wiki.</Banner>
        )}

        {pending && run.stale && (
          <Banner tone="warning" title="The Contract changed under this run">
            Some rules it changes were edited after it was made (marked below). Process the meeting again so it's
            checked against the rules as they are now.
          </Banner>
        )}
        {pending && !run.stale && run.behind && (
          <Banner tone="info">
            Another Town Hall was pushed since this run was made. Nothing it changes was touched, so it can still be pushed.
          </Banner>
        )}

        {run.summary && (
          <div className="rounded-lg bg-gray-50 p-3.5">
            <Markdown>{run.summary}</Markdown>
          </div>
        )}

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {run.changes.length} change{run.changes.length === 1 ? "" : "s"} to the Contract
          </h3>
          {run.changes.length === 0 ? (
            <p className="mt-1 text-sm text-gray-500">This meeting doesn't change any rules.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {run.changes.map((change, index) => (
                <ChangeView key={index} change={change} />
              ))}
            </ul>
          )}
        </div>

        {(run.unresolvedQuestions.length > 0 || run.proposedElections.length > 0 || run.newPositions.length > 0) && (
          <div className="rounded-lg border border-gray-200 p-3 text-sm text-gray-600">
            {run.unresolvedQuestions.length > 0 && (
              <p>
                <span className="font-medium text-gray-800">Questions for the Secretary:</span>{" "}
                {run.unresolvedQuestions.join(" · ")}
              </p>
            )}
            {run.proposedElections.length > 0 && (
              <p className="mt-1">
                <span className="font-medium text-gray-800">Elections it suggests</span> (offered after the push):{" "}
                {run.proposedElections.map((proposal) => proposal.title).join(" · ")}
              </p>
            )}
            {run.newPositions.length > 0 && (
              <p className="mt-1">
                <span className="font-medium text-gray-800">New positions it would add:</span>{" "}
                {run.newPositions.map((position) => position.title).join(" · ")}
              </p>
            )}
          </div>
        )}

        {run.reviews.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Reviews</h3>
            <ul className="mt-2 space-y-1.5">
              {run.reviews.map((entry) => (
                <li key={entry.userId} className="flex flex-wrap items-start gap-2 text-sm">
                  <Chip tone={entry.verdict === "approve" ? "green" : "red"}>
                    {entry.verdict === "approve" ? "Approved" : "Changes"}
                  </Chip>
                  <span className="font-medium text-gray-800">{entry.name}</span>
                  {entry.comment && <span className="min-w-0 flex-1 text-gray-600">“{entry.comment}”</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {pending && (
          <div className="space-y-3 border-t border-gray-100 pt-3">
            {run.you.canReview ? (
              <div className="space-y-2">
                {run.you.verdict && (
                  <p className="text-xs text-gray-500">
                    You {run.you.verdict === "approve" ? "approved this" : "asked for changes"}. You can change your mind.
                  </p>
                )}
                {asking ? (
                  <div className="space-y-2">
                    <label className="label" htmlFor={`changes-${run.id}`}>
                      What needs changing?
                    </label>
                    <textarea
                      id={`changes-${run.id}`}
                      className="input min-h-[70px]"
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                      placeholder="Rule 4 should say Fridays, not Thursdays."
                    />
                    <div className="flex gap-2">
                      <button
                        className="btn-danger btn-sm"
                        disabled={!comment.trim() || review.isPending}
                        onClick={() => review.mutate({ verdict: "changes", comment })}
                      >
                        {review.isPending && <Spinner />} Request changes
                      </button>
                      <button className="btn-secondary btn-sm" onClick={() => setAsking(false)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {run.you.verdict !== "approve" && (
                      <button
                        className="btn-primary btn-sm"
                        disabled={review.isPending}
                        onClick={() => review.mutate({ verdict: "approve" })}
                      >
                        {review.isPending ? <Spinner /> : <Check className="h-4 w-4" />} It's correct — approve
                      </button>
                    )}
                    <button className="btn-secondary btn-sm" onClick={() => setAsking(true)}>
                      <MessageSquareWarning className="h-4 w-4" /> Request changes
                    </button>
                  </div>
                )}
              </div>
            ) : (
              run.you.reviewBlockedReason && <p className="text-xs text-gray-500">{run.you.reviewBlockedReason}</p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {run.you.pusher && (
                <button
                  className="btn-primary"
                  disabled={!run.you.canPush || push.isPending}
                  onClick={() => push.mutate()}
                  title={run.you.pushBlockedReason ?? undefined}
                >
                  {push.isPending ? <Spinner /> : <Upload className="h-4 w-4" />} Push to the wiki
                </button>
              )}
              {run.you.pusher && !run.you.canPush && run.you.pushBlockedReason && (
                <span className="text-xs text-gray-500">{run.you.pushBlockedReason}</span>
              )}
              {run.you.canClose && !closing && (
                <button className="btn-ghost btn-sm" onClick={() => setClosing(true)}>
                  <GitPullRequestClosed className="h-4 w-4" /> Close run
                </button>
              )}
            </div>
            {closing && (
              <div className="space-y-2">
                <input
                  className="input"
                  value={closeNote}
                  onChange={(event) => setCloseNote(event.target.value)}
                  placeholder="Why it's being closed (optional)"
                />
                <div className="flex gap-2">
                  <button className="btn-danger btn-sm" disabled={close.isPending} onClick={() => close.mutate()}>
                    {close.isPending && <Spinner />} Close without pushing
                  </button>
                  <button className="btn-secondary btn-sm" onClick={() => setClosing(false)}>
                    Keep it open
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ChangeView({ change }: { change: RunChange }) {
  const op = OP_LABEL[change.op];
  return (
    <li className={`rounded-lg border p-3 text-sm ${change.stale ? "border-amber-300 bg-amber-50" : "border-gray-200"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={op.tone}>{op.label}</Chip>
        <span className="font-medium text-gray-900">{change.title}</span>
        {change.section && change.op !== "move_rule" && <span className="text-xs text-gray-500">in {change.section}</span>}
        {change.stale && <Chip tone="amber">changed since</Chip>}
      </div>
      {change.op === "move_rule" ? (
        <p className="mt-1.5 text-xs text-gray-600">
          From <span className="font-medium">{change.before ?? "?"}</span> to <span className="font-medium">{change.after}</span>
        </p>
      ) : (
        <div className="mt-2 space-y-1 font-mono text-[12px] leading-5">
          {change.before && (
            <pre className="whitespace-pre-wrap rounded bg-red-50 px-2 py-1 text-red-900">
              {change.before
                .split("\n")
                .map((line) => `- ${line}`)
                .join("\n")}
            </pre>
          )}
          {change.after && (
            <pre className="whitespace-pre-wrap rounded bg-emerald-50 px-2 py-1 text-emerald-900">
              {change.after
                .split("\n")
                .map((line) => `+ ${line}`)
                .join("\n")}
            </pre>
          )}
        </div>
      )}
      {change.rationale && <p className="mt-1.5 text-xs text-gray-500">Why: {change.rationale}</p>}
    </li>
  );
}
