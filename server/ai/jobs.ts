import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  aiFindings,
  aiJobs,
  candidates,
  documents,
  elections,
  meetingItems,
  meetings,
  users,
  votes,
  wikiRevisions,
  wikiRules,
  wikiSections,
  type AiJob,
} from "@shared/schema";
import { logActivity } from "../activity";
import { askClaude, describeAiError } from "./client";
import { renderPositionsContext, renderWikiContext } from "./context";
import {
  APPLY_ELECTION_SYSTEM,
  BUILD_WIKI_SYSTEM,
  PROCESS_MEETING_SYSTEM,
} from "./prompts";
import {
  applyElectionResult,
  buildWikiResult,
  processMeetingResult,
  type WikiOperation,
} from "./schemas";
import { applyOperations, saveFindings, savePositions, slugify } from "./apply";

/**
 * Jobs run in-process, detached from the request that started them, and report
 * progress through the `ai_jobs` table. The admin Status page polls that table,
 * which is what "see what the AI is waiting on" means in practice.
 *
 * A single Node process is the right call here: an academy runs at most a
 * handful of these a week, and a real queue would be infrastructure nobody
 * asked for. The tradeoff is that a job in flight during a restart is lost -
 * `recoverStuckJobs` marks those failed on boot so they never hang forever.
 */

async function updateJob(id: number, patch: Partial<AiJob>) {
  await db.update(aiJobs).set(patch).where(eq(aiJobs.id, id));
}

export async function createJob(opts: {
  academyId: number;
  kind: "build_wiki" | "process_meeting" | "apply_election";
  requestedBy: number | null;
  meetingId?: number | null;
  electionId?: number | null;
  input?: Record<string, unknown>;
  message: string;
}): Promise<AiJob> {
  const [job] = await db
    .insert(aiJobs)
    .values({
      academyId: opts.academyId,
      kind: opts.kind,
      status: "queued",
      message: opts.message,
      requestedBy: opts.requestedBy,
      meetingId: opts.meetingId ?? null,
      electionId: opts.electionId ?? null,
      input: opts.input ?? null,
    })
    .returning();
  return job;
}

/** Marks jobs that were mid-flight when the process died. Called on boot. */
export async function recoverStuckJobs() {
  const stuck = await db
    .update(aiJobs)
    .set({
      status: "failed",
      error: "The server restarted while this job was running. Nothing was written to the wiki - run it again.",
      finishedAt: new Date(),
    })
    .where(inArray(aiJobs.status, ["queued", "running"]))
    .returning({ id: aiJobs.id });
  if (stuck.length > 0) {
    console.log(`[ai] marked ${stuck.length} interrupted job(s) as failed`);
  }
}

function runDetached(job: AiJob, work: () => Promise<void>) {
  void (async () => {
    try {
      await updateJob(job.id, { status: "running", startedAt: new Date(), progress: 5 });
      await work();
    } catch (error) {
      const message = describeAiError(error);
      console.error(`[ai] job ${job.id} (${job.kind}) failed:`, error);
      await updateJob(job.id, {
        status: "failed",
        error: message,
        finishedAt: new Date(),
        progress: 100,
      });
      await logActivity({
        academyId: job.academyId,
        actorType: "ai",
        actorLabel: "Eagle Bot AI",
        action: `ai.${job.kind}.failed`,
        entityType: "ai_job",
        entityId: job.id,
        summary: `AI job failed: ${message}`,
      });
    }
  })();
}

/* -------------------------------------------------------------------------- */
/*  build_wiki                                                                 */
/* -------------------------------------------------------------------------- */

