import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  academies,
  aiFindings,
  aiJobs,
  candidates,
  type FindingProposal,
  documents,
  elections,
  meetingItems,
  meetings,
  studios,
  users,
  votes,
  wikiRevisions,
  wikiRules,
  wikiSections,
  type AiJob,
} from "@shared/schema";
import { logActivity } from "../activity";
import { askClaude, describeAiError } from "./client";
import {
  loadStudio,
  loadStudioGroup,
  renderPositionsContext,
  renderStudioContext,
  renderWikiContext,
} from "./context";
import { buildSystemPrompt, type PromptOptions } from "./prompts";
import {
  applyElectionResult,
  buildWikiResult,
  processMeetingResult,
  proposeResolutionsResult,
  resolveFindingResult,
  type WikiOperation,
} from "./schemas";
import {
  applyOperations,
  saveFindings,
  savePositions,
  slugify,
  type ApplyOutcome,
} from "./apply";
import { effectiveForStudio, studioCircle, studioFilter, type StudioScope } from "../studio";
import { resolveSettings, type AcademySettings } from "@shared/settings";
import { meetingProcessedEmail, sendMail } from "../mailer";
import { env } from "../env";

/**
 * Jobs run in-process, detached from the request that started them, and report
 * progress through the `ai_jobs` table. The admin Status page polls that table,
 * which is what "see what the AI is waiting on" means in practice.
 *
 * Every job carries a studio. That is the boundary the AI works inside: it
 * reads that studio's documents and wiki, and writes back only there. A single
 * Node process is the right call for the queue itself - an academy runs at most
 * a handful of these a week - with `recoverStuckJobs` cleaning up after a
 * restart so a job in flight never hangs forever.
 */

async function updateJob(id: number, patch: Partial<AiJob>) {
  await db.update(aiJobs).set(patch).where(eq(aiJobs.id, id));
}

export async function createJob(opts: {
  academyId: number;
  studioId: number | null;
  kind: "build_wiki" | "process_meeting" | "apply_election" | "propose_resolutions" | "resolve_finding";
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
      studioId: opts.studioId,
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
      error:
        "The server restarted while this job was running. Nothing was written to the wiki - run it again.",
      finishedAt: new Date(),
    })
    .where(inArray(aiJobs.status, ["queued", "running"]))
    .returning({ id: aiJobs.id });
  if (stuck.length > 0) {
    console.log(`[ai] marked ${stuck.length} interrupted job(s) as failed`);
  }

  // A fix that was being drafted when the process died will never arrive.
  await db
    .update(aiFindings)
    .set({
      proposalState: "failed",
      proposalError: "The server restarted while this fix was being written. Ask for it again.",
    })
    .where(eq(aiFindings.proposalState, "drafting"));
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
        studioId: job.studioId,
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

/**
 * Loads everything a run needs about the academy and the studio it's for:
 * settings, the studio row, and the prompt options those imply.
 */
async function runContext(job: AiJob): Promise<{
  settings: AcademySettings;
  academyName: string;
  accent: string;
  studioName: string | null;
  promptOptions: PromptOptions;
  maxTokens: number;
  effort: AcademySettings["ai"]["effort"];
}> {
  const [academy] = await db.select().from(academies).where(eq(academies.id, job.academyId)).limit(1);
  const settings = resolveSettings(academy?.settings);
  const studio = await loadStudio(job.studioId);
  const effective = await effectiveForStudio(job.studioId, settings);

  return {
    settings,
    academyName: academy?.name ?? "the academy",
    accent: academy?.palette.accent ?? "#0284c7",
    studioName: studio?.name ?? null,
    promptOptions: {
      studioContext: renderStudioContext(
        studio,
        academy?.learnerNoun ?? "Hero",
        await loadStudioGroup(studio),
      ),
      extraGuidance: effective.aiGuidance,
      autoRepealContradictions: settings.ai.autoRepealContradictions,
      proposeElections: settings.ai.proposeElections,
      detectPositions: settings.ai.detectPositions,
    },
    maxTokens: settings.ai.maxOutputTokens,
    effort: settings.ai.effort,
  };
}

/* -------------------------------------------------------------------------- */
/*  build_wiki                                                                 */
/* -------------------------------------------------------------------------- */

