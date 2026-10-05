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
  canManagePartners,
  partnersDef,
  readShot,
  saveCheckin,
  saveGoals,
  savePairings,
  setAllowStaff,
  uploadShot,
} from "../tacons/partners";
import { findMarketWidget, marketLocation, marketLocationShape } from "./tacon-market";

export const taconPartnersRouter = Router();

const targetShape = marketLocationShape.extend({ index: z.number().int().min(0).max(200) });
const located = <T extends z.ZodRawShape>(shape: T) =>
  targetShape.extend(shape).refine(marketLocation, "Choose exactly one location.");

const pairingsSchema = located({
  groups: z.array(z.array(z.number().int().positive()).min(2).max(3)).max(500),
});
const staffSchema = located({ allow: z.boolean() });
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

taconPartnersRouter.post(`${base}/staff`, requirePermission("tacons.use"), async (req, res) => {
  const parsed = staffSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Check the setting and try again." });
  try {
    const access = await authorized(req, parsed.data, parsed.data.index);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    if (req.user!.role !== "admin" || !canManagePartners(access.runtime, access.def)) {
      return res.status(403).json({ error: "Only an admin can decide whether staff can be partners." });
    }
    await setAllowStaff(access.runtime, access.def, parsed.data.allow, req.user!.id);
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
