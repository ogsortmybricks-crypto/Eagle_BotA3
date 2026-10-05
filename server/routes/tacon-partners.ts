/** Authenticated routes for TacScript's built-in accountability partners. */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { PartnersDef } from "@shared/tacons";
import { ON_TRACK } from "@shared/tacons/partners";
import { requirePermission } from "../auth";
import { logActivity } from "../activity";
import { loadInstall } from "../tacons/registry";
import { audienceAllows, buildRuntime, type Runtime } from "../tacons/runtime";
import {
  PartnersError,
  addPairs,
  endPair,
  canManagePartners,
  checkinView,
  groupView,
  partnersDef,
  readShot,
  saveCheckin,
  saveGoals,
  savePairings,
  uploadShot,
} from "../tacons/partners";
import {
  addCategory,
  copyWeek,
  deleteAssignment,
  deleteMilestone,
  partnersRecords,
  removeCategory,
  reviewWork,
  revokeCertification,
  saveApNotes,
  saveAssignment,
  saveMilestone,
  submitWork,
} from "../tacons/partners-work";
import { findMarketWidget, marketLocation, marketLocationShape } from "./tacon-market";

export const taconPartnersRouter = Router();

const targetShape = marketLocationShape.extend({ index: z.number().int().min(0).max(200) });
const located = <T extends z.ZodRawShape>(shape: T) =>
  targetShape.extend(shape).refine(marketLocation, "Choose exactly one location.");

const pairingsSchema = located({
  groups: z.array(z.array(z.number().int().positive()).min(2).max(3)).max(500),
});
const addPairsSchema = located({
  groups: z.array(z.array(z.number().int().positive()).min(2).max(3)).min(1).max(250),
});
const endPairSchema = located({ groupId: z.number().int().positive() });
const goalsSchema = located({
  week: z.string(),
  goals: z.record(z.string().max(300)),
});
const shotSchema = located({ image: z.string().max(1_500_000) });
const checkinSchema = located({
  targetId: z.number().int().positive(),
  date: z.string(),
  core: z.array(z.object({
    subject: z.string().max(40),
    goal: z.string().max(300),
    progress: z.string().max(500),
    percent: z.number().min(0).max(100).nullable(),
  })).max(8),
  evidence: z.array(z.object({
    subject: z.string().max(40),
    notes: z.string().max(1000),
    shots: z.array(z.number().int().positive()).max(3),
  })).max(8),
  onTrack: z.enum(ON_TRACK),
  notes: z.string().max(1000),
});

type Access =
  | { ok: true; runtime: Runtime; def: PartnersDef }
  | { ok: false; error: string; status: number };

async function authorized(
  req: Request,
  location: { page?: string; panel?: string; position?: string },
  index: number,
): Promise<Access> {
  const entry = await loadInstall(req.user!.academyId, Number(req.params.installId), req.scope);
  if (!entry || !entry.install.enabled) return { ok: false, error: "That Tac-On isn't installed here.", status: 404 };
  const found = findMarketWidget(entry.manifest, location, index);
  if (!found || found.widget.kind !== "partners" || found.widget.partners !== req.params.name) {
    return { ok: false, error: "Those partners aren't at this location.", status: 404 };
  }
  const runtime = await buildRuntime({
    academy: req.academy!,
    settings: req.settings!,
    user: req.user!,
    scope: req.scope,
    install: entry,
  });
  const def = partnersDef(runtime, req.params.name);
  if (!def) return { ok: false, error: "Those partners aren't configured.", status: 409 };
  if (!audienceAllows(found.audience, req.user!, runtime.held)) {
    return { ok: false, error: "This page isn't open to you.", status: 403 };
  }
  return { ok: true, runtime, def };
}

function sendError(res: Response, error: unknown) {
  if (error instanceof PartnersError) return res.status(400).json({ error: error.message });
  console.error("[tacon-partners]", error);
  return res.status(500).json({ error: "That couldn't be saved. Please try again." });
}

const base = "/view/:installId/partners/:name";

