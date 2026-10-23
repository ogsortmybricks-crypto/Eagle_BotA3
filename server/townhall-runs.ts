/**
 * Town Hall runs: processed meetings waiting to be pushed into the Contract.
 *
 * It works like a pull request. The AI's changes are saved as a run; people
 * in the studio review it and approve it or ask for changes; once it has
 * enough approvals and nobody is still asking for changes, the Secretary
 * pushes it, and only then does the wiki change. The Secretary who submitted
 * a run can't approve their own. A run whose rules changed underneath it
 * can't be pushed: the meeting has to be processed again against the Contract
 * as it is now.
 */

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import {
  aiJobs,
  meetingRunReviews,
  meetingRuns,
  meetings,
  users,
  wikiRules,
  wikiSections,
  type AiJob,
  type MeetingRun,
  type RunVerdict,
  type User,
} from "@shared/schema";
import type { AcademySettings } from "@shared/settings";
import { applyOperations, saveFindings, savePositions } from "./ai/apply";
import { notifyRunPushed } from "./ai/jobs";
import type { ProcessMeetingResult, WikiOperation } from "./ai/schemas";
import { logActivity } from "./activity";
import { canReadStudio, type StudioScope } from "./studio";

export class RunError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/* -------------------------------------------------------------------------- */
/*  Making a run                                                               */
/* -------------------------------------------------------------------------- */

/** The studio's most recent pushed run: the head of its main line. */
async function headRun(academyId: number, studioId: number | null): Promise<MeetingRun | null> {
  const [head] = await db
    .select()
    .from(meetingRuns)
    .where(
      and(
        eq(meetingRuns.academyId, academyId),
        studioId === null ? isNull(meetingRuns.studioId) : eq(meetingRuns.studioId, studioId),
        eq(meetingRuns.status, "pushed"),
      ),
    )
    .orderBy(desc(meetingRuns.pushedAt), desc(meetingRuns.id))
    .limit(1);
  return head ?? null;
}

/**
 * Saves what the AI produced for a meeting as a run waiting for review. Any
 * earlier run of the same meeting still waiting is replaced by this one.
 */
export async function createRun(options: {
  job: AiJob;
  meetingId: number;
  data: ProcessMeetingResult;
  settings: AcademySettings;
}): Promise<MeetingRun> {
  const { job, data, settings } = options;
  const head = await headRun(job.academyId, job.studioId);
  return db.transaction(async (tx) => {
    const earlier = await tx
      .update(meetingRuns)
      .set({ status: "superseded", closedAt: new Date() })
      .where(and(eq(meetingRuns.meetingId, options.meetingId), eq(meetingRuns.status, "pending")))
      .returning({ id: meetingRuns.id });
    const [run] = await tx
      .insert(meetingRuns)
      .values({
        academyId: job.academyId,
        studioId: job.studioId,
        meetingId: options.meetingId,
        jobId: job.id,
        submittedBy: job.requestedBy,
        baseRunId: head?.id ?? null,
        replacesRunId: earlier[0]?.id ?? null,
        status: "pending",
        approvalsRequired: Math.max(3, settings.townHall.approvalsRequired ?? 3),
        summary: data.summary,
        operations: data.operations,
        findings: data.findings,
        newPositions: settings.ai.detectPositions ? data.newPositions : [],
        proposedElections: settings.ai.proposeElections ? data.proposedElections : [],
        unresolvedQuestions: data.unresolvedQuestions,
      })
      .returning();
    return run;
  });
}

/* -------------------------------------------------------------------------- */
/*  Reading a run                                                              */
/* -------------------------------------------------------------------------- */

export type RunChange = {
  op: WikiOperation["op"];
  title: string;
  /** The rule as it is now, for amend / repeal / move. */
  before: string | null;
  /** The rule as the run would leave it, for create / amend. */
  after: string | null;
  section: string | null;
  rationale: string;
  /** The rule changed after this run was made, so it can't be pushed as it is. */
  stale: boolean;
};

export type RunReviewView = {
  userId: number;
  name: string;
  verdict: RunVerdict;
  comment: string | null;
  at: string;
};

