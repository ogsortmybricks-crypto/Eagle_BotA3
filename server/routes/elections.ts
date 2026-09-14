import { Router } from "express";
import { z } from "zod";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  academies,
  aiJobs,
  candidates,
  elections,
  positionHolders,
  positions,
  users,
  votes,
} from "@shared/schema";
import { requireAuth, requirePermission } from "../auth";
import { logActivity } from "../activity";
import { createJob, startApplyElection } from "../ai/jobs";
import { aiConfigured } from "../env";
import { electionOpenEmail, sendMail } from "../mailer";
import { env } from "../env";

export const electionsRouter = Router();

/**
 * Guides don't vote unless the academy explicitly turned that on.
 *
 * This is the sole authority on who may vote - the route uses `requireAuth`
 * rather than `requirePermission("elections.vote")` precisely so that a guide
 * reaches this check. Gating the route on the static permission table instead
 * would make the academy's `guidesCanVote` setting unreachable.
 */
async function canVote(academyId: number, role: string): Promise<boolean> {
  if (role === "guide") {
    const [academy] = await db.select().from(academies).where(eq(academies.id, academyId)).limit(1);
    return Boolean(academy?.guidesCanVote);
  }
  return role === "admin" || role === "secretary" || role === "learner";
}

async function tallyFor(electionId: number) {
  const rows = await db
    .select({ candidateId: votes.candidateId, count: sql<number>`count(*)::int` })
    .from(votes)
    .where(eq(votes.electionId, electionId))
    .groupBy(votes.candidateId);
  return new Map(rows.map((row) => [row.candidateId, row.count]));
}

/* --------------------------------- list ----------------------------------- */

electionsRouter.get("/", requirePermission("elections.read"), async (req, res) => {
  const academyId = req.user!.academyId;
  const rows = await db
    .select({
      election: elections,
      positionTitle: positions.title,
      candidateCount: sql<number>`(select count(*)::int from candidates where candidates.election_id = ${elections.id})`,
      voterCount: sql<number>`(select count(distinct voter_id)::int from votes where votes.election_id = ${elections.id})`,
      hasVoted: sql<boolean>`exists(select 1 from votes where votes.election_id = ${elections.id} and votes.voter_id = ${req.user!.id})`,
    })
    .from(elections)
    .leftJoin(positions, eq(positions.id, elections.positionId))
    .where(eq(elections.academyId, academyId))
    .orderBy(desc(elections.id));

  res.json({ elections: rows, canVote: await canVote(academyId, req.user!.role) });
});