taconPartnersRouter.post(`${base}/pairings`, requirePermission("tacons.use"), async (req, res) => {
  const parsed = pairingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Check the pairings and try again." });
  try {
    const access = await authorized(req, parsed.data, parsed.data.index);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    if (!canManagePartners(access.runtime, access.def)) {
      return res.status(403).json({ error: "You can't change the pairings." });
    }
    const result = await savePairings(access.runtime, access.def, parsed.data.groups, req.user!.id);
    if (result.started + result.ended > 0) {
      await logActivity({
        academyId: access.runtime.academyId,
        studioId: access.runtime.install.install.studioId,
        actorUserId: req.user!.id,
        actorLabel: access.runtime.install.tacon.name,
        action: "tacon.partners.paired",
        entityType: "tacon",
        entityId: access.runtime.install.install.id,
        summary: `${req.user!.name} updated ${access.def.title}: ${result.started} new group(s), ${result.ended} ended.`,
      });
    }
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
});

taconPartnersRouter.post(`${base}/pairs`, requirePermission("tacons.use"), async (req, res) => {
  const parsed = addPairsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Pick at least two people." });
  try {
    const access = await authorized(req, parsed.data, parsed.data.index);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    if (!canManagePartners(access.runtime, access.def)) {
      return res.status(403).json({ error: "You can't change the pairings." });
    }
    const result = await addPairs(access.runtime, access.def, parsed.data.groups, req.user!.id);
    const people = access.runtime.people;
    await logActivity({
      academyId: access.runtime.academyId,
      studioId: access.runtime.install.install.studioId,
      actorUserId: req.user!.id,
      actorLabel: access.runtime.install.tacon.name,
      action: "tacon.partners.paired",
      entityType: "tacon",
      entityId: access.runtime.install.install.id,
      summary: `${req.user!.name} paired ${parsed.data.groups
        .map((group) => group.map((id) => people.get(id) ?? "someone").join(" & "))
        .join("; ")}.`,
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
});

taconPartnersRouter.post(`${base}/pairs/end`, requirePermission("tacons.use"), async (req, res) => {
  const parsed = endPairSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Pick a pair." });
  try {
    const access = await authorized(req, parsed.data, parsed.data.index);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    if (!canManagePartners(access.runtime, access.def)) {
      return res.status(403).json({ error: "You can't change the pairings." });
    }
    await endPair(access.runtime, access.def, parsed.data.groupId, req.user!.id);
    await logActivity({
      academyId: access.runtime.academyId,
      studioId: access.runtime.install.install.studioId,
      actorUserId: req.user!.id,
      actorLabel: access.runtime.install.tacon.name,
      action: "tacon.partners.ended",
      entityType: "tacon",
      entityId: access.runtime.install.install.id,
      summary: `${req.user!.name} ended an AP pair in ${access.def.title}.`,
    });
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, error);
  }
});

taconPartnersRouter.post(`${base}/goals`, requirePermission("tacons.use"), async (req, res) => {
  const parsed = goalsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Check your goals and try again." });
  try {
    const access = await authorized(req, parsed.data, parsed.data.index);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    // Your goals are yours: nobody sets them for you, not even a guide.
    await saveGoals(access.runtime, access.def, {
      personId: req.user!.id,
      week: parsed.data.week,
      goals: parsed.data.goals,
    });
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, error);
  }
});

taconPartnersRouter.post(`${base}/shots`, requirePermission("tacons.use"), async (req, res) => {
  const parsed = shotSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "That screenshot couldn't be read." });
  try {
    const access = await authorized(req, parsed.data, parsed.data.index);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    const id = await uploadShot(access.runtime, access.def, req.user!.id, parsed.data.image);
    return res.status(201).json({ id });
  } catch (error) {
    return sendError(res, error);
  }
});

taconPartnersRouter.get(`${base}/shots/:shotId`, requirePermission("tacons.use"), async (req, res) => {
  const location = {
    page: typeof req.query.page === "string" ? req.query.page : undefined,
    panel: typeof req.query.panel === "string" ? req.query.panel : undefined,
    position: typeof req.query.position === "string" ? req.query.position : undefined,
  };
  const index = Number(req.query.index);
  const shotId = Number(req.params.shotId);
  if (!marketLocation(location) || !Number.isSafeInteger(index) || !Number.isSafeInteger(shotId)) {
    return res.status(400).json({ error: "Bad screenshot request." });
  }
  try {
    const access = await authorized(req, location, index);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    const shot = await readShot(access.runtime, access.def, shotId);
    if (!shot) return res.status(404).json({ error: "That screenshot isn't available to you." });
    res.setHeader("Content-Type", shot.mime);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(shot.bytes);
  } catch (error) {
    return sendError(res, error);
  }
});

taconPartnersRouter.post(`${base}/checkins`, requirePermission("tacons.use"), async (req, res) => {
  const parsed = checkinSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Check the check-in and try again." });
  try {
    const access = await authorized(req, parsed.data, parsed.data.index);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    const result = await saveCheckin(access.runtime, access.def, req.user!.id, parsed.data);
    return res.status(result.updated ? 200 : 201).json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
});

/* -------------------------------------------------------------------------- */
/*  The week's work, certification, milestones, records                        */
/* -------------------------------------------------------------------------- */

/** One POST: parse, authorize, run, answer. */
function action<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  invalid: string,
  run: (access: { runtime: Runtime; def: PartnersDef }, input: z.output<S>, req: Request) => Promise<Record<string, unknown> | void>,
) {
  taconPartnersRouter.post(`${base}${path}`, requirePermission("tacons.use"), async (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: invalid });
    try {
      const access = await authorized(req, parsed.data, parsed.data.index);
      if (!access.ok) return res.status(access.status).json({ error: access.error });
      const result = await run(access, parsed.data, req);
      return res.json({ ok: true, ...(result ?? {}) });
    } catch (error) {
      return sendError(res, error);
    }
  });
}

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