export function startBuildWiki(job: AiJob) {
  runDetached(job, async () => {
    const context = await runContext(job);

    // This studio's documents (its group's, if it has one), plus anything
    // filed against the whole academy.
    const studioCondition =
      job.studioId === null
        ? undefined
        : or(inArray(documents.studioId, await studioCircle(job.studioId)), isNull(documents.studioId));
    const docs = await db
      .select()
      .from(documents)
      .where(
        studioCondition
          ? and(eq(documents.academyId, job.academyId), studioCondition)
          : eq(documents.academyId, job.academyId),
      )
      .orderBy(asc(documents.id));

    if (docs.length === 0) {
      throw new Error("There are no documents to read for this studio. Upload something first.");
    }

    await updateJob(job.id, {
      message: `Reading ${docs.length} document${docs.length === 1 ? "" : "s"}...`,
      progress: 15,
    });

    const corpus = docs
      .map(
        (doc, i) =>
          `<document index="${i + 1}" filename="${doc.filename}" uploaded="${doc.createdAt.toISOString().slice(0, 10)}"${
            doc.studioId === null ? ' scope="academy-wide"' : ""
          }>\n${doc.content}\n</document>`,
      )
      .join("\n\n");

    const existingWiki = await renderWikiContext(job.academyId, job.studioId);
    const hasExisting = !existingWiki.includes("has no wiki yet");

    const { data, usage } = await askClaude({
      system: buildSystemPrompt("build_wiki", context.promptOptions),
      cachedContext: `# Uploaded documents\n\n${corpus}`,
      prompt: hasExisting
        ? `Build this studio's wiki from the documents above.\n\nNote that a wiki already exists for this studio. Do not duplicate rules it already contains - focus on what the documents add, and raise findings where the documents and the existing wiki disagree.\n\n${existingWiki}`
        : "Build this studio's wiki from the documents above. It has no wiki yet, so everything you produce is new.",
      schema: buildWikiResult,
      maxTokens: context.maxTokens,
      effort: context.effort,
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
          studioId: job.studioId,
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

    const positionsAdded = context.settings.ai.detectPositions
      ? await savePositions({
          academyId: job.academyId,
          studioId: job.studioId,
          positions: data.positions,
          sourceType: "document",
          sourceRef: String(job.id),
        })
      : 0;

    const findingIds = await saveFindings({
      academyId: job.academyId,
      studioId: job.studioId,
      findings: data.findings,
      sourceType: "document",
      sourceRef: String(job.id),
      jobId: job.id,
      ruleKeyMap,
    });
    const findingsAdded = findingIds.length;

    // Only the documents this run actually read get marked as included.
    await db
      .update(documents)
      .set({ status: "included" })
      .where(
        inArray(
          documents.id,
          docs.map((doc) => doc.id),
        ),
      );

    const openFindings = data.findings.length;
    const where = context.studioName ?? "the academy";
    await updateJob(job.id, {
      status: openFindings > 0 ? "awaiting_input" : "succeeded",
      awaitingReason:
        openFindings > 0
          ? `${openFindings} thing${openFindings === 1 ? "" : "s"} need a human decision before ${where}'s wiki is trustworthy. The AI is drafting a fix for each one to approve or change.`
          : null,
      message: `Wrote ${data.rules.length} rules across ${data.sections.length} sections for ${where}.`,
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
        studio: context.studioName,
      },
    });

    await logActivity({
      academyId: job.academyId,
      studioId: job.studioId,
      actorUserId: job.requestedBy,
      actorType: "ai",
      actorLabel: "Eagle Bot AI",
      action: "wiki.built",
      entityType: "ai_job",
      entityId: job.id,
      summary: `Built ${where}'s wiki from ${docs.length} document${docs.length === 1 ? "" : "s"}: ${data.rules.length} rules, ${data.sections.length} sections, ${findingsAdded} thing${findingsAdded === 1 ? "" : "s"} flagged.`,
      metadata: { rules: data.rules.length, findings: findingsAdded },
    });

    // Flagging a problem is half the job. Now that the rules have real ids,
    // draft a fix for each one for the studio to approve or change. The wiki
    // is already saved, so a failure here must not mark the build as failed.
    try {
      await queueProposals({
        academyId: job.academyId,
        studioId: job.studioId,
        requestedBy: job.requestedBy,
        findingIds,
      });
    } catch (error) {
      console.error(`[ai] couldn't queue fixes after build ${job.id}`, error);
    }
  });
}

/* -------------------------------------------------------------------------- */
/*  propose_resolutions                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Starts drafting fixes for these findings. Marks them `drafting` straight
 * away, so the Wiki shows the work happening rather than an empty card.
 */
export async function queueProposals(opts: {
  academyId: number;
  studioId: number | null;
  requestedBy: number | null;
  findingIds: number[];
}): Promise<AiJob | null> {
  if (opts.findingIds.length === 0) return null;

  await db
    .update(aiFindings)
    .set({ proposalState: "drafting", proposalError: null })
    .where(inArray(aiFindings.id, opts.findingIds));

  const job = await createJob({
    academyId: opts.academyId,
    studioId: opts.studioId,
    kind: "propose_resolutions",
    requestedBy: opts.requestedBy,
    input: { findingIds: opts.findingIds },
    message: `Drafting fixes for ${opts.findingIds.length} flagged problem${opts.findingIds.length === 1 ? "" : "s"}`,
  });
  startProposeResolutions(job, opts.findingIds);
  return job;
}

/** Findings rendered for Claude, with the ids its answer has to use. */
function renderFindings(rows: (typeof aiFindings.$inferSelect)[]): string {
  return [
    "# Findings to settle",
    "",
    ...rows.map((finding) =>
      [
        `## [findingId: ${finding.id}] ${finding.title}`,
        `Type: ${finding.type}. Severity: ${finding.severity}.`,
        (finding.relatedRuleIds ?? []).length > 0
          ? `Related rules: ${(finding.relatedRuleIds ?? []).map((id) => `ruleId ${id}`).join(", ")}`
          : "",
        "",
        finding.description,
        (finding.options ?? []).length > 0
          ? `\nWays you suggested it could be settled:\n${(finding.options ?? []).map((option) => `- ${option}`).join("\n")}`
          : "",
        finding.proposal?.author === "ai" && finding.proposal.summary
          ? `\nYour last draft, which the studio asked you to redo: ${finding.proposal.summary}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ].join("\n\n");
}

function startProposeResolutions(job: AiJob, findingIds: number[]) {
  runDetached(job, async () => {
    try {
      const context = await runContext(job);
      const rows = await db
        .select()
        .from(aiFindings)
        .where(and(inArray(aiFindings.id, findingIds), eq(aiFindings.status, "open")))
        .orderBy(asc(aiFindings.id));
      if (rows.length === 0) {
        await updateJob(job.id, {
          status: "succeeded",
          message: "Every problem was settled before a fix was needed.",
          progress: 100,
          finishedAt: new Date(),
        });
        return;
      }

      await updateJob(job.id, { message: "Reading the wiki and the flagged problems...", progress: 15 });
      const wikiContext = await renderWikiContext(job.academyId, job.studioId);

      const { data, usage } = await askClaude({
        system: buildSystemPrompt("propose_resolutions", context.promptOptions),
        cachedContext: wikiContext,
        prompt: `Draft a fix for each of these${context.studioName ? ` in ${context.studioName}` : ""}.\n\n${renderFindings(rows)}`,
        schema: proposeResolutionsResult,
        maxTokens: context.maxTokens,
        effort: context.effort,
        onProgress: (chars) => {
          const pct = Math.min(90, 20 + Math.floor(chars / 300));
          void updateJob(job.id, { progress: pct, message: "Claude is drafting fixes..." });
        },
      });

      let drafted = 0;
      for (const finding of rows) {
        const resolution = data.resolutions.find((entry) => entry.findingId === finding.id);
        await db
          .update(aiFindings)
          .set(
            resolution
              ? {
                  proposal: {
                    summary: resolution.summary,
                    operations: resolution.operations as FindingProposal["operations"],
                    author: "ai",
                    request: null,
                  },
                  proposalState: "ready",
                  proposalError: null,
                }
              : {
                  proposalState: "failed",
                  proposalError: "The AI didn't come up with a fix for this one. Say what you want instead.",
                },
          )
          .where(eq(aiFindings.id, finding.id));
        if (resolution) drafted += 1;
      }

      await updateJob(job.id, {
        status: "succeeded",
        message: `Drafted ${drafted} fix${drafted === 1 ? "" : "es"} to approve or change.`,
        progress: 100,
        finishedAt: new Date(),
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        result: { drafted, findings: rows.length, studio: context.studioName },
      });
    } catch (error) {
      await db
        .update(aiFindings)
        .set({ proposalState: "failed", proposalError: describeAiError(error) })
        .where(and(inArray(aiFindings.id, findingIds), eq(aiFindings.proposalState, "drafting")));
      throw error;
    }
  });
}

/* -------------------------------------------------------------------------- */
/*  resolve_finding                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Carries out a person's own decision on a finding: the AI writes it up as
 * wiki edits and they are applied straight away, because the decision has
 * already been made - by them. Undo is on the Wiki page if the write-up is
 * wrong.
 */
export function startResolveFinding(job: AiJob, findingId: number, request: string, actor: { id: number; name: string }) {
  runDetached(job, async () => {
    try {
      const context = await runContext(job);
      const [finding] = await db.select().from(aiFindings).where(eq(aiFindings.id, findingId)).limit(1);
      if (!finding || finding.status !== "open") {
        throw new Error("That problem was settled while your change was being written up.");
      }

      await updateJob(job.id, { message: "Writing up your decision...", progress: 20 });
      const wikiContext = await renderWikiContext(job.academyId, job.studioId);

      const { data, usage } = await askClaude({
        system: buildSystemPrompt("resolve_finding", context.promptOptions),
        cachedContext: wikiContext,
        prompt: [
          renderFindings([finding]),
          "",
          `# How ${actor.name} wants it settled`,
          "",
          request,
        ].join("\n"),
        schema: resolveFindingResult,
        maxTokens: context.maxTokens,
        effort: context.effort,
      });

      if (data.unclear.trim() && data.operations.length === 0) {
        // Nothing was written, so the finding stays open with the question on it.
        await db
          .update(aiFindings)
          .set({
            proposalState: "failed",
            proposalError: `The AI needs more to go on: ${data.unclear.trim()}`,
          })
          .where(eq(aiFindings.id, findingId));
        await updateJob(job.id, {
          status: "succeeded",
          message: "Needs more detail before the wiki can change.",
          progress: 100,
          finishedAt: new Date(),
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        });
        return;
      }

      const proposal: FindingProposal = {
        summary: data.summary,
        operations: data.operations as FindingProposal["operations"],
        author: "human",
        request,
      };
      const outcome = await settleFinding({
        finding: { ...finding, proposal },
        actorUserId: actor.id,
        actorName: actor.name,
        note: request,
      });

      await updateJob(job.id, {
        status: "succeeded",
        message: `Settled: ${outcome.created} added, ${outcome.amended} amended, ${outcome.repealed} repealed.`,
        progress: 100,
        finishedAt: new Date(),
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        result: { findingId, ...outcome, studio: context.studioName },
      });
    } catch (error) {
      await db
        .update(aiFindings)
        .set({ proposalState: "failed", proposalError: describeAiError(error) })
        .where(and(eq(aiFindings.id, findingId), eq(aiFindings.proposalState, "drafting")));
      throw error;
    }
  });
}