export type RunView = {
  id: number;
  meetingId: number;
  meetingTitle: string;
  status: MeetingRun["status"];
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
  reviews: RunReviewView[];
  changes: RunChange[];
  proposedElections: unknown[];
  unresolvedQuestions: string[];
  newPositions: unknown[];
  outcome: Record<string, unknown> | null;
  /** Something it changes moved on since it was made: process the meeting again. */
  stale: boolean;
  /** Another run was pushed since this one was made. */
  behind: boolean;
  /** What the person looking may do now, and why not. */
  you: {
    canReview: boolean;
    reviewBlockedReason: string | null;
    verdict: RunVerdict | null;
    /** They're someone who pushes runs (the Secretary, or anyone who can process Town Halls). */
    pusher: boolean;
    canPush: boolean;
    pushBlockedReason: string | null;
    canClose: boolean;
  };
};

async function names(academyId: number): Promise<Map<number, string>> {
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.academyId, academyId));
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** Each operation as a before/after a reviewer can read, and whether it's gone stale. */
async function changesOf(run: MeetingRun): Promise<RunChange[]> {
  const operations = run.operations as WikiOperation[];
  const ruleIds = operations.flatMap((op) => ("ruleId" in op ? [op.ruleId] : []));
  const rules = ruleIds.length
    ? await db
        .select({ rule: wikiRules, section: wikiSections.title, sectionSlug: wikiSections.slug })
        .from(wikiRules)
        .innerJoin(wikiSections, eq(wikiSections.id, wikiRules.sectionId))
        .where(and(eq(wikiRules.academyId, run.academyId), inArray(wikiRules.id, ruleIds)))
    : [];
  const byId = new Map(rules.map((row) => [row.rule.id, row]));
  const sections = await db
    .select({ slug: wikiSections.slug, title: wikiSections.title })
    .from(wikiSections)
    .where(eq(wikiSections.academyId, run.academyId));
  const sectionTitle = new Map(sections.map((section) => [section.slug, section.title]));
  const newSections = new Map(
    operations.flatMap((op) => (op.op === "create_section" ? [[op.key, op.title] as const] : [])),
  );
  const changed = (ruleId: number) => {
    const row = byId.get(ruleId);
    return !row || row.rule.updatedAt > run.createdAt;
  };

  return operations.map((op): RunChange => {
    switch (op.op) {
      case "create_section":
        return { op: op.op, title: op.title, before: null, after: op.summary || null, section: null, rationale: op.rationale, stale: false };
      case "create_rule":
        return {
          op: op.op,
          title: op.title,
          before: null,
          after: op.body,
          section: newSections.get(op.sectionKey) ?? sectionTitle.get(op.sectionKey) ?? op.sectionKey,
          rationale: op.rationale,
          stale: false,
        };
      case "amend_rule": {
        const row = byId.get(op.ruleId);
        return {
          op: op.op,
          title: op.title,
          before: row ? `${row.rule.title}\n\n${row.rule.body}` : null,
          after: `${op.title}\n\n${op.body}`,
          section: row?.section ?? null,
          rationale: op.rationale,
          stale: changed(op.ruleId),
        };
      }
      case "repeal_rule": {
        const row = byId.get(op.ruleId);
        return {
          op: op.op,
          title: row?.rule.title ?? `Rule #${op.ruleId}`,
          before: row ? row.rule.body : null,
          after: null,
          section: row?.section ?? null,
          rationale: op.rationale,
          stale: changed(op.ruleId),
        };
      }
      case "move_rule": {
        const row = byId.get(op.ruleId);
        return {
          op: op.op,
          title: row?.rule.title ?? `Rule #${op.ruleId}`,
          before: row?.section ?? null,
          after: newSections.get(op.sectionKey) ?? sectionTitle.get(op.sectionKey) ?? op.sectionKey,
          section: row?.section ?? null,
          rationale: op.rationale,
          stale: changed(op.ruleId),
        };
      }
    }
  });
}

export async function loadRun(academyId: number, runId: number): Promise<MeetingRun | null> {
  const [run] = await db
    .select()
    .from(meetingRuns)
    .where(and(eq(meetingRuns.id, runId), eq(meetingRuns.academyId, academyId)))
    .limit(1);
  return run ?? null;
}

/** Whether this person may review a run, and if not, why. */
function reviewBlock(run: MeetingRun, user: User, scope: StudioScope): string | null {
  if (run.status !== "pending") return "This run isn't waiting for review any more.";
  if (run.submittedBy === user.id) return "You submitted this run, so someone else has to check it.";
  if (!canReadStudio(scope, run.studioId)) return "Only people in this studio can review its Town Halls.";
  return null;
}