export function startBuildWiki(job: AiJob) {
  runDetached(job, async () => {
    const docs = await db
      .select()
      .from(documents)
      .where(eq(documents.academyId, job.academyId))
      .orderBy(asc(documents.id));

    if (docs.length === 0) {
      throw new Error("There are no documents to read. Upload something first.");
    }

    await updateJob(job.id, {
      message: `Reading ${docs.length} document${docs.length === 1 ? "" : "s"}...`,
      progress: 15,
    });

    const corpus = docs
      .map(
        (doc, i) =>
          `<document index="${i + 1}" filename="${doc.filename}" uploaded="${doc.createdAt.toISOString().slice(0, 10)}">\n${doc.content}\n</document>`,
      )
      .join("\n\n");

    const existingWiki = await renderWikiContext(job.academyId);
    const hasExisting = !existingWiki.includes("(The wiki is empty");

    const { data, usage } = await askClaude({
      system: BUILD_WIKI_SYSTEM,
      cachedContext: `# Uploaded documents\n\n${corpus}`,
      prompt: hasExisting
        ? `Build the wiki from the documents above.\n\nNote that a wiki already exists. Do not duplicate rules it already contains - focus on what the documents add, and raise findings where the documents and the existing wiki disagree.\n\n${existingWiki}`
        : "Build the wiki from the documents above. This studio has no wiki yet, so everything you produce is new.",
      schema: buildWikiResult,
      maxTokens: 48000,
      effort: "high",
      onProgress: (chars) => {
        const pct = Math.min(85, 20 + Math.floor(chars / 900));
        void updateJob(job.id, { progress: pct, message: "Claude is writing the wiki..." });
      },
    });

    await updateJob(job.id, { message: "Saving sections and rules...", progress: 88 });

    // Sections first, then rules pointing at them.
    const sectionKeyMap = new Map<string, number>();
    let order = 0;
    for (const spec of [...data.sections].sort((a, b) => a.orderIndex - b.orderIndex)) {
      const [section] = await db
        .insert(wikiSections)
        .values({
          academyId: job.academyId,
          title: spec.title,
          slug: `${slugify(spec.key || spec.title)}`,
          summary: spec.summary,
          orderIndex: order++,
        })
        .onConflictDoNothing()
        .returning();
      if (section) {
        sectionKeyMap.set(spec.key, section.id);
        sectionKeyMap.set(section.slug, section.id);
      } else {
        // Slug already existed - reuse it.
        const [existing] = await db
          .select()
          .from(wikiSections)
          .where(
            and(
              eq(wikiSections.academyId, job.academyId),
              eq(wikiSections.slug, slugify(spec.key || spec.title)),
            ),
          )
          .limit(1);
        if (existing) sectionKeyMap.set(spec.key, existing.id);
      }
    }

    const ruleKeyMap = new Map<string, number>();
    const perSectionOrder = new Map<number, number>();
    for (const spec of data.rules) {
      const sectionId = sectionKeyMap.get(spec.sectionKey);
      if (!sectionId) continue;
      const next = perSectionOrder.get(sectionId) ?? 0;
      perSectionOrder.set(sectionId, next + 1);
      const [rule] = await db
        .insert(wikiRules)
        .values({
          academyId: job.academyId,
          sectionId,
          title: spec.title,
          body: spec.body,
          status: "active",
          orderIndex: next,
          sourceType: "document",
          sourceRef: String(job.id),
          citation: spec.citation,
          effectiveFrom: new Date(),
          createdBy: job.requestedBy,
        })
        .returning();
      ruleKeyMap.set(spec.key, rule.id);
      await db.insert(wikiRevisions).values({
        academyId: job.academyId,
        ruleId: rule.id,
        changeType: "created",
        titleAfter: rule.title,
        bodyAfter: rule.body,
        rationale: `Imported from ${spec.citation}`,
        actorUserId: job.requestedBy,
        actorType: "ai",
        sourceType: "document",
        sourceRef: String(job.id),
        jobId: job.id,
      });
    }

    const positionsAdded = await savePositions({
      academyId: job.academyId,
      positions: data.positions,
      sourceType: "document",
      sourceRef: String(job.id),
    });

    const findingsAdded = await saveFindings({
      academyId: job.academyId,
      findings: data.findings,
      sourceType: "document",
      sourceRef: String(job.id),
      jobId: job.id,
      ruleKeyMap,
    });

    await db
      .update(documents)
      .set({ status: "included" })
      .where(eq(documents.academyId, job.academyId));

    const openFindings = data.findings.length;
    await updateJob(job.id, {
      status: openFindings > 0 ? "awaiting_input" : "succeeded",
      awaitingReason:
        openFindings > 0
          ? `${openFindings} thing${openFindings === 1 ? "" : "s"} need a human decision before the wiki is trustworthy.`
          : null,
      message: `Wrote ${data.rules.length} rules across ${data.sections.length} sections.`,
      progress: 100,
      finishedAt: new Date(),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      result: {
        overview: data.overview,
        sections: data.sections.length,
        rules: data.rules.length,
        positions: positionsAdded,
        findings: findingsAdded,
      },
    });

    await logActivity({
      academyId: job.academyId,
      actorUserId: job.requestedBy,
      actorType: "ai",
      actorLabel: "Eagle Bot AI",
      action: "wiki.built",
      entityType: "ai_job",
      entityId: job.id,
      summary: `Built the wiki from ${docs.length} document${docs.length === 1 ? "" : "s"}: ${data.rules.length} rules, ${data.sections.length} sections, ${findingsAdded} thing${findingsAdded === 1 ? "" : "s"} flagged.`,
      metadata: { rules: data.rules.length, findings: findingsAdded },
    });
  });
}

