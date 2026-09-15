import { Router } from "express";
import { z } from "zod";
import { and, asc, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import {
  academies,
  aiJobs,
  candidates,
  elections,
  positionHolders,
  positions,
  studios,
  users,
  votes,
  type Election,
  type User,
} from "@shared/schema";
import { requireAuth, requirePermission } from "../auth";
import { logActivity } from "../activity";
import { createJob, startApplyElection } from "../ai/jobs";
import { aiConfigured } from "../env";
import { electionCertifiedEmail, electionOpenEmail, sendMail } from "../mailer";
import { env } from "../env";
import {
  canReadStudio,
  effectiveForStudio,
  requireScope,
  scoped,
  StudioChoiceError,
  writeStudioId,
} from "../studio";
import type { AcademySettings } from "@shared/settings";

export const electionsRouter = Router();

/* ----------------------------- who may vote ------------------------------- */

/**
 * Voting rules for one ballot, with that studio's overrides folded in.
 *
 * A Launchpad election is Launchpad's business. Spark doesn't vote in it, and
 * neither does a Guide unless the academy - or that particular studio - says
 * adults vote. The one deliberate exception is an admin with
 * `adminsVoteInAllStudios`, which exists for small academies where the same
 * handful of people really are in every room.
 */
const ballotRules = effectiveForStudio;

type VoteCheck = { ok: true } | { ok: false; reason: string };

function canVoteIn(
  user: Pick<User, "role" | "studioId">,
  settings: AcademySettings,
  effective: { guidesCanVote: boolean },
  electionStudioId: number | null,
  studioName: string | null,
): VoteCheck {
  if (user.role === "guide" && !effective.guidesCanVote) {
    return {
      ok: false,
      reason:
        "Guides don't vote in this studio - governance belongs to the learners. An admin can change that in Settings.",
    };
  }

  if (electionStudioId !== null && user.studioId !== electionStudioId) {
    if (user.role === "admin" && settings.governance.adminsVoteInAllStudios) return { ok: true };
    return {
      ok: false,
      reason: `This vote belongs to ${studioName ?? "another studio"}. You can follow it, but only that studio casts ballots.`,
    };
  }

  return { ok: true };
}

/** Everyone who could cast a ballot in this election. Drives the turnout figure. */
async function eligibleVoters(
  academyId: number,
  settings: AcademySettings,
  effective: { guidesCanVote: boolean },
  electionStudioId: number | null,
) {
  const roster = await db
    .select()
    .from(users)
    .where(and(eq(users.academyId, academyId), eq(users.active, true)));
  return roster.filter(
    (person) => canVoteIn(person, settings, effective, electionStudioId, null).ok,
  );
}

async function tallyFor(electionId: number) {
  const rows = await db
    .select({ candidateId: votes.candidateId, count: sql<number>`count(*)::int` })
    .from(votes)
    .where(eq(votes.electionId, electionId))
    .groupBy(votes.candidateId);
  return new Map(rows.map((row) => [row.candidateId, row.count]));
}

/**
 * Closes any open vote whose deadline has passed.
 *
 * Runs on read rather than on a timer: this app has no scheduler, and a vote
 * that says "closes Friday" but still accepts ballots on Saturday is worse
 * than a slightly lazy implementation.
 */
async function closeExpired(academyId: number, settings: AcademySettings) {
  if (!settings.elections.autoCloseOnDeadline) return;
  const expired = await db
    .update(elections)
    .set({ status: "closed" })
    .where(
      and(
        eq(elections.academyId, academyId),
        eq(elections.status, "open"),
        lt(elections.closesAt, new Date()),
      ),
    )
    .returning({ id: elections.id, title: elections.title, studioId: elections.studioId });

  for (const election of expired) {
    await logActivity({
      academyId,
      studioId: election.studioId,
      actorType: "system",
      actorLabel: "Eagle Bot",
      action: "election.closed",
      entityType: "election",
      entityId: election.id,
      summary: `"${election.title}" closed automatically at its deadline.`,
    });
  }
}

/* --------------------------------- list ----------------------------------- */

electionsRouter.get("/", requirePermission("elections.read"), async (req, res) => {
  const academyId = req.user!.academyId;
  const scope = requireScope(req);
  await closeExpired(academyId, req.settings!);

  const rows = await db
    .select({
      election: elections,
      positionTitle: positions.title,
      studioName: studios.name,
      studioColor: studios.color,
      candidateCount: sql<number>`(select count(*)::int from candidates where candidates.election_id = ${elections.id})`,
      voterCount: sql<number>`(select count(distinct voter_id)::int from votes where votes.election_id = ${elections.id})`,
      hasVoted: sql<boolean>`exists(select 1 from votes where votes.election_id = ${elections.id} and votes.voter_id = ${req.user!.id})`,
    })
    .from(elections)
    .leftJoin(positions, eq(positions.id, elections.positionId))
    .leftJoin(studios, eq(studios.id, elections.studioId))
    .where(scoped(eq(elections.academyId, academyId), elections.studioId, scope))
    .orderBy(desc(elections.id));

  // Whether this person votes depends on the ballot, so resolve it per row.
  const withEligibility = [];
  for (const row of rows) {
    const effective = await ballotRules(row.election.studioId, req.settings!);
    const check = canVoteIn(
      req.user!,
      req.settings!,
      effective,
      row.election.studioId,
      row.studioName,
    );
    withEligibility.push({ ...row, canVote: check.ok });
  }

  res.json({
    elections: withEligibility,
    /** True when this person can vote in at least one of the ballots shown. */
    canVote: withEligibility.some((row) => row.canVote),
  });
});

electionsRouter.get("/:id", requirePermission("elections.read"), async (req, res) => {
  const id = Number(req.params.id);
  const academyId = req.user!.academyId;
  const scope = requireScope(req);
  const settings = req.settings!;
  await closeExpired(academyId, settings);

  const [election] = await db
    .select()
    .from(elections)
    .where(and(eq(elections.id, id), eq(elections.academyId, academyId)))
    .limit(1);
  if (!election || !canReadStudio(scope, election.studioId)) {
    return res.status(404).json({ error: "That election doesn't exist." });
  }

  const [studio] = election.studioId
    ? await db.select().from(studios).where(eq(studios.id, election.studioId)).limit(1)
    : [null];

  const effective = await ballotRules(election.studioId, settings);
  const check = canVoteIn(req.user!, settings, effective, election.studioId, studio?.name ?? null);

  const options = await db
    .select({
      candidate: candidates,
      userName: users.name,
      userBio: users.bio,
      userAvatar: users.avatarUrl,
      userStudioId: users.studioId,
      userNga: users.nga,
    })
    .from(candidates)
    .leftJoin(users, eq(users.id, candidates.userId))
    .where(eq(candidates.electionId, id))
    .orderBy(asc(candidates.orderIndex), asc(candidates.id));

  // Past positions show under a candidate's name on the ballot - Acton cares
  // about track record, and this is the tool's version of that.
  const history = await db
    .select({
      userId: positionHolders.userId,
      title: positions.title,
      startedAt: positionHolders.startedAt,
      endedAt: positionHolders.endedAt,
    })
    .from(positionHolders)
    .innerJoin(positions, eq(positions.id, positionHolders.positionId))
    .where(eq(positionHolders.academyId, academyId));

  const myVotes = await db
    .select({ candidateId: votes.candidateId })
    .from(votes)
    .where(and(eq(votes.electionId, id), eq(votes.voterId, req.user!.id)));

  const closed = election.status === "closed" || election.status === "certified";
  const tally = closed || settings.elections.showLiveTallies ? await tallyFor(id) : null;

  const [{ voters }] = await db
    .select({ voters: sql<number>`count(distinct ${votes.voterId})::int` })
    .from(votes)
    .where(eq(votes.electionId, id));

  const eligible = await eligibleVoters(academyId, settings, effective, election.studioId);

  res.json({
    election,
    studio: studio ? { id: studio.id, name: studio.name, color: studio.color } : null,
    candidates: options.map((row) => ({
      ...row.candidate,
      userName: row.userName,
      userBio: row.userBio,
      userAvatar: row.userAvatar,
      userStudioId: row.userStudioId,
      userNga: row.userNga,
      pastPositions: history.filter((h) => h.userId === row.candidate.userId).map((h) => h.title),
      votes: tally ? (tally.get(row.candidate.id) ?? 0) : null,
    })),
    myVotes: myVotes.map((v) => v.candidateId),
    turnout: { voters, eligible: eligible.length },
    canVote: check.ok,
    voteBlockedReason: check.ok ? null : check.reason,
    rules: {
      allowVoteChanges: settings.elections.allowVoteChanges,
      showLiveTallies: settings.elections.showLiveTallies,
      quorumPercent: settings.elections.quorumPercent,
      minOptions: settings.elections.minOptions,
    },
  });
});

/* -------------------------------- create ---------------------------------- */

const createSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(2000).optional(),
  type: z.enum(["position", "rule"]),
  positionId: z.number().int().nullable().optional(),
  proposalBody: z.string().max(8000).nullable().optional(),
  seats: z.number().int().min(1).max(20).default(1),
  selfNomination: z.boolean().optional(),
  anonymous: z.boolean().optional(),
  closesAt: z.string().nullable().optional(),
  sourceMeetingId: z.number().int().nullable().optional(),
  /** Omit for the studio being viewed; null opens it to the whole academy. */
  studioId: z.number().int().nullable().optional(),
  /** For rule elections, defaults to Yes/No. */
  options: z.array(z.string().min(1).max(120)).optional(),
});