export async function runView(run: MeetingRun, user: User, scope: StudioScope, canProcess: boolean): Promise<RunView> {
  const [people, reviews, changes, [meeting], head] = await Promise.all([
    names(run.academyId),
    db.select().from(meetingRunReviews).where(eq(meetingRunReviews.runId, run.id)).orderBy(asc(meetingRunReviews.createdAt)),
    changesOf(run),
    db.select({ title: meetings.title }).from(meetings).where(eq(meetings.id, run.meetingId)).limit(1),
    headRun(run.academyId, run.studioId),
  ]);
  const approvals = reviews.filter((review) => review.verdict === "approve").length;
  const changesRequested = reviews.filter((review) => review.verdict === "changes").length;
  const stale = run.status === "pending" && changes.some((change) => change.stale);
  const mine = reviews.find((review) => review.userId === user.id);
  const reviewBlocked = reviewBlock(run, user, scope);

  let pushBlocked: string | null = null;
  if (run.status !== "pending") pushBlocked = "This run isn't waiting to be pushed.";
  else if (!canProcess) pushBlocked = "Only the Secretary (or someone who can process Town Halls) pushes runs.";
  else if (stale) pushBlocked = "Rules this run changes were edited after it was made. Process the meeting again.";
  else if (changesRequested > 0) pushBlocked = `${changesRequested} reviewer${changesRequested === 1 ? " is" : "s are"} still asking for changes.`;
  else if (approvals < run.approvalsRequired) {
    pushBlocked = `It needs ${run.approvalsRequired - approvals} more approval${run.approvalsRequired - approvals === 1 ? "" : "s"}.`;
  }

  return {
    id: run.id,
    meetingId: run.meetingId,
    meetingTitle: meeting?.title ?? "A Town Hall",
    status: run.status,
    summary: run.summary,
    submittedBy: run.submittedBy ? { id: run.submittedBy, name: people.get(run.submittedBy) ?? "Someone" } : null,
    createdAt: run.createdAt.toISOString(),
    pushedAt: run.pushedAt?.toISOString() ?? null,
    closedAt: run.closedAt?.toISOString() ?? null,
    closeNote: run.closeNote,
    baseRunId: run.baseRunId,
    replacesRunId: run.replacesRunId,
    approvalsRequired: run.approvalsRequired,
    approvals,
    changesRequested,
    reviews: reviews.map((review) => ({
      userId: review.userId,
      name: people.get(review.userId) ?? "Someone",
      verdict: review.verdict,
      comment: review.comment,
      at: review.updatedAt.toISOString(),
    })),
    changes,
    proposedElections: run.proposedElections,
    unresolvedQuestions: run.unresolvedQuestions,
    newPositions: run.newPositions,
    outcome: run.outcome ?? null,
    stale,
    behind: run.status === "pending" && (head?.id ?? null) !== run.baseRunId,
    you: {
      canReview: reviewBlocked === null,
      reviewBlockedReason: reviewBlocked,
      verdict: mine?.verdict ?? null,
      pusher: canProcess,
      canPush: pushBlocked === null,
      pushBlockedReason: pushBlocked,
      canClose: run.status === "pending" && (canProcess || run.submittedBy === user.id),
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Reviewing, pushing, closing                                                */
/* -------------------------------------------------------------------------- */

export async function reviewRun(options: {
  run: MeetingRun;
  user: User;
  scope: StudioScope;
  verdict: RunVerdict;
  comment: string | null;
}): Promise<void> {
  const { run, user } = options;
  const blocked = reviewBlock(run, user, options.scope);
  if (blocked) throw new RunError(403, blocked);
  if (options.verdict === "changes" && !options.comment?.trim()) {
    throw new RunError(400, "Say what needs changing, so the Secretary can fix it.");
  }
  await db
    .insert(meetingRunReviews)
    .values({
      academyId: run.academyId,
      runId: run.id,
      userId: user.id,
      verdict: options.verdict,
      comment: options.comment?.trim() || null,
    })
    .onConflictDoUpdate({
      target: [meetingRunReviews.runId, meetingRunReviews.userId],
      set: { verdict: options.verdict, comment: options.comment?.trim() || null, updatedAt: new Date() },
    });
  await logActivity({
    academyId: run.academyId,
    studioId: run.studioId,
    actorUserId: user.id,
    action: options.verdict === "approve" ? "townhall.run.approved" : "townhall.run.changes_requested",
    entityType: "meeting",
    entityId: run.meetingId,
    summary:
      options.verdict === "approve"
        ? `${user.name} approved a processed Town Hall.`
        : `${user.name} asked for changes to a processed Town Hall.`,
    metadata: { runId: run.id },
  });
}

export async function closeRun(options: { run: MeetingRun; user: User; canProcess: boolean; note: string | null }): Promise<void> {
  const { run, user } = options;
  if (run.status !== "pending") throw new RunError(409, "This run isn't waiting any more.");
  if (!options.canProcess && run.submittedBy !== user.id) {
    throw new RunError(403, "Only the Secretary who submitted it, or someone who can process Town Halls, can close a run.");
  }
  await db
    .update(meetingRuns)
    .set({ status: "closed", closedAt: new Date(), closedBy: user.id, closeNote: options.note?.trim() || null })
    .where(and(eq(meetingRuns.id, run.id), eq(meetingRuns.status, "pending")));
  await db
    .update(meetings)
    .set({ status: "in_progress" })
    .where(and(eq(meetings.id, run.meetingId), eq(meetings.status, "in_review")));
}

/**
 * Pushes an approved run into the wiki: applies its operations, adds the
 * positions and findings it found, and marks the meeting processed. The
 * status flips first, in one statement, so two people pressing Push at once
 * can't apply it twice.
 */
export async function pushRun(options: {
  run: MeetingRun;
  user: User;
  scope: StudioScope;
  canProcess: boolean;
  settings: AcademySettings;
}): Promise<{ created: number; amended: number; repealed: number; skipped: string[] }> {
  const { run, user } = options;
  const view = await runView(run, user, options.scope, options.canProcess);
  if (!view.you.canPush) throw new RunError(409, view.you.pushBlockedReason ?? "This run can't be pushed.");

  const [claimed] = await db
    .update(meetingRuns)
    .set({ status: "pushed", pushedAt: new Date(), pushedBy: user.id })
    .where(and(eq(meetingRuns.id, run.id), eq(meetingRuns.status, "pending")))
    .returning();
  if (!claimed) throw new RunError(409, "Someone else pushed or closed this run a moment ago.");

  let outcome;
  try {
    outcome = await applyOperations({
      academyId: run.academyId,
      studioId: run.studioId,
      operations: run.operations as WikiOperation[],
      // The person who pushed is who changed the Contract; the AI only drafted it.
      actorUserId: user.id,
      actorType: "user",
      sourceType: "town_hall",
      sourceRef: String(run.meetingId),
      jobId: run.jobId,
    });
  } catch (error) {
    await db.update(meetingRuns).set({ status: "pending", pushedAt: null, pushedBy: null }).where(eq(meetingRuns.id, run.id));
    throw error;
  }

  const positionsAdded = run.newPositions.length
    ? await savePositions({
        academyId: run.academyId,
        studioId: run.studioId,
        positions: run.newPositions as Parameters<typeof savePositions>[0]["positions"],
        sourceType: "town_hall",
        sourceRef: String(run.meetingId),
      })
    : 0;
  await saveFindings({
    academyId: run.academyId,
    studioId: run.studioId,
    findings: run.findings as Parameters<typeof saveFindings>[0]["findings"],
    sourceType: "town_hall",
    sourceRef: String(run.meetingId),
    jobId: run.jobId,
  });

  const result = { ...outcome, positionsAdded };
  await db.update(meetingRuns).set({ outcome: result }).where(eq(meetingRuns.id, run.id));
  await db
    .update(meetings)
    .set({ status: "processed", processedAt: new Date(), lastJobId: run.jobId })
    .where(eq(meetings.id, run.meetingId));

  // The job's result is what the meeting's "What the AI did" panel shows.
  if (run.jobId) {
    const needsDecision = run.proposedElections.length > 0 || run.unresolvedQuestions.length > 0 || outcome.skipped.length > 0;
    const [job] = await db.select().from(aiJobs).where(eq(aiJobs.id, run.jobId)).limit(1);
    await db
      .update(aiJobs)
      .set({
        status: needsDecision ? "awaiting_input" : "succeeded",
        awaitingReason: needsDecision
          ? [
              run.proposedElections.length ? `${run.proposedElections.length} election(s) to approve or skip` : null,
              run.unresolvedQuestions.length ? `${run.unresolvedQuestions.length} question(s) for the secretary` : null,
              outcome.skipped.length ? `${outcome.skipped.length} operation(s) couldn't be applied` : null,
            ]
              .filter(Boolean)
              .join("; ")
          : null,
        message: `${outcome.created} added, ${outcome.amended} amended, ${outcome.repealed} repealed.`,
        result: {
          ...((job?.result as Record<string, unknown> | null) ?? {}),
          summary: run.summary,
          ...outcome,
          positionsAdded,
          proposedElections: run.proposedElections,
          unresolvedQuestions: run.unresolvedQuestions,
          runId: run.id,
          pending: false,
        },
      })
      .where(eq(aiJobs.id, run.jobId));
  }

  const [meeting] = await db.select({ title: meetings.title }).from(meetings).where(eq(meetings.id, run.meetingId)).limit(1);
  await logActivity({
    academyId: run.academyId,
    studioId: run.studioId,
    actorUserId: user.id,
    action: "townhall.processed",
    entityType: "meeting",
    entityId: run.meetingId,
    summary: `${user.name} pushed "${meeting?.title ?? "a Town Hall"}" into the Contract after ${view.approvals} approvals: ${outcome.created} added, ${outcome.amended} amended, ${outcome.repealed} repealed.`,
    metadata: { runId: run.id, jobId: run.jobId, approvals: view.approvals, ...outcome },
  });
  if (run.jobId) {
    void notifyRunPushed(
      run.jobId,
      meeting?.title ?? "A Town Hall",
      run.summary,
      `${outcome.created} added, ${outcome.amended} amended, ${outcome.repealed} repealed.`,
    ).catch((error) => console.error("[townhall] pushed-run email failed", error));
  }
  return outcome;
}

/* -------------------------------------------------------------------------- */
/*  The graph                                                                  */
/* -------------------------------------------------------------------------- */

export type GraphNode = {
  id: number;
  meetingId: number;
  meetingTitle: string;
  status: MeetingRun["status"];
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

/** Every run for one studio's Contract (or the academy-wide one), newest first. */
export async function studioGraph(academyId: number, studioId: number | null, limit = 100): Promise<GraphNode[]> {
  const runs = await db
    .select({ run: meetingRuns, meetingTitle: meetings.title })
    .from(meetingRuns)
    .innerJoin(meetings, eq(meetings.id, meetingRuns.meetingId))
    .where(
      and(
        eq(meetingRuns.academyId, academyId),
        studioId === null ? isNull(meetingRuns.studioId) : eq(meetingRuns.studioId, studioId),
      ),
    )
    .orderBy(desc(meetingRuns.createdAt), desc(meetingRuns.id))
    .limit(limit);
  if (runs.length === 0) return [];
  const tallies = await db
    .select({
      runId: meetingRunReviews.runId,
      approvals: sql<number>`count(*) filter (where ${meetingRunReviews.verdict} = 'approve')`,
      changes: sql<number>`count(*) filter (where ${meetingRunReviews.verdict} = 'changes')`,
    })
    .from(meetingRunReviews)
    .where(inArray(meetingRunReviews.runId, runs.map((row) => row.run.id)))
    .groupBy(meetingRunReviews.runId);
  const people = await names(academyId);
  return runs.map(({ run, meetingTitle }) => {
    const tally = tallies.find((entry) => entry.runId === run.id);
    const operations = run.operations as WikiOperation[];
    return {
      id: run.id,
      meetingId: run.meetingId,
      meetingTitle,
      status: run.status,
      baseRunId: run.baseRunId,
      replacesRunId: run.replacesRunId,
      submittedBy: run.submittedBy ? (people.get(run.submittedBy) ?? null) : null,
      createdAt: run.createdAt.toISOString(),
      pushedAt: run.pushedAt?.toISOString() ?? null,
      approvals: Number(tally?.approvals ?? 0),
      approvalsRequired: run.approvalsRequired,
      changesRequested: Number(tally?.changes ?? 0),
      counts: {
        created: operations.filter((op) => op.op === "create_rule").length,
        amended: operations.filter((op) => op.op === "amend_rule").length,
        repealed: operations.filter((op) => op.op === "repeal_rule").length,
      },
    };
  });
}
