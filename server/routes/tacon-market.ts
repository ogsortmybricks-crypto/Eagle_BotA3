/** Authenticated mutation routes for built-in TacScript markets. */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { positionAudience, type Manifest, type PageDef, type PanelDef, type PositionDef } from "@shared/tacons";
import { requirePermission } from "../auth";
import { loadInstall } from "../tacons/registry";
import { audienceAllows, buildRuntime } from "../tacons/runtime";
import {
  fulfillPurchase,
  marketInstallCompatible,
  MarketError,
  purchaseProduct,
  recordPoints,
  saveProduct,
  validMarketDefinition,
} from "../tacons/market";

export const taconMarketRouter = Router();

function marketLocation(location: { page?: string; panel?: string; position?: string }) {
  return Number(Boolean(location.page)) + Number(Boolean(location.panel)) + Number(Boolean(location.position)) === 1;
}

function ownerAudience(owner: PageDef | PanelDef | PositionDef): string[] {
  return "showTo" in owner ? owner.showTo : [positionAudience(owner.name)];
}

function findMarketWidget(
  manifest: Manifest,
  location: { page?: string; panel?: string; position?: string },
  index: number,
) {
  if (!marketLocation(location)) return null;
  let owners: (PageDef | PanelDef | PositionDef)[];
  if (location.page) owners = manifest.pages.filter((owner) => owner.name === location.page);
  else if (location.position) owners = manifest.positions.filter((owner) => owner.name === location.position);
  else owners = manifest.panels.filter((owner) => owner.host === location.panel);
  // Panels are addressed by host, so ambiguous owners fail closed.
  if (owners.length !== 1) return null;
  const owner = owners[0];
  const widget = owner.widgets[index];
  return widget ? { widget, audience: ownerAudience(owner) } : null;
}

const marketLocationShape = z.object({
  page: z.string().max(60).optional(),
  panel: z.string().max(60).optional(),
  position: z.string().max(60).optional(),
});
const marketTargetShape = marketLocationShape.extend({
  index: z.number().int().min(0).max(200),
});
const marketTargetSchema = marketTargetShape.refine(marketLocation, "Choose exactly one market location.");
const pointsSchema = marketTargetShape.extend({
  points: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  reason: z.string().min(1).max(500),
  learnerId: z.number().int().positive().optional(),
  requestId: z.string().uuid(),
}).refine(marketLocation, "Choose exactly one market location.");
const productSchema = marketTargetShape.extend({
  name: z.string().min(1).max(100),
  description: z.string().max(1000),
  pricePoints: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  active: z.boolean(),
}).refine(marketLocation, "Choose exactly one market location.");
const purchaseSchema = marketTargetShape.extend({
  productId: z.number().int().positive(),
  requestId: z.string().uuid(),
}).refine(marketLocation, "Choose exactly one market location.");

async function authorizedMarket(
  req: Request,
  location: { page?: string; panel?: string; position?: string },
  index: number,
  marketName: string,
): Promise<
  | { ok: true; runtime: Awaited<ReturnType<typeof buildRuntime>>; def: NonNullable<Manifest["markets"]>[number] }
  | { ok: false; error: string; status: number }
> {
  const entry = await loadInstall(req.user!.academyId, Number(req.params.installId), req.scope);
  if (!entry || !entry.install.enabled) return { ok: false, error: "That Tac-On isn't installed here.", status: 404 };
  const found = findMarketWidget(entry.manifest, location, index);
  if (!found || found.widget.kind !== "market" || found.widget.market !== marketName) {
    return { ok: false, error: "That market isn't at this location.", status: 404 };
  }
  const def = entry.manifest.markets?.find((market) => market.name === marketName);
  if (!def || !validMarketDefinition(def)) return { ok: false, error: "That market isn't configured correctly.", status: 409 };
  if (!marketInstallCompatible(def, entry.install.studioId)) {
    return { ok: false, error: "This market requires one academy-wide install.", status: 409 };
  }
  const runtime = await buildRuntime({
    academy: req.academy!,
    settings: req.settings!,
    user: req.user!,
    scope: req.scope,
    install: entry,
  });
  if (!audienceAllows(found.audience, req.user!, runtime.held)) {
    return { ok: false, error: "Your role can't use this market.", status: 403 };
  }
  return { ok: true, runtime, def };
}

