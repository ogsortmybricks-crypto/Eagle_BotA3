/** The shapes `/town-hall/runs/*` sends back. Kept in step with server/townhall-runs.ts. */

export type RunStatus = "pending" | "pushed" | "closed" | "superseded";
export type RunVerdict = "approve" | "changes";

export type RunChange = {
  op: "create_section" | "create_rule" | "amend_rule" | "repeal_rule" | "move_rule";
  title: string;
  before: string | null;
  after: string | null;
  section: string | null;
  rationale: string;
  stale: boolean;
};

export type RunView = {
  id: number;
  meetingId: number;
  meetingTitle: string;
  status: RunStatus;
  summary: string;
  submittedBy: { id: number; name: string } | null;
  createdAt: string;
  pushedAt: string | null;
  closedAt: string | null;
  closeNote: string | null;
  baseRunId: number | null;
  replacesRunId: number | null;
  approvalsRequired: number;
  approvals: number;
  changesRequested: number;
  reviews: { userId: number; name: string; verdict: RunVerdict; comment: string | null; at: string }[];
  changes: RunChange[];
  proposedElections: { title: string; type: string }[];
  unresolvedQuestions: string[];
  newPositions: { title: string }[];
  outcome: { created?: number; amended?: number; repealed?: number; skipped?: string[] } | null;
  stale: boolean;
  behind: boolean;
  you: {
    canReview: boolean;
    reviewBlockedReason: string | null;
    verdict: RunVerdict | null;
    pusher: boolean;
    canPush: boolean;
    pushBlockedReason: string | null;
    canClose: boolean;
  };
};

export type GraphNode = {
  id: number;
  meetingId: number;
  meetingTitle: string;
  status: RunStatus;
  baseRunId: number | null;
  replacesRunId: number | null;
  submittedBy: string | null;
  createdAt: string;
  pushedAt: string | null;
  approvals: number;
  approvalsRequired: number;
  changesRequested: number;
  counts: { created: number; amended: number; repealed: number };
};

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  pending: "Waiting for approvals",
  pushed: "Pushed to the wiki",
  closed: "Closed",
  superseded: "Replaced",
};

export const RUN_STATUS_TONE: Record<RunStatus, "amber" | "green" | "red" | "neutral"> = {
  pending: "amber",
  pushed: "green",
  closed: "red",
  superseded: "neutral",
};