electionsRouter.post("/", requirePermission("elections.manage"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the form." });
  }
  const input = parsed.data;
  const academyId = req.user!.academyId;
  const scope = requireScope(req);
  const settings = req.settings!;

  if (input.type === "rule" && !input.proposalBody?.trim()) {
    return res.status(400).json({ error: "A rule vote needs the exact text people are voting on." });
  }

  let studioId: number | null;
  try {
    studioId = writeStudioId(scope, input.studioId);
  } catch (error) {
    if (error instanceof StudioChoiceError) {
      return res.status(400).json({ error: error.message, needsStudio: true });
    }
    throw error;
  }

  let seats = input.seats;
  if (input.type === "position" && input.positionId) {
    const [position] = await db
      .select()
      .from(positions)
      .where(and(eq(positions.id, input.positionId), eq(positions.academyId, academyId)))
      .limit(1);
    if (!position) return res.status(400).json({ error: "That position doesn't exist." });
    seats = position.seats;
    // The election has to belong to whoever owns the seat, or the wrong studio
    // ends up filling it.
    studioId = position.studioId;
  }

  const effective = await ballotRules(studioId, settings);

  // "Closes in a week" is the academy's default unless the caller said otherwise.
  const closesAt = input.closesAt
    ? new Date(input.closesAt)
    : new Date(Date.now() + effective.electionDurationDays * 24 * 60 * 60 * 1000);

  const [election] = await db
    .insert(elections)
    .values({
      academyId,
      studioId,
      title: input.title.trim(),
      description: input.description ?? null,
      type: input.type,
      positionId: input.type === "position" ? (input.positionId ?? null) : null,
      proposalBody: input.type === "rule" ? (input.proposalBody ?? null) : null,
      status: "draft",
      seats,
      selfNomination: input.selfNomination ?? effective.selfNomination,
      anonymous: input.anonymous ?? settings.elections.anonymousDefault,
      closesAt,
      createdBy: req.user!.id,
      createdByType: "user",
      sourceMeetingId: input.sourceMeetingId ?? null,
    })
    .returning();

  if (input.type === "rule") {
    const labels = input.options?.length ? input.options : ["Yes - adopt this", "No - reject this"];
    await db.insert(candidates).values(
      labels.map((label, index) => ({
        academyId,
        electionId: election.id,
        userId: null,
        label,
        orderIndex: index,
      })),
    );
  }

  await logActivity({
    academyId,
    studioId,
    actorUserId: req.user!.id,
    action: "election.created",
    entityType: "election",
    entityId: election.id,
    summary: `${req.user!.name} created the ${input.type} vote "${election.title}".`,
  });

  res.status(201).json({ election });
});