action("/categories", located({ name: z.string().max(40) }), "Name the category.", async ({ runtime, def }, input, req) => {
  await addCategory(runtime, def, input.name, req.user!.id);
});

action("/categories/remove", located({ id: z.number().int().positive() }), "Pick a category.", async ({ runtime, def }, input) => {
  await removeCategory(runtime, def, input.id);
});

action(
  "/assignments",
  located({
    id: z.number().int().positive().optional(),
    week: DAY,
    category: z.string().max(40),
    title: z.string().max(200),
    details: z.string().max(1000).default(""),
  }),
  "Check the assignment and try again.",
  async ({ runtime, def }, input, req) => ({ id: await saveAssignment(runtime, def, input, req.user!.id) }),
);

action("/assignments/remove", located({ id: z.number().int().positive() }), "Pick an assignment.", async ({ runtime, def }, input) => {
  await deleteAssignment(runtime, def, input.id);
});

action("/assignments/copy", located({ from: DAY, to: DAY }), "Pick two weeks.", async ({ runtime, def }, input, req) => ({
  copied: await copyWeek(runtime, def, input.from, input.to, req.user!.id),
}));

action(
  "/work",
  located({
    assignmentId: z.number().int().positive(),
    notes: z.string().max(2000).default(""),
    shots: z.array(z.number().int().positive()).max(6).default([]),
  }),
  "Check your work and try again.",
  async ({ runtime, def }, input, req) => ({ id: await submitWork(runtime, def, req.user!.id, input) }),
);

action(
  "/work/review",
  located({
    completionId: z.number().int().positive(),
    decision: z.enum(["confirm", "return"]),
    excellence: z.boolean().default(false),
    code: z.string().max(12).default(""),
    notes: z.string().max(2000).default(""),
    note: z.string().max(1000).default(""),
  }),
  "Check the review and try again.",
  async ({ runtime, def }, input, req) => {
    const review = input.decision === "return"
      ? { completionId: input.completionId, decision: "return" as const, note: input.note }
      : { completionId: input.completionId, decision: "confirm" as const, excellence: input.excellence, code: input.code, notes: input.notes };
    const result = await reviewWork(runtime, def, req.user!.id, review);
    if (input.decision === "confirm") {
      await logActivity({
        academyId: runtime.academyId,
        studioId: runtime.install.install.studioId,
        actorUserId: req.user!.id,
        actorLabel: runtime.install.tacon.name,
        action: "tacon.partners.certified",
        entityType: "tacon",
        entityId: runtime.install.install.id,
        summary: `${req.user!.name} certified their AP's work${input.excellence ? " as done with Excellence" : " as complete"}.`,
      });
    }
    return result;
  },
);

action(
  "/work/notes",
  located({ completionId: z.number().int().positive(), notes: z.string().max(2000) }),
  "Check your notes.",
  async ({ runtime, def }, input, req) => {
    await saveApNotes(runtime, def, req.user!.id, input.completionId, input.notes);
  },
);

action(
  "/work/revoke",
  located({ completionId: z.number().int().positive(), reason: z.string().max(1000).default("") }),
  "Pick the certification.",
  async ({ runtime, def }, input, req) => {
    await revokeCertification(runtime, def, req.user!.id, input.completionId, input.reason);
    await logActivity({
      academyId: runtime.academyId,
      studioId: runtime.install.install.studioId,
      actorUserId: req.user!.id,
      actorLabel: runtime.install.tacon.name,
      action: "tacon.partners.revoked",
      entityType: "tacon",
      entityId: runtime.install.install.id,
      summary: `${req.user!.name} took back an AP certification.`,
    });
  },
);

action(
  "/milestones",
  located({ id: z.number().int().positive().optional(), title: z.string().max(200), achievedOn: DAY.nullable().default(null) }),
  "Check the milestone.",
  async ({ runtime, def }, input, req) => {
    await saveMilestone(runtime, def, req.user!.id, input);
  },
);

action("/milestones/remove", located({ id: z.number().int().positive() }), "Pick a milestone.", async ({ runtime, def }, input, req) => {
  await deleteMilestone(runtime, def, req.user!.id, input.id);
});

taconPartnersRouter.get(`${base}/records`, requirePermission("tacons.use"), async (req, res) => {
  const location = {
    page: typeof req.query.page === "string" ? req.query.page : undefined,
    panel: typeof req.query.panel === "string" ? req.query.panel : undefined,
    position: typeof req.query.position === "string" ? req.query.position : undefined,
  };
  const index = Number(req.query.index);
  if (!marketLocation(location) || !Number.isSafeInteger(index)) {
    return res.status(400).json({ error: "Bad records request." });
  }
  try {
    const access = await authorized(req, location, index);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    const records = await partnersRecords(access.runtime, access.def, {
      group: (row) => groupView(access.runtime, row),
      checkin: (row) => checkinView(access.runtime, row),
    });
    return res.json(records);
  } catch (error) {
    return sendError(res, error);
  }
});