/* -------------------------------------------------------------------------- */
/*  process_meeting                                                            */
/* -------------------------------------------------------------------------- */

export function startProcessMeeting(job: AiJob, meetingId: number) {
  runDetached(job, async () => {
    const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId)).limit(1);
    if (!meeting) throw new Error("That meeting no longer exists.");

    const items = await db
      .select()
      .from(meetingItems)
      .where(eq(meetingItems.meetingId, meetingId))
      .orderBy(asc(meetingItems.orderIndex), asc(meetingItems.id));

    if (items.length === 0 && !meeting.notes.trim()) {
      throw new Error("This meeting has no notes yet - there's nothing to process.");
    }

    await updateJob(job.id, { message: "Reading the meeting notes...", progress: 15 });

    const roster = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.academyId, job.academyId));
    const nameById = new Map(roster.map((u) => [u.id, u.name]));

    const notesText = [
      `# Town Hall: ${meeting.title}`,
      `Date: ${meeting.meetingDate.toISOString().slice(0, 10)}`,
      meeting.secretaryId ? `Secretary: ${nameById.get(meeting.secretaryId) ?? "unknown"}` : "",
      `Attendance: ${(meeting.attendance ?? []).length} present`,
      meeting.quorumNote ? `Quorum note: ${meeting.quorumNote}` : "",
      "",
      "## Items",
      "",
      ...items.map((item) => {
        const lines = [`### [${item.type}] ${item.title}`];
        if (item.body.trim()) lines.push(item.body.trim());
        if (item.outcome) {
          const tally =
            item.votesFor !== null || item.votesAgainst !== null
              ? ` (for ${item.votesFor ?? 0}, against ${item.votesAgainst ?? 0}, abstain ${item.votesAbstain ?? 0})`
              : "";
          lines.push(`**Outcome: ${item.outcome}**${tally}`);
        }
        if (item.assignedTo) lines.push(`Assigned to: ${nameById.get(item.assignedTo) ?? "unknown"}`);
        if (item.dueDate) lines.push(`Due: ${item.dueDate.toISOString().slice(0, 10)}`);
        return lines.join("\n");
      }),
      "",
      meeting.notes.trim() ? `## Running notes\n\n${meeting.notes.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const wikiContext = await renderWikiContext(job.academyId);
    const positionsContext = await renderPositionsContext(job.academyId);

    const { data, usage } = await askClaude({
      system: PROCESS_MEETING_SYSTEM,
      cachedContext: `${wikiContext}\n\n${positionsContext}`,
      prompt: `Here are the notes from the Town Hall that just finished. Update the wiki to match what was decided.\n\n${notesText}`,
      schema: processMeetingResult,
      maxTokens: 32000,
      effort: "high",
      onProgress: (chars) => {
        const pct = Math.min(85, 25 + Math.floor(chars / 500));
        void updateJob(job.id, { progress: pct, message: "Claude is updating the wiki..." });
      },
    });

    await updateJob(job.id, { message: "Applying changes to the wiki...", progress: 90 });

    const outcome = await applyOperations({
      academyId: job.academyId,
      operations: data.operations as WikiOperation[],
      actorUserId: job.requestedBy,
      actorType: "ai",
      sourceType: "town_hall",
      sourceRef: String(meetingId),
      jobId: job.id,
    });

    const positionsAdded = await savePositions({
      academyId: job.academyId,
      positions: data.newPositions,
      sourceType: "town_hall",
      sourceRef: String(meetingId),
    });

    await saveFindings({
      academyId: job.academyId,
      findings: data.findings,
      sourceType: "town_hall",
      sourceRef: String(meetingId),
      jobId: job.id,
    });

    // Proposed elections are never created automatically - the studio decides.
    const needsDecision =
      data.proposedElections.length > 0 ||
      data.unresolvedQuestions.length > 0 ||
      outcome.skipped.length > 0;

    await db
      .update(meetings)
      .set({ status: "processed", processedAt: new Date(), lastJobId: job.id })
      .where(eq(meetings.id, meetingId));

    await updateJob(job.id, {
      status: needsDecision ? "awaiting_input" : "succeeded",
      awaitingReason: needsDecision
        ? [
            data.proposedElections.length > 0
              ? `${data.proposedElections.length} election${data.proposedElections.length === 1 ? "" : "s"} to approve or skip`
              : null,
            data.unresolvedQuestions.length > 0
              ? `${data.unresolvedQuestions.length} question${data.unresolvedQuestions.length === 1 ? "" : "s"} for the secretary`
              : null,
            outcome.skipped.length > 0 ? `${outcome.skipped.length} operation(s) couldn't be applied` : null,
          ]
            .filter(Boolean)
            .join("; ")
        : null,
      message: `${outcome.created} added, ${outcome.amended} amended, ${outcome.repealed} repealed.`,
      progress: 100,
      finishedAt: new Date(),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      result: {
        summary: data.summary,
        ...outcome,
        positionsAdded,
        proposedElections: data.proposedElections,
        unresolvedQuestions: data.unresolvedQuestions,
      },
    });

    await logActivity({
      academyId: job.academyId,
      actorUserId: job.requestedBy,
      actorType: "ai",
      actorLabel: "Eagle Bot AI",
      action: "townhall.processed",
      entityType: "meeting",
      entityId: meetingId,
      summary: `Processed "${meeting.title}": ${outcome.created} rules added, ${outcome.amended} amended, ${outcome.repealed} repealed.`,
      metadata: { jobId: job.id, ...outcome },
    });
  });
}

