import type { Router, Request } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { taconControls, taconInstalls } from "@shared/schema";
import { policySchema } from "@shared/tacons/contract";
import { positionAudience } from "@shared/tacons";
import { requirePermission } from "../auth";
import { loadInstall } from "./registry";
import { buildRuntime, audienceAllows, widgetVisible } from "./runtime";
import { controlsFor, demandAccess, TaconAccessError, validAudience } from "./governance";
import { invokeSdk } from "./sdk";
import { checkedSettings, executeSetup, reviewSchema, validateReview } from "./lifecycle";
import { logActivity } from "../activity";

async function runtimeFor(req: Request) {
  const entry = await loadInstall(req.user!.academyId, Number(req.params.installId), req.scope);
  if (!entry) throw new TaconAccessError("That Tac-On isn't installed here.", 404);
  return buildRuntime({ academy: req.academy!, settings: req.settings!, user: req.user!, scope: req.scope, install: entry });
}
const rpcSchema = z.object({
  sdk: z.literal(1),
  page: z.string().max(60).optional(), panel: z.string().max(60).optional(), position: z.string().max(60).optional(),
  index: z.number().int().min(0).max(200), method: z.enum(["extensions.discover", "events.send", "events.read"]), args: z.unknown(),
}).refine(value => [value.page, value.panel, value.position].filter(Boolean).length === 1, "Name exactly one widget owner.");
const controlSchema = reviewSchema.extend({ policy: policySchema.partial() }).strict();
export function registerGovernanceRoutes(router: Router) {
  router.post("/sdk/:installId/rpc", requirePermission("tacons.use"), async (req, res) => {
    const parsed = rpcSchema.safeParse(req.body);
    if (!parsed.success) throw new TaconAccessError("Invalid SDK request.", 400);
    const runtime = await runtimeFor(req), input = parsed.data, manifest = runtime.install.manifest;
    if (!runtime.install.install.enabled) throw new TaconAccessError("This installation is off.", 404);
    const owner = input.page ? manifest.pages.find(page => page.name === input.page) :
      input.panel ? manifest.panels.find(panel => panel.host === input.panel) : manifest.positions.find(position => position.name === input.position);
    const widget = owner?.widgets[input.index];
    if (!owner || widget?.kind !== "program") throw new TaconAccessError("That program does not exist.", 404);
    if (!audienceAllows("showTo" in owner ? owner.showTo : [positionAudience(owner.name)], req.user!, runtime.held) ||
      !(await widgetVisible(runtime, widget))) throw new TaconAccessError("This program is not open to you.");
    res.json({ result: await invokeSdk(runtime, input.method, input.args) });
  });
  router.get("/sdk/:installId/configuration", requirePermission("tacons.use"), async (req, res) => {
    const runtime = await runtimeFor(req);
    demandAccess(runtime, "configure");
    res.json({ settings: Object.fromEntries(runtime.install.manifest.settings.map(setting => [setting.name, runtime.install.install.settings[setting.name] ?? setting.default])), definitions: runtime.install.manifest.settings });
  });
  router.patch("/sdk/:installId/configuration", requirePermission("tacons.use"), async (req, res) => {
    const runtime = await runtimeFor(req);
    demandAccess(runtime, "configure");
    const parsed = z.object({ settings: z.record(z.unknown()) }).strict().safeParse(req.body);
    if (!parsed.success) throw new TaconAccessError("Invalid configuration.", 400);
    const settings = checkedSettings(runtime.install.manifest, parsed.data.settings);
    await db.update(taconInstalls).set({ settings, updatedAt: new Date() }).where(eq(taconInstalls.id, runtime.install.install.id));
    await logActivity({ academyId: runtime.academyId, studioId: runtime.install.install.studioId, actorUserId: req.user!.id,
      action: "tacon.configured", entityType: "tacon", entityId: runtime.install.install.id, summary: `${req.user!.name} configured ${runtime.install.tacon.name}.` });
    res.json({ settings });
  });
  router.get("/installs/:installId/controls", requirePermission("tacons.install"), async (req, res) => {
    const runtime = await runtimeFor(req);
    res.json({ controls: runtime.controls, manifest: runtime.install.manifest, settings: runtime.install.install.settings, versionId: runtime.install.version.id });
  });
  router.patch("/installs/:installId/controls", requirePermission("tacons.install"), async (req, res) => {
    const runtime = await runtimeFor(req), parsed = controlSchema.safeParse(req.body);
    if (!parsed.success) throw new TaconAccessError("Invalid installation permissions.", 400);
    const { grants, policy } = parsed.data;
    const selectedSetup = validateReview(runtime.install.manifest, runtime.install.version.id, parsed.data);
    if (grants.some(cap => !(runtime.install.manifest.contract?.capabilities as string[] | undefined)?.includes(cap)) ||
      Object.values(policy).some(rules => rules!.some(rule => !validAudience(runtime.install.manifest, rule)))) {
      throw new TaconAccessError("Choose only declared capabilities and existing role/position audiences.", 400);
    }
    const old = await controlsFor(runtime.install.install.id, runtime.install.manifest);
    await db.transaction(async tx => {
      const [current] = await tx.select().from(taconInstalls).where(eq(taconInstalls.id, runtime.install.install.id)).for("update");
      if (!current || current.versionId !== runtime.install.version.id) throw new TaconAccessError("The version changed. Reload the permission review.", 409);
      await tx.insert(taconControls).values({ ...old, installId: current.id, grants, policy, selectedSetup })
        .onConflictDoUpdate({ target: taconControls.installId, set: { grants, policy, selectedSetup, updatedAt: new Date() } });
    });
    await logActivity({ academyId: runtime.academyId, studioId: runtime.install.install.studioId, actorUserId: req.user!.id,
      action: "tacon.permissions.changed", entityType: "tacon", entityId: runtime.install.install.id, summary: `${req.user!.name} reviewed permissions for ${runtime.install.tacon.name}.` });
    res.json({ ok: true, setupResults: await executeSetup(runtime.install, req.user!.id) });
  });
  router.post("/installs/:installId/setup", requirePermission("tacons.install"), async (req, res) => {
    const runtime = await runtimeFor(req);
    res.json({ setupResults: await executeSetup(runtime.install, req.user!.id) });
  });
}