/**
 * Puts a finding's proposal into the wiki and marks the finding settled.
 *
 * The one place a fix is applied, whether someone approved the AI's draft or
 * wrote their own. Every edit is a revision sourced to the finding, which is
 * what lets the Wiki page undo exactly this fix and nothing else.
 */
export async function settleFinding(opts: {
  finding: typeof aiFindings.$inferSelect;
  actorUserId: number;
  actorName: string;
  note: string;
}): Promise<ApplyOutcome> {
  const { finding } = opts;
  const operations = (finding.proposal?.operations ?? []) as WikiOperation[];

  const outcome = await applyOperations({
    academyId: finding.academyId,
    studioId: finding.studioId,
    operations,
    // The person who approved it owns the change; the AI only drafted it.
    actorUserId: opts.actorUserId,
    actorType: finding.proposal?.author === "human" ? "user" : "ai",
    sourceType: "finding",
    sourceRef: String(finding.id),
    jobId: null,
  });

  await db
    .update(aiFindings)
    .set({
      status: "resolved",
      proposal: finding.proposal,
      proposalState: "ready",
      proposalError: null,
      resolutionNote: opts.note,
      resolvedBy: opts.actorUserId,
      resolvedAt: new Date(),
    })
    .where(eq(aiFindings.id, finding.id));

  const changed = outcome.created + outcome.amended + outcome.repealed + outcome.moved;
  await logActivity({
    academyId: finding.academyId,
    studioId: finding.studioId,
    actorUserId: opts.actorUserId,
    action: "finding.resolved",
    entityType: "ai_finding",
    entityId: finding.id,
    summary:
      finding.proposal?.author === "human"
        ? `${opts.actorName} settled "${finding.title}" their own way: ${changed} change${changed === 1 ? "" : "s"} to the wiki.`
        : `${opts.actorName} approved the fix for "${finding.title}": ${changed} change${changed === 1 ? "" : "s"} to the wiki.`,
    metadata: { ...outcome, author: finding.proposal?.author ?? null },
  });

  return outcome;
}