function sendMarketError(res: Response, error: unknown) {
  if (error instanceof MarketError) return res.status(400).json({ error: error.message });
  return res.status(500).json({ error: "The market could not complete that request. Please try again." });
}

taconMarketRouter.post("/view/:installId/markets/:name/points", requirePermission("tacons.use"), async (req, res) => {
  const parsed = pointsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Check the points entry and try again." });
  try {
    const access = await authorizedMarket(req, parsed.data, parsed.data.index, req.params.name);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    const user = req.user!;
    const manager = user.role === "admin" || access.runtime.held.has(access.def.keeper);
    if (user.role !== "learner" && !manager) return res.status(403).json({ error: "Only a learner, admin, or current keeper may log points." });
    if (user.role === "learner" && !manager && parsed.data.learnerId !== undefined && parsed.data.learnerId !== user.id) {
      return res.status(403).json({ error: "Learners may only log their own points." });
    }
    const learnerId = manager && parsed.data.learnerId !== undefined
      ? parsed.data.learnerId
      : user.role === "learner" ? user.id : undefined;
    if (!learnerId) return res.status(400).json({ error: "Choose an eligible learner." });
    const result = await recordPoints(access.runtime, access.def, {
      learnerId, points: parsed.data.points, reason: parsed.data.reason,
      requestId: parsed.data.requestId, actorId: user.id,
    });
    return res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
  } catch (error) {
    return sendMarketError(res, error);
  }
});

taconMarketRouter.post("/view/:installId/markets/:name/products", requirePermission("tacons.use"), async (req, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Check the product details and try again." });
  try {
    const access = await authorizedMarket(req, parsed.data, parsed.data.index, req.params.name);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    if (req.user!.role !== "admin") return res.status(403).json({ error: "Only an admin may manage products." });
    const product = await saveProduct(access.runtime, access.def, parsed.data);
    return res.status(201).json({ product });
  } catch (error) {
    return sendMarketError(res, error);
  }
});

taconMarketRouter.patch("/view/:installId/markets/:name/products/:id", requirePermission("tacons.use"), async (req, res) => {
  const parsed = productSchema.safeParse(req.body);
  const id = Number(req.params.id);
  if (!parsed.success || !Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "Check the product details and try again." });
  try {
    const access = await authorizedMarket(req, parsed.data, parsed.data.index, req.params.name);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    if (req.user!.role !== "admin") return res.status(403).json({ error: "Only an admin may manage products." });
    const product = await saveProduct(access.runtime, access.def, parsed.data, id);
    return res.json({ product });
  } catch (error) {
    return sendMarketError(res, error);
  }
});

taconMarketRouter.post("/view/:installId/markets/:name/purchase", requirePermission("tacons.use"), async (req, res) => {
  const parsed = purchaseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Check the purchase and try again." });
  try {
    const access = await authorizedMarket(req, parsed.data, parsed.data.index, req.params.name);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    if (req.user!.role !== "learner") return res.status(403).json({ error: "Only learners may purchase products." });
    const result = await purchaseProduct(access.runtime, access.def, {
      learnerId: req.user!.id, actorId: req.user!.id,
      productId: parsed.data.productId, requestId: parsed.data.requestId,
    });
    return res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
  } catch (error) {
    return sendMarketError(res, error);
  }
});

taconMarketRouter.post("/view/:installId/markets/:name/purchases/:id/fulfill", requirePermission("tacons.use"), async (req, res) => {
  const parsed = marketTargetSchema.safeParse(req.body);
  const id = Number(req.params.id);
  if (!parsed.success || !Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "Check the purchase and try again." });
  try {
    const access = await authorizedMarket(req, parsed.data, parsed.data.index, req.params.name);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    const manager = req.user!.role === "admin" || access.runtime.held.has(access.def.keeper);
    if (!manager) return res.status(403).json({ error: "Only an admin or current keeper may fulfill purchases." });
    const result = await fulfillPurchase(access.runtime, access.def, id, req.user!.id);
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendMarketError(res, error);
  }
});