/* ------------------------------- candidates -------------------------------- */

electionsRouter.post("/:id/candidates", requireAuth, async (req, res) => {
  const parsed = z
    .object({
      userId: z.number().int().nullable().optional(),
      label: z.string().min(1).max(160).optional(),
      statement: z.string().max(2000).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Couldn't add that." });

  const id = Number(req.params.id);
  const academyId = req.user!.academyId;
  const scope = requireScope(req);

  const [election] = await db
    .select()
    .from(elections)
    .where(and(eq(elections.id, id), eq(elections.academyId, academyId)))
    .limit(1);
  if (!election || !canReadStudio(scope, election.studioId)) {
    return res.status(404).json({ error: "That election doesn't exist." });
  }
  if (election.status !== "draft" && election.status !== "open") {
    return res.status(409).json({ error: "Nominations are closed for this vote." });
  }

  const isSelf = !parsed.data.userId || parsed.data.userId === req.user!.id;
  const isManager = req.user!.role === "admin" || req.user!.role === "secretary";
  if (!isSelf && !isManager) {
    return res.status(403).json({ error: "You can only nominate yourself." });
  }
  if (isSelf && !election.selfNomination && !isManager) {
    return res.status(403).json({ error: "Self-nomination is turned off for this vote." });
  }

  const userId = parsed.data.userId ?? req.user!.id;
  const [candidateUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!candidateUser || candidateUser.academyId !== academyId) {
    return res.status(400).json({ error: "That person isn't in this academy." });
  }

  // You run for your own studio's positions. Elsewhere you're a spectator.
  if (
    req.settings!.governance.restrictCandidatesToStudio &&
    election.studioId !== null &&
    candidateUser.studioId !== election.studioId
  ) {
    const [studio] = await db.select().from(studios).where(eq(studios.id, election.studioId)).limit(1);
    return res.status(403).json({
      error: `This ballot belongs to ${studio?.name ?? "another studio"}. Only its members can stand for it.`,
    });
  }

  const [duplicate] = await db
    .select()
    .from(candidates)
    .where(and(eq(candidates.electionId, id), eq(candidates.userId, userId)))
    .limit(1);
  if (duplicate) return res.status(409).json({ error: "They're already on the ballot." });

  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${candidates.orderIndex}), -1)` })
    .from(candidates)
    .where(eq(candidates.electionId, id));

  const [candidate] = await db
    .insert(candidates)
    .values({
      academyId,
      electionId: id,
      userId,
      label: parsed.data.label ?? candidateUser.name,
      statement: parsed.data.statement ?? null,
      orderIndex: (max ?? -1) + 1,
    })
    .returning();

  await logActivity({
    academyId,
    studioId: election.studioId,
    actorUserId: req.user!.id,
    action: "election.nomination",
    entityType: "election",
    entityId: id,
    summary: `${candidateUser.name} is on the ballot for "${election.title}".`,
  });

  res.status(201).json({ candidate });
});

electionsRouter.delete("/:id/candidates/:candidateId", requireAuth, async (req, res) => {
  const [candidate] = await db
    .select()
    .from(candidates)
    .where(
      and(
        eq(candidates.id, Number(req.params.candidateId)),
        eq(candidates.academyId, req.user!.academyId),
      ),
    )
    .limit(1);
  if (!candidate) return res.status(404).json({ error: "Not found." });

  const isManager = req.user!.role === "admin" || req.user!.role === "secretary";
  if (candidate.userId !== req.user!.id && !isManager) {
    return res.status(403).json({ error: "You can only withdraw yourself." });
  }

  await db.delete(candidates).where(eq(candidates.id, candidate.id));
  res.json({ ok: true });
});

/* --------------------------------- status ---------------------------------- */

electionsRouter.post("/:id/status", requirePermission("elections.manage"), async (req, res) => {
  const parsed = z
    .object({ status: z.enum(["draft", "open", "closed", "cancelled"]) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Unknown status." });

  const id = Number(req.params.id);
  const academyId = req.user!.academyId;
  const scope = requireScope(req);
  const settings = req.settings!;

  const [election] = await db
    .select()
    .from(elections)
    .where(and(eq(elections.id, id), eq(elections.academyId, academyId)))
    .limit(1);
  if (!election || !canReadStudio(scope, election.studioId)) {
    return res.status(404).json({ error: "That election doesn't exist." });
  }

  if (parsed.data.status === "open") {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(candidates)
      .where(eq(candidates.electionId, id));
    const minimum = settings.elections.minOptions;
    if (count < minimum) {
      return res.status(400).json({
        error: `A vote needs at least ${minimum} options on the ballot before it can open. There ${count === 1 ? "is" : "are"} ${count}.`,
      });
    }
  }

  const [updated] = await db
    .update(elections)
    .set({
      status: parsed.data.status,
      opensAt: parsed.data.status === "open" ? new Date() : election.opensAt,
    })
    .where(eq(elections.id, id))
    .returning();

  await logActivity({
    academyId,
    studioId: election.studioId,
    actorUserId: req.user!.id,
    action: `election.${parsed.data.status}`,
    entityType: "election",
    entityId: id,
    summary: `${req.user!.name} set "${election.title}" to ${parsed.data.status}.`,
  });

  // Opening a vote mails the studio that votes in it - not the whole academy.
  if (parsed.data.status === "open" && settings.notifications.emailOnElectionOpen) {
    void notifyVoters(academyId, updated, settings).catch((error) =>
      console.error("[elections] notify failed", error),
    );
  }

  res.json({ election: updated });
});

async function notifyVoters(academyId: number, election: Election, settings: AcademySettings) {
  const [academy] = await db.select().from(academies).where(eq(academies.id, academyId)).limit(1);
  if (!academy) return;

  const [studio] = election.studioId
    ? await db.select().from(studios).where(eq(studios.id, election.studioId)).limit(1)
    : [null];

  const effective = await ballotRules(election.studioId, settings);
  const recipients = await eligibleVoters(academyId, settings, effective, election.studioId);

  const mail = electionOpenEmail({
    academyName: academy.name,
    studioName: studio?.name ?? null,
    accent: academy.palette.accent,
    title: election.title,
    closesAt: election.closesAt ? election.closesAt.toDateString() : null,
    link: `${env.appUrl}/elections/${election.id}`,
  });

  for (const person of recipients) {
    await sendMail({ to: person.email, ...mail });
  }
}

/* ---------------------------------- vote ----------------------------------- */

electionsRouter.post("/:id/vote", requireAuth, async (req, res) => {
  const parsed = z.object({ candidateIds: z.array(z.number().int()).min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Pick at least one option." });

  const id = Number(req.params.id);
  const academyId = req.user!.academyId;
  const settings = req.settings!;
  const scope = requireScope(req);

  const [election] = await db
    .select()
    .from(elections)
    .where(and(eq(elections.id, id), eq(elections.academyId, academyId)))
    .limit(1);
  if (!election || !canReadStudio(scope, election.studioId)) {
    return res.status(404).json({ error: "That election doesn't exist." });
  }

  const [studio] = election.studioId
    ? await db.select().from(studios).where(eq(studios.id, election.studioId)).limit(1)
    : [null];
  const effective = await ballotRules(election.studioId, settings);
  const check = canVoteIn(req.user!, settings, effective, election.studioId, studio?.name ?? null);
  if (!check.ok) return res.status(403).json({ error: check.reason });

  if (election.status !== "open") return res.status(409).json({ error: "This vote isn't open." });
  if (election.closesAt && election.closesAt < new Date()) {
    return res.status(409).json({ error: "Voting has closed." });
  }
  if (parsed.data.candidateIds.length > election.seats) {
    return res.status(400).json({
      error: `You can pick at most ${election.seats} option${election.seats === 1 ? "" : "s"}.`,
    });
  }

  const existing = await db
    .select({ id: votes.id })
    .from(votes)
    .where(and(eq(votes.electionId, id), eq(votes.voterId, req.user!.id)));
  if (existing.length > 0 && !settings.elections.allowVoteChanges) {
    return res.status(409).json({
      error: "You've already voted, and this academy doesn't allow changing a ballot once it's cast.",
    });
  }

  const ballot = await db.select().from(candidates).where(eq(candidates.electionId, id));
  const valid = new Set(ballot.map((c) => c.id));
  if (!parsed.data.candidateIds.every((cid) => valid.has(cid))) {
    return res.status(400).json({ error: "That isn't a valid option on this ballot." });
  }

  // Re-voting replaces the previous ballot rather than stacking on it.
  await db.delete(votes).where(and(eq(votes.electionId, id), eq(votes.voterId, req.user!.id)));
  await db.insert(votes).values(
    parsed.data.candidateIds.map((candidateId) => ({
      academyId,
      electionId: id,
      voterId: req.user!.id,
      candidateId,
    })),
  );

  await logActivity({
    academyId,
    studioId: election.studioId,
    actorUserId: req.user!.id,
    action: "election.vote.cast",
    entityType: "election",
    entityId: id,
    // Deliberately does not record which way they voted.
    summary: `${req.user!.name} voted in "${election.title}".`,
  });

  res.json({ ok: true });
});

/* -------------------------------- certify ---------------------------------- */

electionsRouter.post("/:id/certify", requirePermission("elections.manage"), async (req, res) => {
  const id = Number(req.params.id);
  const academyId = req.user!.academyId;
  const scope = requireScope(req);
  const settings = req.settings!;

  const [election] = await db
    .select()
    .from(elections)
    .where(and(eq(elections.id, id), eq(elections.academyId, academyId)))
    .limit(1);
  if (!election || !canReadStudio(scope, election.studioId)) {
    return res.status(404).json({ error: "That election doesn't exist." });
  }
  if (election.status === "certified") {
    return res.status(409).json({ error: "This vote was already certified." });
  }
  if (election.status !== "closed") {
    return res.status(409).json({ error: "Close the vote before certifying it." });
  }

  const effective = await ballotRules(election.studioId, settings);

  // A result nobody turned out for isn't a mandate, and an academy can say so.
  if (settings.elections.quorumPercent > 0) {
    const eligible = await eligibleVoters(academyId, settings, effective, election.studioId);
    const [{ voters }] = await db
      .select({ voters: sql<number>`count(distinct ${votes.voterId})::int` })
      .from(votes)
      .where(eq(votes.electionId, id));
    const needed = Math.ceil((eligible.length * settings.elections.quorumPercent) / 100);
    if (voters < needed && !req.body?.overrideQuorum) {
      return res.status(409).json({
        error: `Only ${voters} of ${eligible.length} eligible voters took part, and this academy needs ${needed} (${settings.elections.quorumPercent}%) to certify a result.`,
        quorumShort: true,
        turnout: { voters, eligible: eligible.length, needed },
      });
    }
  }

  const ballot = await db
    .select()
    .from(candidates)
    .where(eq(candidates.electionId, id))
    .orderBy(asc(candidates.orderIndex));
  const tally = await tallyFor(id);

  const ranked = ballot
    .map((candidate) => ({
      candidateId: candidate.id,
      userId: candidate.userId,
      label: candidate.label,
      votes: tally.get(candidate.id) ?? 0,
    }))
    .sort((a, b) => b.votes - a.votes);

  // A tie at the cut line is a real thing that happens in a studio of 30, and
  // silently picking one is exactly the kind of thing that erodes trust.
  const cutoff = ranked[election.seats - 1];
  const tied =
    cutoff !== undefined &&
    ranked.filter((row) => row.votes === cutoff.votes).length >
      ranked.filter((row) => row.votes === cutoff.votes && ranked.indexOf(row) < election.seats).length;

  if (tied && !req.body?.tieBreakCandidateIds) {
    return res.status(409).json({
      error: "There's a tie at the cut line. The studio needs to break it before this can be certified.",
      tie: true,
      results: ranked,
    });
  }

  const winnerIds: number[] = req.body?.tieBreakCandidateIds
    ? (req.body.tieBreakCandidateIds as number[])
    : ranked.slice(0, election.seats).map((row) => row.candidateId);

  const winners = ranked.filter((row) => winnerIds.includes(row.candidateId));

  const [updated] = await db
    .update(elections)
    .set({
      status: "certified",
      certifiedAt: new Date(),
      results: { ranked, winners, certifiedBy: req.user!.name },
    })
    .where(eq(elections.id, id))
    .returning();

  if (settings.notifications.emailOnElectionCertified) {
    void notifyCertified(academyId, updated, winners, settings).catch((error) =>
      console.error("[elections] certify notify failed", error),
    );
  }

  // A position vote seats the winners immediately and retires whoever held it.
  if (election.type === "position" && election.positionId) {
    await db
      .update(positionHolders)
      .set({ endedAt: new Date(), note: `Term ended by "${election.title}".` })
      .where(
        and(eq(positionHolders.positionId, election.positionId), isNull(positionHolders.endedAt)),
      );

    const seated = winners.filter((winner) => winner.userId !== null);
    if (seated.length > 0) {
      await db.insert(positionHolders).values(
        seated.map((winner) => ({
          academyId,
          positionId: election.positionId!,
          userId: winner.userId!,
          electionId: id,
          note: `Elected in "${election.title}" with ${winner.votes} vote${winner.votes === 1 ? "" : "s"}.`,
        })),
      );
    }

    await logActivity({
      academyId,
      studioId: election.studioId,
      actorUserId: req.user!.id,
      action: "election.certified",
      entityType: "election",
      entityId: id,
      summary: `"${election.title}" certified. ${seated.map((w) => w.label).join(", ") || "No one"} seated.`,
      metadata: { ranked },
    });

    return res.json({ election: updated, winners, jobId: null });
  }

  // A rule vote goes back to the AI so the wiki reflects the outcome.
  let jobId: number | null = null;
  if (election.type === "rule" && aiConfigured && settings.ai.enabled) {
    const job = await createJob({
      academyId,
      studioId: election.studioId,
      kind: "apply_election",
      requestedBy: req.user!.id,
      electionId: id,
      message: "Queued",
    });
    jobId = job.id;
    startApplyElection(job, id);
  }

  await logActivity({
    academyId,
    studioId: election.studioId,
    actorUserId: req.user!.id,
    action: "election.certified",
    entityType: "election",
    entityId: id,
    summary: `"${election.title}" certified. Winner: ${winners[0]?.label ?? "none"}.`,
    metadata: { ranked },
  });

  res.json({ election: updated, winners, jobId });
});

async function notifyCertified(
  academyId: number,
  election: Election,
  winners: { label: string; votes: number }[],
  settings: AcademySettings,
) {
  const [academy] = await db.select().from(academies).where(eq(academies.id, academyId)).limit(1);
  if (!academy) return;

  const [studio] = election.studioId
    ? await db.select().from(studios).where(eq(studios.id, election.studioId)).limit(1)
    : [null];
  const effective = await ballotRules(election.studioId, settings);
  const recipients = await eligibleVoters(academyId, settings, effective, election.studioId);

  const mail = electionCertifiedEmail({
    academyName: academy.name,
    studioName: studio?.name ?? null,
    accent: academy.palette.accent,
    title: election.title,
    winners: winners.map((winner) => `${winner.label} (${winner.votes})`),
    link: `${env.appUrl}/elections/${election.id}`,
  });

  for (const person of recipients) {
    await sendMail({ to: person.email, ...mail });
  }
}

electionsRouter.get("/:id/job", requirePermission("elections.read"), async (req, res) => {
  const [job] = await db
    .select()
    .from(aiJobs)
    .where(
      and(eq(aiJobs.academyId, req.user!.academyId), eq(aiJobs.electionId, Number(req.params.id))),
    )
    .orderBy(desc(aiJobs.id))
    .limit(1);
  res.json({ job: job ?? null });
});