electionsRouter.get("/:id", requirePermission("elections.read"), async (req, res) => {
  const id = Number(req.params.id);
  const academyId = req.user!.academyId;

  const [election] = await db
    .select()
    .from(elections)
    .where(and(eq(elections.id, id), eq(elections.academyId, academyId)))
    .limit(1);
  if (!election) return res.status(404).json({ error: "That election doesn't exist." });

  const options = await db
    .select({
      candidate: candidates,
      userName: users.name,
      userBio: users.bio,
      userAvatar: users.avatarUrl,
      userStudio: users.studio,
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
  const tally = closed ? await tallyFor(id) : null;

  const [{ voters }] = await db
    .select({ voters: sql<number>`count(distinct ${votes.voterId})::int` })
    .from(votes)
    .where(eq(votes.electionId, id));

  const [{ eligible }] = await db
    .select({ eligible: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.academyId, academyId), eq(users.active, true)));

  res.json({
    election,
    candidates: options.map((row) => ({
      ...row.candidate,
      userName: row.userName,
      userBio: row.userBio,
      userAvatar: row.userAvatar,
      userStudio: row.userStudio,
      userNga: row.userNga,
      pastPositions: history
        .filter((h) => h.userId === row.candidate.userId)
        .map((h) => h.title),
      votes: tally ? (tally.get(row.candidate.id) ?? 0) : null,
    })),
    myVotes: myVotes.map((v) => v.candidateId),
    turnout: { voters, eligible },
    canVote: await canVote(academyId, req.user!.role),
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
  selfNomination: z.boolean().default(true),
  closesAt: z.string().nullable().optional(),
  sourceMeetingId: z.number().int().nullable().optional(),
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

  if (input.type === "rule" && !input.proposalBody?.trim()) {
    return res.status(400).json({ error: "A rule vote needs the exact text people are voting on." });
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
  }

  const [election] = await db
    .insert(elections)
    .values({
      academyId,
      title: input.title.trim(),
      description: input.description ?? null,
      type: input.type,
      positionId: input.type === "position" ? (input.positionId ?? null) : null,
      proposalBody: input.type === "rule" ? (input.proposalBody ?? null) : null,
      status: "draft",
      seats,
      selfNomination: input.selfNomination,
      closesAt: input.closesAt ? new Date(input.closesAt) : null,
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
  const [election] = await db
    .select()
    .from(elections)
    .where(and(eq(elections.id, id), eq(elections.academyId, academyId)))
    .limit(1);
  if (!election) return res.status(404).json({ error: "That election doesn't exist." });
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

  const [election] = await db
    .select()
    .from(elections)
    .where(and(eq(elections.id, id), eq(elections.academyId, academyId)))
    .limit(1);
  if (!election) return res.status(404).json({ error: "That election doesn't exist." });

  if (parsed.data.status === "open") {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(candidates)
      .where(eq(candidates.electionId, id));
    if (count < 2) {
      return res.status(400).json({
        error: "A vote needs at least two options on the ballot before it can open.",
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
    actorUserId: req.user!.id,
    action: `election.${parsed.data.status}`,
    entityType: "election",
    entityId: id,
    summary: `${req.user!.name} set "${election.title}" to ${parsed.data.status}.`,
  });

  // Opening a vote mails everyone who can vote in it.
  if (parsed.data.status === "open") {
    void notifyVoters(academyId, updated).catch((error) =>
      console.error("[elections] notify failed", error),
    );
  }

  res.json({ election: updated });
});

async function notifyVoters(academyId: number, election: typeof elections.$inferSelect) {
  const [academy] = await db.select().from(academies).where(eq(academies.id, academyId)).limit(1);
  if (!academy) return;

  const roster = await db
    .select()
    .from(users)
    .where(and(eq(users.academyId, academyId), eq(users.active, true)));

  const recipients = [];
  for (const person of roster) {
    if (await canVote(academyId, person.role)) recipients.push(person);
  }

  const mail = electionOpenEmail({
    academyName: academy.name,
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

  if (!(await canVote(academyId, req.user!.role))) {
    return res.status(403).json({
      error:
        "Guides don't vote in this academy - governance belongs to the studio. An admin can change that in settings.",
    });
  }

  const [election] = await db
    .select()
    .from(elections)
    .where(and(eq(elections.id, id), eq(elections.academyId, academyId)))
    .limit(1);
  if (!election) return res.status(404).json({ error: "That election doesn't exist." });
  if (election.status !== "open") return res.status(409).json({ error: "This vote isn't open." });
  if (election.closesAt && election.closesAt < new Date()) {
    return res.status(409).json({ error: "Voting has closed." });
  }
  if (parsed.data.candidateIds.length > election.seats) {
    return res.status(400).json({
      error: `You can pick at most ${election.seats} option${election.seats === 1 ? "" : "s"}.`,
    });
  }

  const ballot = await db
    .select()
    .from(candidates)
    .where(eq(candidates.electionId, id));
  const valid = new Set(ballot.map((c) => c.id));
  if (!parsed.data.candidateIds.every((cid) => valid.has(cid))) {
    return res.status(400).json({ error: "That isn't a valid option on this ballot." });
  }

  // Re-voting replaces the previous ballot rather than stacking on it.
  await db
    .delete(votes)
    .where(and(eq(votes.electionId, id), eq(votes.voterId, req.user!.id)));
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

  const [election] = await db
    .select()
    .from(elections)
    .where(and(eq(elections.id, id), eq(elections.academyId, academyId)))
    .limit(1);
  if (!election) return res.status(404).json({ error: "That election doesn't exist." });
  if (election.status === "certified") {
    return res.status(409).json({ error: "This vote was already certified." });
  }
  if (election.status !== "closed") {
    return res.status(409).json({ error: "Close the vote before certifying it." });
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

  // A position vote seats the winners immediately and retires whoever held it.
  if (election.type === "position" && election.positionId) {
    await db
      .update(positionHolders)
      .set({ endedAt: new Date(), note: `Term ended by "${election.title}".` })
      .where(
        and(
          eq(positionHolders.positionId, election.positionId),
          isNull(positionHolders.endedAt),
        ),
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
  if (election.type === "rule" && aiConfigured) {
    const job = await createJob({
      academyId,
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
    actorUserId: req.user!.id,
    action: "election.certified",
    entityType: "election",
    entityId: id,
    summary: `"${election.title}" certified. Winner: ${winners[0]?.label ?? "none"}.`,
    metadata: { ranked },
  });

  res.json({ election: updated, winners, jobId });
});

electionsRouter.get("/:id/job", requirePermission("elections.read"), async (req, res) => {
  const [job] = await db
    .select()
    .from(aiJobs)
    .where(
      and(
        eq(aiJobs.academyId, req.user!.academyId),
        eq(aiJobs.electionId, Number(req.params.id)),
      ),
    )
    .orderBy(desc(aiJobs.id))
    .limit(1);
  res.json({ job: job ?? null });
});