/* -------------------------------------------------------------------------- */
/*  process_meeting                                                            */
/* -------------------------------------------------------------------------- */

export function startProcessMeeting(job: AiJob, meetingId: number) {
  runDetached(job, async () => {
    const context = await runContext(job);

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
      context.studioName ? `Studio: ${context.studioName}` : "Scope: the whole academy",
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

    const wikiContext = await renderWikiContext(job.academyId, job.studioId);
    const positionsContext = await renderPositionsContext(job.academyId, job.studioId);

    const { data, usage } = await askClaude({
      system: buildSystemPrompt("process_meeting", context.promptOptions),
      cachedContext: `${wikiContext}\n\n${positionsContext}`,
      prompt: `Here are the notes from the Town Hall that just finished${
        context.studioName ? ` in ${context.studioName}` : ""
      }. Update the wiki to match what was decided.\n\n${notesText}`,
      schema: processMeetingResult,
      maxTokens: context.maxTokens,
      effort: context.effort,
      onProgress: (chars) => {
        const pct = Math.min(85, 25 + Math.floor(chars / 500));
        void updateJob(job.id, { progress: pct, message: "Claude is updating the wiki..." });
      },
    });

    await updateJob(job.id, { message: "Applying changes to the wiki...", progress: 90 });

    const outcome = await applyOperations({
      academyId: job.academyId,
      studioId: job.studioId,
      operations: data.operations as WikiOperation[],
      actorUserId: job.requestedBy,
      actorType: "ai",
      sourceType: "town_hall",
      sourceRef: String(meetingId),
      jobId: job.id,
    });

    const positionsAdded = context.settings.ai.detectPositions
      ? await savePositions({
          academyId: job.academyId,
          studioId: job.studioId,
          positions: data.newPositions,
          sourceType: "town_hall",
          sourceRef: String(meetingId),
        })
      : 0;

    await saveFindings({
      academyId: job.academyId,
      studioId: job.studioId,
      findings: data.findings,
      sourceType: "town_hall",
      sourceRef: String(meetingId),
      jobId: job.id,
    });

    // Proposed elections are never created automatically - the studio decides.
    const proposals = context.settings.ai.proposeElections ? data.proposedElections : [];
    const needsDecision =
      proposals.length > 0 || data.unresolvedQuestions.length > 0 || outcome.skipped.length > 0;

    await db
      .update(meetings)
      .set({ status: "processed", processedAt: new Date(), lastJobId: job.id })
      .where(eq(meetings.id, meetingId));

    const changeLine = `${outcome.created} added, ${outcome.amended} amended, ${outcome.repealed} repealed.`;

    await updateJob(job.id, {
      status: needsDecision ? "awaiting_input" : "succeeded",
      awaitingReason: needsDecision
        ? [
            proposals.length > 0
              ? `${proposals.length} election${proposals.length === 1 ? "" : "s"} to approve or skip`
              : null,
            data.unresolvedQuestions.length > 0
              ? `${data.unresolvedQuestions.length} question${data.unresolvedQuestions.length === 1 ? "" : "s"} for the secretary`
              : null,
            outcome.skipped.length > 0
              ? `${outcome.skipped.length} operation(s) couldn't be applied`
              : null,
          ]
            .filter(Boolean)
            .join("; ")
        : null,
      message: changeLine,
      progress: 100,
      finishedAt: new Date(),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      result: {
        summary: data.summary,
        ...outcome,
        positionsAdded,
        proposedElections: proposals,
        unresolvedQuestions: data.unresolvedQuestions,
        studio: context.studioName,
      },
    });

    if (context.settings.notifications.emailOnMeetingProcessed) {
      void notifyMeetingProcessed(job, meeting.title, data.summary, changeLine, context).catch(
        (error) => console.error("[ai] meeting-processed notify failed", error),
      );
    }

    await logActivity({
      academyId: job.academyId,
      studioId: job.studioId,
      actorUserId: job.requestedBy,
      actorType: "ai",
      actorLabel: "Eagle Bot AI",
      action: "townhall.processed",
      entityType: "meeting",
      entityId: meetingId,
      summary: `Processed "${meeting.title}": ${changeLine}`,
      metadata: { jobId: job.id, ...outcome },
    });
  });
}