/* -------------------------------------------------------------------------- */
/*  apply_election                                                             */
/* -------------------------------------------------------------------------- */

export function startApplyElection(job: AiJob, electionId: number) {
  runDetached(job, async () => {
    const [election] = await db.select().from(elections).where(eq(elections.id, electionId)).limit(1);
    if (!election) throw new Error("That election no longer exists.");

    const options = await db
      .select()
      .from(candidates)
      .where(eq(candidates.electionId, electionId))
      .orderBy(asc(candidates.orderIndex));

    const tally = await db
      .select({ candidateId: votes.candidateId, count: sql<number>`count(*)::int` })
      .from(votes)
      .where(eq(votes.electionId, electionId))
      .groupBy(votes.candidateId);

    const countById = new Map(tally.map((row) => [row.candidateId, row.count]));
    const results = options
      .map((option) => ({ label: option.label, votes: countById.get(option.id) ?? 0 }))
      .sort((a, b) => b.votes - a.votes);

    const winner = results[0];
    const passed = winner ? /^(yes|for|approve|in favou?r|pass)/i.test(winner.label) : false;

    await updateJob(job.id, { message: "Recording the outcome in the wiki...", progress: 25 });

    const wikiContext = await renderWikiContext(job.academyId);

    const { data, usage } = await askClaude({
      system: APPLY_ELECTION_SYSTEM,
      cachedContext: wikiContext,
      prompt: [
        `A rule election has closed and been certified.`,
        ``,
        `**Title:** ${election.title}`,
        election.description ? `**Description:** ${election.description}` : "",
        ``,
        `**The proposal that was voted on:**`,
        election.proposalBody ?? "(no text recorded)",
        ``,
        `**Results:**`,
        ...results.map((r) => `- ${r.label}: ${r.votes} vote${r.votes === 1 ? "" : "s"}`),
        ``,
        `The winning option was "${winner?.label ?? "none"}", which means the proposal ${passed ? "PASSED" : "did NOT pass"}.`,
        ``,
        `Update the wiki accordingly.`,
      ]
        .filter((line) => line !== undefined)
        .join("\n"),
      schema: applyElectionResult,
      maxTokens: 16000,
      effort: "high",
    });

    const outcome = await applyOperations({
      academyId: job.academyId,
      operations: data.operations as WikiOperation[],
      actorUserId: job.requestedBy,
      actorType: "ai",
      sourceType: "election",
      sourceRef: String(electionId),
      jobId: job.id,
    });

    await saveFindings({
      academyId: job.academyId,
      findings: data.findings,
      sourceType: "election",
      sourceRef: String(electionId),
      jobId: job.id,
    });

    await updateJob(job.id, {
      status: "succeeded",
      message: `${outcome.created} added, ${outcome.amended} amended, ${outcome.repealed} repealed.`,
      progress: 100,
      finishedAt: new Date(),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      result: { summary: data.summary, passed, results, ...outcome },
    });

    await logActivity({
      academyId: job.academyId,
      actorUserId: job.requestedBy,
      actorType: "ai",
      actorLabel: "Eagle Bot AI",
      action: "election.applied",
      entityType: "election",
      entityId: electionId,
      summary: `Recorded the outcome of "${election.title}" in the wiki (${passed ? "passed" : "did not pass"}).`,
      metadata: { jobId: job.id },
    });
  });
}

/* -------------------------------------------------------------------------- */
/*  Status feed for the admin page                                             */
/* -------------------------------------------------------------------------- */

export async function getStatusSnapshot(academyId: number) {
  const jobs = await db
    .select()
    .from(aiJobs)
    .where(eq(aiJobs.academyId, academyId))
    .orderBy(desc(aiJobs.id))
    .limit(20);

  const liveMeetings = await db
    .select()
    .from(meetings)
    .where(and(eq(meetings.academyId, academyId), inArray(meetings.status, ["draft", "in_progress", "processing"])))
    .orderBy(desc(meetings.meetingDate));

  const openElections = await db
    .select()
    .from(elections)
    .where(and(eq(elections.academyId, academyId), inArray(elections.status, ["draft", "open", "closed"])))
    .orderBy(desc(elections.id));

  const findingRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiFindings)
    .where(and(eq(aiFindings.academyId, academyId), eq(aiFindings.status, "open")));

  return {
    jobs,
    activeMeetings: liveMeetings,
    openElections,
    openFindings: findingRows[0]?.count ?? 0,
    aiBusy: jobs.some((job) => job.status === "running" || job.status === "queued"),
    awaiting: jobs.filter((job) => job.status === "awaiting_input"),
  };
}