/** Tells the studio its Contract moved. Only the studio that met, not everyone. */
async function notifyMeetingProcessed(
  job: AiJob,
  title: string,
  summary: string,
  changes: string,
  context: Awaited<ReturnType<typeof runContext>>,
) {
  const circle = await studioCircle(job.studioId);
  const recipients = (
    await db
      .select({ email: users.email, studioId: users.studioId })
      .from(users)
      .where(and(eq(users.academyId, job.academyId), eq(users.active, true)))
  ).filter((person) => job.studioId === null || circle.includes(person.studioId ?? -1));

  const mail = meetingProcessedEmail({
    academyName: context.academyName,
    studioName: context.studioName,
    accent: context.accent,
    title,
    summary,
    changes,
    link: `${env.appUrl}/town-hall/${job.meetingId}`,
  });

  for (const person of recipients) {
    await sendMail({ to: person.email, ...mail });
  }
}

/* -------------------------------------------------------------------------- */
/*  apply_election                                                             */
/* -------------------------------------------------------------------------- */

export function startApplyElection(job: AiJob, electionId: number) {
  runDetached(job, async () => {
    const context = await runContext(job);

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

    const wikiContext = await renderWikiContext(job.academyId, job.studioId);

    const { data, usage } = await askClaude({
      system: buildSystemPrompt("apply_election", context.promptOptions),
      cachedContext: wikiContext,
      prompt: [
        `A rule election has closed and been certified${context.studioName ? ` in ${context.studioName}` : ""}.`,
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
      maxTokens: context.maxTokens,
      effort: context.effort,
    });

    const outcome = await applyOperations({
      academyId: job.academyId,
      studioId: job.studioId,
      operations: data.operations as WikiOperation[],
      actorUserId: job.requestedBy,
      actorType: "ai",
      sourceType: "election",
      sourceRef: String(electionId),
      jobId: job.id,
    });

    await saveFindings({
      academyId: job.academyId,
      studioId: job.studioId,
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
      result: { summary: data.summary, passed, results, ...outcome, studio: context.studioName },
    });

    await logActivity({
      academyId: job.academyId,
      studioId: job.studioId,
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

export async function getStatusSnapshot(academyId: number, scope: StudioScope) {
  const jobFilter = studioFilter(aiJobs.studioId, scope);
  const jobs = await db
    .select({ job: aiJobs, studioName: studios.name })
    .from(aiJobs)
    .leftJoin(studios, eq(studios.id, aiJobs.studioId))
    .where(jobFilter ? and(eq(aiJobs.academyId, academyId), jobFilter) : eq(aiJobs.academyId, academyId))
    .orderBy(desc(aiJobs.id))
    .limit(20);

  const meetingFilter = studioFilter(meetings.studioId, scope);
  const liveMeetings = await db
    .select({ meeting: meetings, studioName: studios.name })
    .from(meetings)
    .leftJoin(studios, eq(studios.id, meetings.studioId))
    .where(
      and(
        eq(meetings.academyId, academyId),
        inArray(meetings.status, ["draft", "in_progress", "processing"]),
        meetingFilter ?? sql`true`,
      ),
    )
    .orderBy(desc(meetings.meetingDate));

  const electionFilter = studioFilter(elections.studioId, scope);
  const openElections = await db
    .select({ election: elections, studioName: studios.name })
    .from(elections)
    .leftJoin(studios, eq(studios.id, elections.studioId))
    .where(
      and(
        eq(elections.academyId, academyId),
        inArray(elections.status, ["draft", "open", "closed"]),
        electionFilter ?? sql`true`,
      ),
    )
    .orderBy(desc(elections.id));

  const findingFilter = studioFilter(aiFindings.studioId, scope);
  const findingRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiFindings)
    .where(
      and(
        eq(aiFindings.academyId, academyId),
        eq(aiFindings.status, "open"),
        findingFilter ?? sql`true`,
      ),
    );

  const flatJobs = jobs.map((row) => ({ ...row.job, studioName: row.studioName }));

  return {
    jobs: flatJobs,
    activeMeetings: liveMeetings.map((row) => ({ ...row.meeting, studioName: row.studioName })),
    openElections: openElections.map((row) => ({ ...row.election, studioName: row.studioName })),
    openFindings: findingRows[0]?.count ?? 0,
    aiBusy: flatJobs.some((job) => job.status === "running" || job.status === "queued"),
    awaiting: flatJobs.filter((job) => job.status === "awaiting_input"),
  };
}
