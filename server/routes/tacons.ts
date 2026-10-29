/**
 * The Tac-Ons API: the market, what an academy has installed, the running of
 * those Tac-Ons, and the dev menu learners publish from.
 *
 * Three audiences share this router, and the permission on each route says
 * which one it is for:
 *
 *   tacons.use      - everyone, for opening a page a Tac-On added
 *   tacons.market   - admins and devs, for browsing the market
 *   tacons.install  - admins, for deciding what this academy runs
 *   tacons.develop  - learners an admin has given dev status
 */

import { Router, type Request } from "express";
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  TACON_VISIBILITIES,
  studios,
  studioGroups,
  taconInstalls,
  taconMessages,
  taconRecords,
  taconWallets,
  taconWalletTransactions,
  taconVersions,
  tacons,
  users,
} from "@shared/schema";
import { requireAuth, requirePermission } from "../auth";
import { logActivity } from "../activity";
import { requireScope, writeStudioId, StudioChoiceError, studioCircle } from "../studio";
import {
  APP_FILE_EXTENSION,
  packageOf,
  LINK_COLUMN,
  positionAudience,
  type Manifest,
  type PageDef,
  type PanelDef,
  type PositionDef,
  type Widget,
} from "@shared/tacons";
import type {
  TaconDeskView,
  TaconNavEntry,
  TaconPanelView,
  TaconRecordView,
  TaconView,
} from "@shared/tacons/view";
import {
  loadInstall,
  marketListings,
  readManifest,
  visibleInstalls,
  type LoadedInstall,
} from "../tacons/registry";
import {
  addRecord,
  audienceAllows,
  buildRuntime,
  feedShowsRow,
  formValues,
  listOffersRemove,
  listShowsRow,
  pageTitle,
  renderDesk,
  renderPage,
  renderPanel,
  renderRecord,
  rowFrom,
  runActions,
  widgetVisible,
} from "../tacons/runtime";
import { checkVerifyCode, VerifyCodeError } from "../personal";
import { heldNames, heldPositions, setPositionsArchived, syncPositions } from "../tacons/positions";
import { registerExtensionRoutes } from "../tacons/extensions";
import {
  RecordError,
  type StoreAccess,
  createRecord,
  deleteRecord,
  listRecords,
  storeName,
  updateRecord,
} from "../tacons/app-records";
import { TACSCRIPT_RETIRED, appBodySchema, prepareApp } from "../tacons/app-publish";
import { displayModeOf, runSetup } from "../tacons/app-setup";
import { appView, storeAccess } from "../tacons/app-view";

export const taconsRouter = Router();
registerExtensionRoutes(taconsRouter);

/* -------------------------------------------------------------------------- */
/*  What this academy is running                                               */
/* -------------------------------------------------------------------------- */

/** The sidebar entries installed Tac-Ons contribute, for the current studio. */
taconsRouter.get("/nav", requirePermission("tacons.use"), async (req, res) => {
  const installs = await visibleInstalls(req.user!.academyId, req.scope);
  const held = await heldPositions(req.user!.id, installs.map((entry) => entry.install.id));
  const entries: TaconNavEntry[] = [];

  for (const entry of installs) {
    const mine = new Set(held.get(entry.install.id)?.keys() ?? []);
    // A title with `{...}` in it is worked out for this person, which needs
    // the Tac-On's runtime - so only Tac-Ons that have one pay for it.
    const runtime = entry.manifest.pages.some((page) => page.nav && page.titleTemplate)
      ? await buildRuntime({
          academy: req.academy!,
          settings: req.settings!,
          user: req.user!,
          scope: req.scope,
          install: entry,
        })
      : null;
    for (const page of entry.manifest.pages) {
      if (!page.nav) continue;
      if (!audienceAllows(page.showTo, req.user!, mine)) continue;
      entries.push({
        installId: entry.install.id,
        page: page.name,
        label: runtime ? await pageTitle(runtime, page) : page.title,
        icon: page.icon,
        taconName: entry.tacon.name,
        studioName: entry.studioName,
      });
    }
  }

  res.json({ entries });
});

/** Panels an installed Tac-On attaches to one of Eagle Bot's own pages. */
taconsRouter.get("/panels/:host", requirePermission("tacons.use"), async (req, res) => {
  const host = req.params.host;
  const installs = await visibleInstalls(req.user!.academyId, req.scope);
  const held = await heldPositions(req.user!.id, installs.map((entry) => entry.install.id));
  const panels: TaconPanelView[] = [];

  for (const entry of installs) {
    const mine = new Set(held.get(entry.install.id)?.keys() ?? []);
    const matching = entry.manifest.panels.filter(
      (panel) => panel.host === host && audienceAllows(panel.showTo, req.user!, mine),
    );
    if (matching.length === 0) continue;

    const runtime = await buildRuntime({
      academy: req.academy!,
      settings: req.settings!,
      user: req.user!,
      scope: req.scope,
      install: entry,
    });
    for (const panel of matching) {
      const view = await renderPanel(runtime, panel);
      // An app's panel runs the app itself, told which page it's on.
      if (entry.manifest.app) {
        view.app = appView({ entry, runtime, user: req.user!, academy: req.academy!, place: `panel:${panel.host}` });
      }
      panels.push(view);
    }
  }

  res.json({ panels });
});

/**
 * The desks of every Tac-On position this person holds - what the Positions
 * page shows them and nobody else.
 */
taconsRouter.get("/desks", requirePermission("tacons.use"), async (req, res) => {
  const installs = await visibleInstalls(req.user!.academyId, req.scope);
  const held = await heldPositions(req.user!.id, installs.map((entry) => entry.install.id));
  const desks: TaconDeskView[] = [];

  for (const entry of installs) {
    const mine = held.get(entry.install.id);
    if (!mine) continue;
    const defs = entry.manifest.positions.filter((def) => mine.has(def.name) && def.widgets.length > 0);
    if (defs.length === 0) continue;

    const runtime = await buildRuntime({
      academy: req.academy!,
      settings: req.settings!,
      user: req.user!,
      scope: req.scope,
      install: entry,
    });
    for (const def of defs) {
      const seat = mine.get(def.name)!;
      desks.push(await renderDesk(runtime, def, seat.positionId, seat.title));
    }
  }

  res.json({ desks });
});

/* -------------------------------------------------------------------------- */
/*  Running a Tac-On's page                                                    */
/* -------------------------------------------------------------------------- */

async function openInstall(req: Request): Promise<LoadedInstall | null> {
  return loadInstall(req.user!.academyId, Number(req.params.installId), req.scope);
}

taconsRouter.get("/view/:installId/:page", requirePermission("tacons.use"), async (req, res) => {
  const entry = await openInstall(req);
  if (!entry || !entry.install.enabled) {
    return res.status(404).json({ error: "That Tac-On isn't installed here." });
  }

  const page = entry.manifest.pages.find((candidate) => candidate.name === req.params.page);
  if (!page) return res.status(404).json({ error: "That Tac-On has no such page." });
  if (!audienceAllows(page.showTo, req.user!, await heldNames(req.user!.id, entry.install.id))) {
    return res.status(403).json({ error: "This page isn't open to your role or your positions." });
  }

  const runtime = await buildRuntime({
    academy: req.academy!,
    settings: req.settings!,
    user: req.user!,
    scope: req.scope,
    install: entry,
  });
  const view: TaconView = await renderPage(runtime, page);
  if (entry.manifest.app) {
    view.app = appView({ entry, runtime, user: req.user!, academy: req.academy!, place: "page" });
  }
  res.json({ view });
});

/**
 * Who may see the widgets in a page, panel or position desk. A desk is for
 * whoever holds the position right now, and nobody else.
 */
function ownerAudience(owner: PageDef | PanelDef | PositionDef): string[] {
  return "showTo" in owner ? owner.showTo : [positionAudience(owner.name)];
}

/** Finds the widget a submission refers to, in the page, panel or desk it came from. */
function findWidget(
  manifest: Manifest,
  location: { page?: string; panel?: string; position?: string },
  index: number,
): { widget: Widget; audience: string[] } | null {
  const owner: PageDef | PanelDef | PositionDef | undefined = location.page
    ? manifest.pages.find((page) => page.name === location.page)
    : location.position
      ? manifest.positions.find((position) => position.name === location.position)
      : manifest.panels.find((panel) => panel.host === location.panel);
  if (!owner) return null;
  const widget = owner.widgets[index];
  return widget ? { widget, audience: ownerAudience(owner) } : null;
}

const submitSchema = z.object({
  page: z.string().max(60).optional(),
  panel: z.string().max(60).optional(),
  position: z.string().max(60).optional(),
  index: z.number().int().min(0).max(200),
  values: z.record(z.unknown()).default({}),
  /** The six-digit confirmation code, for a form with `confirm with code`. */
  code: z.string().max(20).optional(),
});

taconsRouter.post("/view/:installId/submit", requirePermission("tacons.use"), async (req, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Couldn't read that form." });

  const entry = await openInstall(req);
  if (!entry || !entry.install.enabled) {
    return res.status(404).json({ error: "That Tac-On isn't installed here." });
  }

  const found = findWidget(entry.manifest, parsed.data, parsed.data.index);
  if (!found || found.widget.kind !== "form") {
    return res.status(404).json({ error: "That form isn't part of this Tac-On." });
  }
  const form = found.widget;

  const runtime = await buildRuntime({
    academy: req.academy!,
    settings: req.settings!,
    user: req.user!,
    scope: req.scope,
    install: entry,
  });

  if (
    !audienceAllows(found.audience, req.user!, runtime.held) ||
    !audienceAllows(form.allow, req.user!, runtime.held)
  ) {
    return res.status(403).json({ error: "Your role can't add to this." });
  }
  if (!(await widgetVisible(runtime, form))) {
    return res.status(403).json({ error: "This form isn't open right now." });
  }

  // `confirm with code`: the person's own six-digit code, checked before anything is written.
  if (form.confirmCode) {
    try {
      await checkVerifyCode(req.user!.id, parsed.data.code ?? "");
    } catch (error) {
      if (error instanceof VerifyCodeError) return res.status(400).json({ error: error.message });
      throw error;
    }
  }

  // Only the fields the form actually asked for are accepted, whatever the
  // browser sent, plus the ones it fills in itself.
  const values = await formValues(runtime, form, parsed.data.values);

  const result = await addRecord(runtime, form.into, values, {
    type: "user",
    userId: req.user!.id,
  });
  if (!result.ok) return res.status(400).json({ error: result.error });

  const after = await runActions(runtime, form.then, {
    actorUserId: req.user!.id,
    studioId: entry.install.studioId,
    reason: "form",
  });

  await logActivity({
    academyId: req.user!.academyId,
    studioId: entry.install.studioId,
    actorUserId: req.user!.id,
    actorLabel: entry.tacon.name,
    action: "tacon.record.added",
    entityType: "tacon",
    entityId: entry.install.id,
    summary: `${req.user!.name} added to ${entry.tacon.name}.`,
    metadata: { slug: entry.tacon.slug, store: form.into },
  });

  res.status(201).json({ ok: true, id: result.id, notices: after.notices });
});

taconsRouter.post("/view/:installId/run", requirePermission("tacons.use"), async (req, res) => {
  const parsed = submitSchema.omit({ values: true, code: true }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Couldn't read that." });

  const entry = await openInstall(req);
  if (!entry || !entry.install.enabled) {
    return res.status(404).json({ error: "That Tac-On isn't installed here." });
  }

  const found = findWidget(entry.manifest, parsed.data, parsed.data.index);
  if (!found || found.widget.kind !== "button") {
    return res.status(404).json({ error: "That button isn't part of this Tac-On." });
  }

  const runtime = await buildRuntime({
    academy: req.academy!,
    settings: req.settings!,
    user: req.user!,
    scope: req.scope,
    install: entry,
  });
  if (
    !audienceAllows(found.audience, req.user!, runtime.held) ||
    !audienceAllows(found.widget.allow, req.user!, runtime.held)
  ) {
    return res.status(403).json({ error: "Your role can't do that." });
  }
  if (!(await widgetVisible(runtime, found.widget))) {
    return res.status(403).json({ error: "That button isn't available right now." });
  }

  const result = await runActions(runtime, found.widget.does, {
    actorUserId: req.user!.id,
    studioId: entry.install.studioId,
    reason: "button",
  });

  res.json({ ok: true, ...result });
});

/** One of this install's saved rows, by id, straight from the database. */
async function storedRecord(installId: number, recordId: number) {
  if (!Number.isInteger(recordId) || recordId < 1) return null;
  const [record] = await db
    .select()
    .from(taconRecords)
    .where(and(eq(taconRecords.id, recordId), eq(taconRecords.installId, installId)))
    .limit(1);
  return record ?? null;
}

/** Every list in the Tac-On, with the page, panel or desk it sits in. */
function listsOf(manifest: Manifest) {
  const owners: (PageDef | PanelDef | PositionDef)[] = [...manifest.pages, ...manifest.panels, ...manifest.positions];
  return owners.flatMap((owner) =>
    owner.widgets.flatMap((widget) => (widget.kind === "list" ? [{ owner, widget }] : [])),
  );
}

taconsRouter.delete(
  "/view/:installId/records/:recordId",
  requirePermission("tacons.use"),
  async (req, res) => {
    const entry = await openInstall(req);
    if (!entry) return res.status(404).json({ error: "That Tac-On isn't installed here." });

    const record = await storedRecord(entry.install.id, Number(req.params.recordId));
    if (!record) return res.status(404).json({ error: "That row is already gone." });

    // Removal is only ever offered by a list, so the question is "is there a
    // list this person can see, that shows them this very row, and lets them
    // remove it?" - its `where`, `show if` and `allow remove own` included.
    const runtime = await buildRuntime({
      academy: req.academy!,
      settings: req.settings!,
      user: req.user!,
      scope: req.scope,
      install: entry,
    });
    const row = rowFrom(record, runtime);
    let allowed = false;
    for (const { owner, widget } of listsOf(entry.manifest)) {
      if (widget.source.kind !== "store" || widget.source.store.length !== 1) continue;
      if (widget.source.store[0] !== record.store) continue;
      if (!audienceAllows(ownerAudience(owner), req.user!, runtime.held)) continue;
      if (await listOffersRemove(runtime, widget, row)) {
        allowed = true;
        break;
      }
    }
    if (!allowed) return res.status(403).json({ error: "You can't remove this row." });

    await db.delete(taconRecords).where(eq(taconRecords.id, record.id));
    res.json({ ok: true });
  },
);

const recordQuerySchema = z.object({
  page: z.string().max(60).optional(),
  panel: z.string().max(60).optional(),
  position: z.string().max(60).optional(),
  index: z.coerce.number().int().min(0).max(200).optional(),
  calendar: z.coerce.number().int().min(0).max(200).optional(),
});

/**
 * One row on its own read-only page: what a list's `link` column and a
 * calendar's `open record` open. Record ids are easy to guess, so the row has
 * to be one the list (or calendar block) it was opened from would show this
 * person - unless the list says `link anyone`, which opens it to anyone in
 * the academy. It never opens to anyone signed out.
 */
taconsRouter.get(
  "/view/:installId/record/:recordId",
  requirePermission("tacons.use"),
  async (req, res) => {
    const parsed = recordQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "That link isn't complete." });
    const query = parsed.data;

    const entry = await openInstall(req);
    if (!entry || !entry.install.enabled) {
      return res.status(404).json({ error: "That Tac-On isn't installed here." });
    }
    const record = await storedRecord(entry.install.id, Number(req.params.recordId));
    const missing = () => res.status(404).json({ error: "That record isn't here, or isn't yours to see." });
    if (!record) return missing();

    const runtime = await buildRuntime({
      academy: req.academy!,
      settings: req.settings!,
      user: req.user!,
      scope: req.scope,
      install: entry,
    });
    const row = rowFrom(record, runtime);
    let view: TaconRecordView | null = null;

    if (query.calendar !== undefined) {
      const feed = entry.manifest.calendars?.[query.calendar];
      if (!feed?.openRecord || feed.store.length !== 1 || feed.store[0] !== record.store) return missing();
      if (!(await feedShowsRow(runtime, feed, row))) return missing();
      view = await renderRecord(runtime, {
        store: record.store,
        row,
        fields: feed.openRecord,
        title: feed.title,
        back: { label: "Calendar", href: "/calendar" },
      });
    } else {
      if (query.index === undefined) return missing();
      const found = findWidget(entry.manifest, query, query.index);
      if (!found || found.widget.kind !== "list") return missing();
      const list = found.widget;
      if (list.source.kind !== "store" || list.source.store.length !== 1 || list.source.store[0] !== record.store) {
        return missing();
      }
      if (!list.columns.includes(LINK_COLUMN)) return missing();
      if (!list.linkAnyone) {
        if (!audienceAllows(found.audience, req.user!, runtime.held)) return missing();
        if (!(await listShowsRow(runtime, list, row))) return missing();
      }
      const page = query.page ? entry.manifest.pages.find((candidate) => candidate.name === query.page) : null;
      view = await renderRecord(runtime, {
        store: record.store,
        row,
        fields: list.columns,
        skip: (list.values ?? []).map((entry) => entry.name),
        title: list.titleTemplate ?? (list.title ? { kind: "literal", value: list.title } : null),
        back: page
          ? { label: await pageTitle(runtime, page), href: `/t/${entry.install.id}/${page.name}` }
          : query.position
            ? { label: "Positions", href: "/positions" }
            : null,
      });
    }

    if (!view) return missing();
    res.json({ view });
  },
);

/* -------------------------------------------------------------------------- */
/*  An app's own records - what `EagleBot.api` reaches                         */
/* -------------------------------------------------------------------------- */

/** The install an app's SDK call is about, if this person may use the app. */
async function openApp(req: Request): Promise<{ entry: LoadedInstall; access: StoreAccess }> {
  const entry = await openInstall(req);
  if (!entry || !entry.install.enabled) throw new RecordError(404, "That Tac-On isn't installed here.");
  if (!entry.manifest.app) throw new RecordError(404, "That Tac-On isn't an app.");
  const held = await heldNames(req.user!.id, entry.install.id);
  const page = entry.manifest.pages[0];
  // Seeing one of its panels is opening it too.
  const panelOpen = entry.manifest.panels.some((panel) => audienceAllows(panel.showTo, req.user!, held));
  if (page && !audienceAllows(page.showTo, req.user!, held) && !panelOpen) {
    throw new RecordError(403, "This Tac-On isn't open to your role.");
  }
  return { entry, access: storeAccess(entry.manifest, req.user!, held) };
}

function recordFailure(res: import("express").Response, error: unknown) {
  if (error instanceof RecordError) return res.status(error.status).json({ error: error.message });
  throw error;
}

taconsRouter.get("/app/:installId/records", requirePermission("tacons.use"), async (req, res) => {
  try {
    const { entry, access } = await openApp(req);
    const store = typeof req.query.store === "string" && req.query.store ? storeName(req.query.store) : null;
    res.json({ records: await listRecords(entry.install, entry.tacon.name, store, access) });
  } catch (error) {
    recordFailure(res, error);
  }
});

taconsRouter.post("/app/:installId/records", requirePermission("tacons.use"), async (req, res) => {
  try {
    const { entry, access } = await openApp(req);
    const record = await createRecord(entry.install, entry.tacon.name, req.user!, req.body ?? {}, access, (code) =>
      checkVerifyCode(req.user!.id, code),
    );
    res.status(201).json({ record });
  } catch (error) {
    recordFailure(res, error);
  }
});

taconsRouter.patch("/app/:installId/records/:recordId", requirePermission("tacons.use"), async (req, res) => {
  try {
    const { entry, access } = await openApp(req);
    const record = await updateRecord(entry.install, entry.tacon.name, req.user!, Number(req.params.recordId), req.body ?? {}, access);
    res.json({ record });
  } catch (error) {
    recordFailure(res, error);
  }
});

taconsRouter.delete("/app/:installId/records/:recordId", requirePermission("tacons.use"), async (req, res) => {
  try {
    const { entry, access } = await openApp(req);
    await deleteRecord(entry.install, req.user!, Number(req.params.recordId), access);
    res.json({ ok: true });
  } catch (error) {
    recordFailure(res, error);
  }
});


    /* -------------------------------------------------------------------------- */
    /*  Eagle Buck wallets, atomic purchases, and scoped app-to-app messages       */
    /* -------------------------------------------------------------------------- */

    function requireMarketEntry(entry: LoadedInstall): void {
      if (entry.tacon.slug !== "eagle-buck-market") throw new RecordError(404, "That market service is not available to this Tac-On.");
    }

    function messagePeers(entry: LoadedInstall): string[] {
      return entry.manifest.app?.communicatesWith ?? [];
    }

    const purchaseSchema = z.object({
      items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(99) })).min(1).max(3),
      bundle: z.boolean().optional().default(false),
    });

    const adjustmentSchema = z.object({
      userId: z.number().int().positive(),
      amount: z.number().int().min(1).max(1000000),
      reason: z.string().trim().max(200).optional().default("Shopkeeper credit"),
    });

    const messageSchema = z.object({
      to: z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/),
      kind: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
      payload: z.record(z.unknown()).default({}),
    });

    async function appMessageScope(entry: LoadedInstall): Promise<number[] | null> {
      const install = entry.install;
      if (install.visibility === "academy") return null;
      if (install.visibility === "group" && install.groupId !== null) {
        const members = await db
          .select({ id: studios.id })
          .from(studios)
          .where(and(eq(studios.academyId, install.academyId), eq(studios.groupId, install.groupId), eq(studios.archived, false)));
        return members.map((member) => member.id);
      }
      if (install.visibility === "studio") return install.studioId === null ? [] : [install.studioId];
      if (install.studioId === null) return null;
      return install.visibility === "legacy" ? studioCircle(install.studioId) : [install.studioId];
    }

    async function ensureWallet(installId: number, academyId: number, userId: number) {
      await db.insert(taconWallets).values({ installId, academyId, userId }).onConflictDoNothing();
      const [wallet] = await db.select().from(taconWallets).where(and(eq(taconWallets.installId, installId), eq(taconWallets.userId, userId))).limit(1);
      return wallet;
    }

    taconsRouter.get("/app/:installId/members", requirePermission("tacons.use"), async (req, res) => {
      try {
        const { entry } = await openApp(req);
        const circle = await appMessageScope(entry);
        const filters = [eq(users.academyId, entry.install.academyId), eq(users.active, true)];
        if (circle !== null) {
          if (circle.length === 0) return res.json({ people: [] });
          filters.push(inArray(users.studioId, circle));
        }
        const people = await db
          .select({ id: users.id, name: users.name, role: users.role, studioId: users.studioId })
          .from(users)
          .where(and(...filters))
          .orderBy(asc(users.name));
        res.json({ people: people.map((person) => ({ ...person, email: null, currentPositions: [] })) });
      } catch (error) { recordFailure(res, error); }
    });

    taconsRouter.get("/app/:installId/market/wallet", requirePermission("tacons.use"), async (req, res) => {
      try {
        const { entry } = await openApp(req);
        requireMarketEntry(entry);
        const wallet = await ensureWallet(entry.install.id, entry.install.academyId, req.user!.id);
        const transactions = await db.select().from(taconWalletTransactions)
          .where(and(eq(taconWalletTransactions.installId, entry.install.id), eq(taconWalletTransactions.userId, req.user!.id)))
          .orderBy(desc(taconWalletTransactions.createdAt), desc(taconWalletTransactions.id)).limit(40);
        res.json({ wallet: { balance: wallet?.balance ?? 0 }, transactions });
      } catch (error) { recordFailure(res, error); }
    });

    taconsRouter.get("/app/:installId/market/people", requirePermission("tacons.use"), async (req, res) => {
      try {
        const { entry, access } = await openApp(req);
        requireMarketEntry(entry);
        if (!access.mayRead("wallets")) throw new RecordError(403, "Only the Shopkeeper can view learner balances.");
        const circle = await appMessageScope(entry);
        const filters = [eq(users.academyId, entry.install.academyId), eq(users.role, "learner")];
        if (circle !== null) filters.push(inArray(users.studioId, circle));
        const people = await db.select({ id: users.id, name: users.name, studioId: users.studioId }).from(users).where(and(...filters)).orderBy(asc(users.name));
        const balances = await db.select({ userId: taconWallets.userId, balance: taconWallets.balance }).from(taconWallets).where(eq(taconWallets.installId, entry.install.id));
        const byUser = new Map(balances.map((row) => [row.userId, row.balance]));
        res.json({ people: people.map((person) => ({ ...person, balance: byUser.get(person.id) ?? 0 })) });
      } catch (error) { recordFailure(res, error); }
    });

    taconsRouter.post("/app/:installId/market/adjust", requirePermission("tacons.use"), async (req, res) => {
      try {
        const { entry, access } = await openApp(req);
        requireMarketEntry(entry);
        if (!access.mayWrite("wallets")) throw new RecordError(403, "Only the Shopkeeper can add Eagle Bucks.");
        const parsed = adjustmentSchema.safeParse(req.body ?? {});
        if (!parsed.success) throw new RecordError(400, "Enter a learner and a positive whole-number amount.");
        const { userId, amount, reason } = parsed.data;
        const circle = await appMessageScope(entry);
        const [person] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.academyId, entry.install.academyId), eq(users.role, "learner"))).limit(1);
        if (!person || (circle !== null && !circle.includes(person.studioId ?? -1))) throw new RecordError(404, "That learner is not in this studio group.");
        const result = await db.transaction(async (tx) => {
          await tx.insert(taconWallets).values({ installId: entry.install.id, academyId: entry.install.academyId, userId }).onConflictDoNothing();
          const [wallet] = await tx.select().from(taconWallets).where(and(eq(taconWallets.installId, entry.install.id), eq(taconWallets.userId, userId))).for("update").limit(1);
          if (!wallet) throw new RecordError(500, "The wallet could not be opened.");
          const [updated] = await tx.update(taconWallets).set({ balance: wallet.balance + amount, updatedAt: new Date() }).where(eq(taconWallets.id, wallet.id)).returning();
          const [transaction] = await tx.insert(taconWalletTransactions).values({ academyId: entry.install.academyId, installId: entry.install.id, userId, actorUserId: req.user!.id, kind: "credit", amount, balanceAfter: updated.balance, details: { reason } }).returning();
          return { wallet: updated, transaction };
        });
        res.status(201).json(result);
      } catch (error) { recordFailure(res, error); }
    });

    taconsRouter.post("/app/:installId/market/purchase", requirePermission("tacons.use"), async (req, res) => {
      try {
        const { entry } = await openApp(req);
        requireMarketEntry(entry);
        const parsed = purchaseSchema.safeParse(req.body ?? {});
        if (!parsed.success) throw new RecordError(400, "That purchase is not valid.");
        const { items, bundle } = parsed.data;
        const ids = items.map((item) => item.productId);
        if (new Set(ids).size !== ids.length) throw new RecordError(400, "Choose each item only once.");
        if (bundle && (items.length !== 3 || items.some((item) => item.quantity !== 1))) throw new RecordError(400, "A three-item bundle needs three different items.");
        const result = await db.transaction(async (tx) => {
          await tx.insert(taconWallets).values({ installId: entry.install.id, academyId: entry.install.academyId, userId: req.user!.id }).onConflictDoNothing();
          const [wallet] = await tx.select().from(taconWallets).where(and(eq(taconWallets.installId, entry.install.id), eq(taconWallets.userId, req.user!.id))).for("update").limit(1);
          if (!wallet) throw new RecordError(500, "Your wallet could not be opened.");
          const products = await tx.select().from(taconRecords).where(and(eq(taconRecords.installId, entry.install.id), eq(taconRecords.store, "products"), inArray(taconRecords.id, ids))).for("update");
          if (products.length !== ids.length) throw new RecordError(404, "One of those products is no longer available.");
          const lines = items.map((selection) => {
            const row = products.find((product) => product.id === selection.productId)!;
            const data = row.data as Record<string, unknown>;
            const price = Number(data.price);
            const stock = Number(data.quantity);
            if (data.active === false || !Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(stock) || stock < selection.quantity) throw new RecordError(409, "A product is unavailable or has insufficient stock.");
            if (bundle && data.bundleEligible !== true) throw new RecordError(400, "Every bundle item must be marked as bundle eligible.");
            const passUses = data.passUses === undefined ? 0 : Number(data.passUses);
            if (!Number.isInteger(passUses) || passUses < 0 || passUses > 100) throw new RecordError(400, "A product has an invalid pass allowance.");
            return { row, data, productId: row.id, name: String(data.name ?? "Item"), quantity: selection.quantity, unitPrice: price, stock, passUses };
          });
          const total = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
          if (!Number.isSafeInteger(total) || wallet.balance < total) throw new RecordError(409, "Your Eagle Buck balance is too low.");
          for (const line of lines) {
            await tx.update(taconRecords).set({ data: { ...line.data, quantity: line.stock - line.quantity }, updatedAt: new Date() }).where(eq(taconRecords.id, line.productId));
          }
          const balance = wallet.balance - total;
          await tx.update(taconWallets).set({ balance, updatedAt: new Date() }).where(eq(taconWallets.id, wallet.id));
          const details = { bundle, items: lines.map((line) => ({ productId: line.productId, name: line.name, quantity: line.quantity, unitPrice: line.unitPrice })) };
          const [transaction] = await tx.insert(taconWalletTransactions).values({ academyId: entry.install.academyId, installId: entry.install.id, userId: req.user!.id, actorUserId: req.user!.id, kind: "purchase", amount: -total, balanceAfter: balance, details }).returning();
          if (messagePeers(entry).includes("studio-maintenance")) {
            for (const line of lines) {
              const uses = line.passUses * line.quantity;
              if (uses > 0) await tx.insert(taconMessages).values({ academyId: entry.install.academyId, sourceInstallId: entry.install.id, sourceStudioId: entry.install.studioId, targetSlug: "studio-maintenance", kind: "pass-issued", payload: { learnerId: req.user!.id, uses, purchaseId: transaction.id, productName: line.name }, createdBy: req.user!.id });
            }
          }
          return { wallet: { balance }, transaction };
        });
        res.status(201).json(result);
      } catch (error) { recordFailure(res, error); }
    });

    taconsRouter.get("/app/:installId/messages", requirePermission("tacons.use"), async (req, res) => {
      try {
        const { entry, access } = await openApp(req);
        if (!access.mayRead("messages")) throw new RecordError(403, "This Tac-On can't read messages.");
        const peers = messagePeers(entry);
        if (!peers.length) return res.json({ messages: [] });
        const peer = typeof req.query.from === "string" ? req.query.from : undefined;
        const sentTo = typeof req.query.to === "string" ? req.query.to : undefined;
        if (peer && sentTo) throw new RecordError(400, "Choose incoming or sent messages, not both.");
        if (sentTo && !peers.includes(sentTo)) throw new RecordError(403, "That Tac-On is not a declared message partner.");
        if (sentTo) {
          const sent = await db.select().from(taconMessages).where(and(eq(taconMessages.academyId, entry.install.academyId), eq(taconMessages.sourceInstallId, entry.install.id), eq(taconMessages.targetSlug, sentTo)))
            .orderBy(desc(taconMessages.createdAt), desc(taconMessages.id)).limit(200);
          return res.json({ messages: sent.map((message) => ({ ...message, sourceSlug: entry.tacon.slug })) });
        }
        if (peer && !peers.includes(peer)) throw new RecordError(403, "That Tac-On is not a declared message partner.");
        const circle = await appMessageScope(entry);
        const filters = [eq(taconMessages.academyId, entry.install.academyId), eq(taconMessages.targetSlug, entry.tacon.slug), inArray(tacons.slug, peer ? [peer] : peers)];
        if (circle !== null) filters.push(circle.length ? or(inArray(taconMessages.sourceStudioId, circle), isNull(taconMessages.sourceStudioId))! : isNull(taconMessages.sourceStudioId));
        const rows = await db.select({ message: taconMessages, sourceSlug: tacons.slug }).from(taconMessages)
          .innerJoin(taconInstalls, eq(taconInstalls.id, taconMessages.sourceInstallId))
          .innerJoin(tacons, eq(tacons.id, taconInstalls.taconId))
          .where(and(...filters)).orderBy(desc(taconMessages.createdAt), desc(taconMessages.id)).limit(200);
        res.json({ messages: rows.map((row) => ({ ...row.message, sourceSlug: row.sourceSlug })) });
      } catch (error) { recordFailure(res, error); }
    });

    taconsRouter.post("/app/:installId/messages", requirePermission("tacons.use"), async (req, res) => {
      try {
        const { entry, access } = await openApp(req);
        if (!access.mayWrite("messages")) throw new RecordError(403, "This Tac-On can't send messages.");
        const parsed = messageSchema.safeParse(req.body ?? {});
        if (!parsed.success) throw new RecordError(400, "That message is not valid.");
        const { to, kind, payload } = parsed.data;
        if (!messagePeers(entry).includes(to)) throw new RecordError(403, "That Tac-On is not a declared message partner.");
        if (Buffer.byteLength(JSON.stringify(payload), "utf8") > 8000) throw new RecordError(413, "That message is too large.");
        if (kind === "pass-redeemed" && (entry.tacon.slug !== "studio-maintenance" || to !== "eagle-buck-market")) throw new RecordError(403, "Only Studio Maintenance can redeem a Market pass.");
        const circle = await appMessageScope(entry);
        const saved = await db.transaction(async (tx) => {
          if (kind === "pass-redeemed") {
            const grantId = Number(payload.grantId);
            const learnerId = Number(payload.learnerId);
            if (!Number.isInteger(grantId) || !Number.isInteger(learnerId)) throw new RecordError(400, "The pass reference is incomplete.");
            const [grant] = await tx.select().from(taconMessages).where(and(eq(taconMessages.id, grantId), eq(taconMessages.academyId, entry.install.academyId), eq(taconMessages.targetSlug, "studio-maintenance"), eq(taconMessages.kind, "pass-issued"))).for("update").limit(1);
            if (!grant || Number(grant.payload.learnerId) !== learnerId || (grant.sourceStudioId !== null && circle !== null && !circle.includes(grant.sourceStudioId))) throw new RecordError(404, "That pass is not available to this studio group.");
            const [source] = await tx.select({ slug: tacons.slug }).from(taconInstalls).innerJoin(tacons, eq(tacons.id, taconInstalls.taconId)).where(eq(taconInstalls.id, grant.sourceInstallId)).limit(1);
            if (source?.slug !== "eagle-buck-market") throw new RecordError(404, "That pass did not come from Eagle Buck Market.");
            const usesAllowed = Number(grant.payload.uses);
            if (!Number.isInteger(usesAllowed) || usesAllowed < 1) throw new RecordError(400, "That pass has no valid uses.");
            const previous = await tx.select({ payload: taconMessages.payload }).from(taconMessages).where(and(eq(taconMessages.academyId, entry.install.academyId), eq(taconMessages.targetSlug, "eagle-buck-market"), eq(taconMessages.kind, "pass-redeemed")));
            const used = previous.filter((row) => Number(row.payload.grantId) === grantId).length;
            if (used >= usesAllowed) throw new RecordError(409, "All uses on this pass have already been used.");
          }
          const [message] = await tx.insert(taconMessages).values({ academyId: entry.install.academyId, sourceInstallId: entry.install.id, sourceStudioId: entry.install.studioId, targetSlug: to, kind, payload, createdBy: req.user!.id }).returning();
          return message;
        });
        res.status(201).json({ message: saved });
      } catch (error) { recordFailure(res, error); }
    });

    /* -------------------------------------------------------------------------- */
/*  The market                                                                 */
/* -------------------------------------------------------------------------- */

taconsRouter.get("/market", requirePermission("tacons.market"), async (req, res) => {
  const academyId = req.user!.academyId;
  const listings = await marketListings(academyId, true);
  const installs = await db
    .select()
    .from(taconInstalls)
    .where(eq(taconInstalls.academyId, academyId));

  res.json({
    tacons: listings.map((row) => {
      const mine = installs.filter((install) => install.taconId === row.tacon.id);
      return {
        id: row.tacon.id,
        slug: row.tacon.slug,
        name: row.tacon.name,
        tagline: row.tacon.tagline,
        icon: row.tacon.icon,
        category: row.tacon.category,
        official: row.tacon.official,
        authorName: row.tacon.authorName,
        authorHandle: row.authorHandle,
        visibility: row.tacon.visibility,
        installCount: row.tacon.installCount,
        version: row.version?.version ?? null,
        suspended: Boolean(row.tacon.suspendedReason),
        mine: row.tacon.academyId === academyId,
        installs: mine.length,
        updatedAt: row.tacon.updatedAt,
      };
    }),
  });
});

taconsRouter.get("/market/:slug", requirePermission("tacons.market"), async (req, res) => {
  const academyId = req.user!.academyId;
  const [tacon] = await db.select().from(tacons).where(eq(tacons.slug, req.params.slug)).limit(1);
  if (!tacon) return res.status(404).json({ error: "No Tac-On by that name." });
  if (tacon.visibility === "draft" && tacon.academyId !== academyId) {
    return res.status(404).json({ error: "No Tac-On by that name." });
  }

  const versions = await db
    .select()
    .from(taconVersions)
    .where(eq(taconVersions.taconId, tacon.id))
    .orderBy(desc(taconVersions.createdAt));

  const latest = versions.find((version) => version.id === tacon.latestVersionId) ?? versions[0];
  const manifest = latest ? readManifest(latest) : null;

  const installs = await db
    .select({ install: taconInstalls, studioName: studios.name, groupName: studioGroups.name })
    .from(taconInstalls)
    .leftJoin(studios, eq(studios.id, taconInstalls.studioId))
    .leftJoin(studioGroups, eq(studioGroups.id, taconInstalls.groupId))
    .where(and(eq(taconInstalls.academyId, academyId), eq(taconInstalls.taconId, tacon.id)));

  const [author] = tacon.authorUserId
    ? await db.select().from(users).where(eq(users.id, tacon.authorUserId)).limit(1)
    : [null];

  res.json({
    tacon: {
      ...tacon,
      authorHandle: author?.devHandle ?? null,
      mine: tacon.academyId === academyId,
    },
    manifest,
    source: latest?.source ?? "",
    versions: versions.map((version) => ({
      id: version.id,
      version: version.version,
      changelog: version.changelog,
      status: version.status,
      createdAt: version.createdAt,
    })),
    installs: installs.map((row) => ({
      id: row.install.id,
      studioId: row.install.studioId,
      studioName: row.studioName,
      groupName: row.groupName,
      enabled: row.install.enabled,
      versionId: row.install.versionId,
      settings: row.install.settings,
      display: displayModeOf(row.install),
      updateAvailable: row.install.versionId !== tacon.latestVersionId,
    })),
  });
});

/* -------------------------------------------------------------------------- */
/*  Installing                                                                 */
/* -------------------------------------------------------------------------- */

const installSchema = z.object({
  /** Omit for the studio being viewed; null installs it academy-wide. */
  studioId: z.number().int().nullable().optional(),
  /** Install one shared copy and record set for this whole Studio Group. */
  groupId: z.number().int().positive().optional(),
  settings: z.record(z.unknown()).default({}),
  /** Which optional setup actions the admin left ticked: ids or indexes. Omit for each one's default. */
  setupSelection: z.array(z.union([z.string().max(60), z.number().int().min(0)])).max(30).optional(),
  setup_selection: z.array(z.union([z.string().max(60), z.number().int().min(0)])).max(30).optional(),
}).refine((body) => !(body.groupId !== undefined && body.studioId !== undefined), {
  message: "Choose a studio or a Studio Group, not both.",
});

/** Settings an admin sends never include Eagle Bot's own `__` keys. */
function adminSettings(settings: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(settings).filter(([key]) => !key.startsWith("__")));
}

taconsRouter.post("/market/:slug/install", requirePermission("tacons.install"), async (req, res) => {
  const parsed = installSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Couldn't read that." });

  const academyId = req.user!.academyId;
  const [tacon] = await db.select().from(tacons).where(eq(tacons.slug, req.params.slug)).limit(1);
  if (!tacon || !tacon.latestVersionId) {
    return res.status(404).json({ error: "That Tac-On has nothing published yet." });
  }
  if (tacon.suspendedReason) {
    return res.status(409).json({
      error: `This Tac-On has been pulled from the market: ${tacon.suspendedReason}`,
    });
  }
  if (tacon.visibility === "draft" && tacon.academyId !== academyId) {
    return res.status(404).json({ error: "No Tac-On by that name." });
  }

  const [version] = await db
    .select()
    .from(taconVersions)
    .where(eq(taconVersions.id, tacon.latestVersionId))
    .limit(1);
  const manifest = version ? readManifest(version) : null;

  const scope = requireScope(req);
  let studioId: number | null;
  let visibility: "academy" | "studio" | "group";
  let groupId: number | null = null;
  let targetGroupId: number | null = null;
  let targetStudioIds: number[] = [];
  try {
    if (parsed.data.groupId !== undefined) {
      const [selectedGroup] = await db
        .select()
        .from(studioGroups)
        .where(and(eq(studioGroups.id, parsed.data.groupId), eq(studioGroups.academyId, academyId)))
        .limit(1);
      if (!selectedGroup) return res.status(404).json({ error: "That Studio Group doesn't exist." });
      const members = await db
        .select({ id: studios.id })
        .from(studios)
        .where(and(eq(studios.academyId, academyId), eq(studios.groupId, selectedGroup.id), eq(studios.archived, false)))
        .orderBy(asc(studios.orderIndex), asc(studios.id));
      targetStudioIds = members.map((member) => member.id);
      if (targetStudioIds.length === 0) return res.status(400).json({ error: "That Studio Group has no active studios." });
      if (targetStudioIds.some((id) => !scope.allowedIds.includes(id))) {
        return res.status(403).json({ error: "You can't install into every studio in that group." });
      }
      visibility = "group";
      groupId = selectedGroup.id;
      targetGroupId = selectedGroup.id;
      const anchor = scope.studioId !== null && targetStudioIds.includes(scope.studioId) ? scope.studioId : targetStudioIds[0];
      studioId = writeStudioId(scope, anchor);
    } else {
      // A Tac-On installed academy-wide appears in every studio, which is a
      // bigger decision than it looks - so the same rule as everything else
      // applies: only an admin makes it, and only deliberately.
      studioId = writeStudioId(scope, parsed.data.studioId);
      visibility = studioId === null ? "academy" : "studio";
      if (studioId !== null) {
        const [targetStudio] = await db
          .select({ groupId: studios.groupId })
          .from(studios)
          .where(and(eq(studios.id, studioId), eq(studios.academyId, academyId)))
          .limit(1);
        targetGroupId = targetStudio?.groupId ?? null;
        if (targetGroupId !== null) {
          const members = await db
            .select({ id: studios.id })
            .from(studios)
            .where(and(eq(studios.academyId, academyId), eq(studios.groupId, targetGroupId), eq(studios.archived, false)));
          targetStudioIds = members.map((member) => member.id);
        } else {
          targetStudioIds = [studioId];
        }
      }
    }
  } catch (error) {
    if (error instanceof StudioChoiceError) {
      return res.status(400).json({ error: error.message, needsStudio: true });
    }
    throw error;
  }
  const result = await db.transaction(async (tx) => {
    if (targetGroupId !== null) {
      await tx.select({ id: studioGroups.id }).from(studioGroups).where(eq(studioGroups.id, targetGroupId)).for("update");
    }
    const existingRows = await tx
      .select()
      .from(taconInstalls)
      .where(and(eq(taconInstalls.academyId, academyId), eq(taconInstalls.taconId, tacon.id)))
      .for("update");
    const existing = existingRows.find((candidate) => {
      if (visibility === "academy" || candidate.visibility === "academy" || (candidate.visibility === "legacy" && candidate.studioId === null)) return true;
      if (visibility === "group") {
        if (candidate.visibility === "group" && candidate.groupId === groupId) return true;
        return candidate.studioId !== null && targetStudioIds.includes(candidate.studioId);
      }
      if (candidate.visibility === "group") {
        return candidate.groupId !== null ? candidate.groupId === targetGroupId : candidate.studioId === studioId;
      }
      if (candidate.visibility === "legacy") return candidate.studioId !== null && targetStudioIds.includes(candidate.studioId);
      return candidate.studioId === studioId;
    });
    if (existing) return { existing, install: null };
    const [install] = await tx
      .insert(taconInstalls)
      .values({
        academyId,
        studioId,
        visibility,
        groupId,
        taconId: tacon.id,
        versionId: tacon.latestVersionId!,
        settings: adminSettings(parsed.data.settings as Record<string, unknown>),
        installedBy: req.user!.id,
      })
      .returning();
    return { existing: null, install };
  });
  if (result.existing) {
    return res.status(409).json({ error: `${tacon.name} is already installed here.` });
  }
  const install = result.install!;

  await db
    .update(tacons)
    .set({
      installCount: tacon.installCount + 1,
      activeInstalls: tacon.activeInstalls + 1,
    })
    .where(eq(tacons.id, tacon.id));

  // Positions the Tac-On declares go onto the Positions page now, in the studio
  // it was installed into.
  if (manifest) {
    await syncPositions({ install, taconName: tacon.name, manifest, actorUserId: req.user!.id });
  }
  // An app's setup: positions, wiki sections, how it opens - as the admin answered.
  const setupResults = manifest?.app
    ? await runSetup({
        install,
        manifest,
        taconName: tacon.name,
        actorUserId: req.user!.id,
        selection: parsed.data.setupSelection ?? parsed.data.setup_selection,
      })
    : [];

  await logActivity({
    academyId,
    studioId,
    actorUserId: req.user!.id,
    action: "tacon.installed",
    entityType: "tacon",
    entityId: install.id,
    summary: `${req.user!.name} installed the Tac-On "${tacon.name}".`,
    metadata: { slug: tacon.slug },
  });

  res.status(201).json({ install, setup_results: setupResults });
});

const installPatchSchema = z.object({
  enabled: z.boolean().optional(),
  settings: z.record(z.unknown()).optional(),
});

taconsRouter.patch("/installs/:id", requirePermission("tacons.install"), async (req, res) => {
  const parsed = installPatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Couldn't read that." });

  const entry = await loadInstall(req.user!.academyId, Number(req.params.id), req.scope);
  if (!entry) return res.status(404).json({ error: "That isn't installed here." });

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
  if (parsed.data.settings !== undefined) {
    // Eagle Bot's own keys (how an app opens, its setup answers) survive an admin's edit.
    const kept = Object.fromEntries(
      Object.entries(entry.install.settings ?? {}).filter(([key]) => key.startsWith("__")),
    );
    patch.settings = { ...adminSettings(parsed.data.settings), ...kept };
  }

  const [install] = await db
    .update(taconInstalls)
    .set(patch)
    .where(eq(taconInstalls.id, entry.install.id))
    .returning();

  // A Tac-On that is off has no positions to hold; its holders come back with it.
  if (parsed.data.enabled !== undefined && parsed.data.enabled !== entry.install.enabled) {
    await setPositionsArchived(install, entry.manifest, !parsed.data.enabled);
  }

  res.json({ install });
});

/** Takes an install to the Tac-On's latest published version. */
taconsRouter.post("/installs/:id/update", requirePermission("tacons.install"), async (req, res) => {
  const entry = await loadInstall(req.user!.academyId, Number(req.params.id), req.scope);
  if (!entry) return res.status(404).json({ error: "That isn't installed here." });
  if (!entry.tacon.latestVersionId || entry.tacon.latestVersionId === entry.install.versionId) {
    return res.status(409).json({ error: "This is already the latest version." });
  }

  const [version] = await db
    .select()
    .from(taconVersions)
    .where(eq(taconVersions.id, entry.tacon.latestVersionId))
    .limit(1);
  if (!version) return res.status(409).json({ error: "There's no newer version to move to." });
  const nextManifest = readManifest(version);

  const [updated] = await db
    .update(taconInstalls)
    .set({ versionId: version.id, updatedAt: new Date() })
    .where(eq(taconInstalls.id, entry.install.id))
    .returning();

  const manifest = nextManifest;
  if (manifest) {
    await syncPositions({
      install: updated,
      taconName: entry.tacon.name,
      manifest,
      actorUserId: req.user!.id,
    });
  }
  // Setup runs again with the answers given last time. A TacScript Tac-On
  // moving to its app keeps every record it saved (same install), and a setup
  // position with an old position's title takes it over, holders and all.
  const setupResults = manifest?.app
    ? await runSetup({ install: updated, manifest, taconName: entry.tacon.name, actorUserId: req.user!.id })
    : [];

  await logActivity({
    academyId: req.user!.academyId,
    studioId: entry.install.studioId,
    actorUserId: req.user!.id,
    action: "tacon.updated",
    entityType: "tacon",
    entityId: entry.install.id,
    summary: `${req.user!.name} updated "${entry.tacon.name}" to ${version.version}.`,
  });

  res.json({ ok: true, version: version.version, setup_results: setupResults });
});

/**
 * The installed version as a package file another academy can install. Only
 * apps export; a TacScript version has nothing to hand over but its source.
 */
taconsRouter.get("/installs/:id/export", requirePermission("tacons.install"), async (req, res) => {
  const entry = await loadInstall(req.user!.academyId, Number(req.params.id), req.scope);
  if (!entry) return res.status(404).json({ error: "That isn't installed here." });
  const pkg = packageOf(entry.manifest);
  if (!pkg) return res.status(409).json({ error: "This version was written in TacScript, so there's no app to export." });
  res.json({ file: `${pkg.manifest.name}-${pkg.manifest.version}${APP_FILE_EXTENSION}`, package: pkg });
});

taconsRouter.delete("/installs/:id", requirePermission("tacons.install"), async (req, res) => {
  const entry = await loadInstall(req.user!.academyId, Number(req.params.id), req.scope);
  if (!entry) return res.status(404).json({ error: "That isn't installed here." });

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(taconRecords)
    .where(eq(taconRecords.installId, entry.install.id));

  // Its positions are archived, not deleted: who held them is the studio's
  // history, not the Tac-On's.
  const archivedPositions = await setPositionsArchived(entry.install, entry.manifest, true);

  // Uninstalling takes the Tac-On's rows with it, so the count goes in the log
  // where an admin can find it afterwards.
  await db.delete(taconInstalls).where(eq(taconInstalls.id, entry.install.id));
  await db
    .update(tacons)
    .set({ activeInstalls: Math.max(0, entry.tacon.activeInstalls - 1) })
    .where(eq(tacons.id, entry.tacon.id));

  await logActivity({
    academyId: req.user!.academyId,
    studioId: entry.install.studioId,
    actorUserId: req.user!.id,
    action: "tacon.uninstalled",
    entityType: "tacon",
    entityId: entry.tacon.id,
    summary: `${req.user!.name} removed "${entry.tacon.name}" and its ${Number(total)} saved row${Number(total) === 1 ? "" : "s"}${archivedPositions ? `, and archived the ${archivedPositions} position${archivedPositions === 1 ? "" : "s"} it added` : ""}.`,
    metadata: { slug: entry.tacon.slug, records: Number(total), archivedPositions },
  });

  res.json({ ok: true, removedRecords: Number(total), archivedPositions });
});

/* -------------------------------------------------------------------------- */
/*  Dev status                                                                 */
/* -------------------------------------------------------------------------- */

function handleFrom(name: string, id: number): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return `${base || "dev"}-${id}`;
}

const grantSchema = z.object({ userId: z.number().int(), enabled: z.boolean() });

taconsRouter.post("/devs/grant", requirePermission("tacons.grant_dev"), async (req, res) => {
  const parsed = grantSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Pick a person." });

  const [person] = await db.select().from(users).where(eq(users.id, parsed.data.userId)).limit(1);
  if (!person || person.academyId !== req.user!.academyId) {
    return res.status(404).json({ error: "That person isn't in this academy." });
  }

  const [updated] = await db
    .update(users)
    .set({
      devStatus: parsed.data.enabled,
      // The handle is kept when dev status is taken away: their published
      // Tac-Ons still point at a profile, and breaking those links would
      // punish the studio for one person's bad week.
      devHandle: parsed.data.enabled ? (person.devHandle ?? handleFrom(person.name, person.id)) : person.devHandle,
      devSince: parsed.data.enabled ? (person.devSince ?? new Date()) : person.devSince,
    })
    .where(eq(users.id, person.id))
    .returning();

  await logActivity({
    academyId: req.user!.academyId,
    studioId: person.studioId,
    actorUserId: req.user!.id,
    action: parsed.data.enabled ? "tacon.dev_granted" : "tacon.dev_revoked",
    entityType: "user",
    entityId: person.id,
    summary: parsed.data.enabled
      ? `${req.user!.name} gave ${person.name} dev status.`
      : `${req.user!.name} removed ${person.name}'s dev status.`,
  });

  res.json({ user: { id: updated.id, devStatus: updated.devStatus, devHandle: updated.devHandle } });
});

/** A dev's global profile - the part of them that travels between academies. */
taconsRouter.get("/devs/:handle", requireAuth, async (req, res) => {
  const [person] = await db
    .select()
    .from(users)
    .where(eq(users.devHandle, req.params.handle))
    .limit(1);
  if (!person) return res.status(404).json({ error: "No dev by that handle." });

  const [studio] = person.studioId
    ? await db.select().from(studios).where(eq(studios.id, person.studioId)).limit(1)
    : [null];

  const published = await db
    .select({ tacon: tacons, version: taconVersions })
    .from(tacons)
    .leftJoin(taconVersions, eq(taconVersions.id, tacons.latestVersionId))
    .where(and(eq(tacons.authorUserId, person.id), eq(tacons.visibility, "public")))
    .orderBy(desc(tacons.installCount));

  res.json({
    dev: {
      handle: person.devHandle,
      name: person.name,
      bio: person.bio,
      avatarUrl: person.avatarUrl,
      nga: person.nga,
      devSince: person.devSince,
      active: person.devStatus,
      homeStudio: studio?.name ?? null,
    },
    tacons: published.map((row) => ({
      slug: row.tacon.slug,
      name: row.tacon.name,
      tagline: row.tacon.tagline,
      icon: row.tacon.icon,
      installCount: row.tacon.installCount,
      version: row.version?.version ?? null,
    })),
    totals: {
      published: published.length,
      installs: published.reduce((total, row) => total + row.tacon.installCount, 0),
    },
  });
});

/* -------------------------------------------------------------------------- */
/*  The dev menu                                                               */
/* -------------------------------------------------------------------------- */

/** Checks an app package without saving: the same checklist publishing uses. */
taconsRouter.post("/dev/check", requirePermission("tacons.develop"), async (req, res) => {
  const prepared = prepareApp(req.body?.app);
  res.json({ ok: prepared.ok, checks: prepared.checks, error: prepared.ok ? null : prepared.error });
});

taconsRouter.get("/dev/mine", requirePermission("tacons.develop"), async (req, res) => {
  const mine = await db
    .select({ tacon: tacons, version: taconVersions })
    .from(tacons)
    .leftJoin(taconVersions, eq(taconVersions.id, tacons.latestVersionId))
    .where(eq(tacons.authorUserId, req.user!.id))
    .orderBy(desc(tacons.updatedAt));

  const ids = mine.map((row) => row.tacon.id);
  const installs = ids.length
    ? await db
        .select({
          taconId: taconInstalls.taconId,
          academyId: taconInstalls.academyId,
          versionId: taconInstalls.versionId,
          installedAt: taconInstalls.installedAt,
          enabled: taconInstalls.enabled,
        })
        .from(taconInstalls)
        .where(inArray(taconInstalls.taconId, ids))
    : [];

  res.json({
    tacons: mine.map((row) => {
      const own = installs.filter((install) => install.taconId === row.tacon.id);
      return {
        id: row.tacon.id,
        slug: row.tacon.slug,
        name: row.tacon.name,
        tagline: row.tacon.tagline,
        description: row.tacon.description,
        icon: row.tacon.icon,
        category: row.tacon.category,
        visibility: row.tacon.visibility,
        official: row.tacon.official,
        suspendedReason: row.tacon.suspendedReason,
        installCount: row.tacon.installCount,
        version: row.version?.version ?? null,
        // The latest version as a package, to start the next one from. Null
        // for a Tac-On last published in TacScript.
        app: row.version ? packageOf(row.version.manifest as unknown as Manifest) : null,
        legacySource: row.version && !(row.version.manifest as unknown as Manifest).app ? row.version.source : null,
        updatedAt: row.tacon.updatedAt,
        stats: {
          /** Installs still in place, across every academy on this Eagle Bot. */
          active: own.filter((install) => install.enabled).length,
          /** How many of those are running the newest version. */
          onLatest: own.filter((install) => install.versionId === row.tacon.latestVersionId).length,
          academies: new Set(own.map((install) => install.academyId)).size,
          lastInstalledAt:
            own.map((install) => install.installedAt).sort((a, b) => b.getTime() - a.getTime())[0] ??
            null,
        },
      };
    }),
  });
});

const publishSchema = z.object({
  app: appBodySchema.optional(),
  /** TacScript. Only here to say it's retired. */
  source: z.string().optional(),
  tagline: z.string().max(200).optional(),
  description: z.string().max(20_000).optional(),
  changelog: z.string().max(2000).optional(),
  visibility: z.enum(TACON_VISIBILITIES).optional(),
});

/**
 * Publishes a Tac-On, or a new version of one.
 *
 * The slug in the source decides which Tac-On this is. A dev can only ever
 * publish over their own, and the version has to have moved - a silent
 * overwrite of a version an academy is already running is the one thing a
 * market must never allow.
 */
taconsRouter.post("/dev/publish", requirePermission("tacons.develop"), async (req, res) => {
  const parsed = publishSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the form." });
  }

  if (!parsed.data.app) return res.status(400).json({ error: TACSCRIPT_RETIRED });
  const prepared = prepareApp(parsed.data.app);
  if (!prepared.ok) return res.status(400).json({ error: prepared.error, checks: prepared.checks });
  const manifest: Manifest = prepared.manifest;

  const [existing] = await db.select().from(tacons).where(eq(tacons.slug, manifest.slug)).limit(1);
  if (existing && existing.authorUserId !== req.user!.id) {
    return res.status(409).json({
      error: `The name "${manifest.slug}" is taken by another dev. Pick a different one.`,
    });
  }
  if (existing?.suspendedReason) {
    return res.status(409).json({ error: `This Tac-On is suspended: ${existing.suspendedReason}` });
  }

  let tacon = existing;
  if (!tacon) {
    const [created] = await db
      .insert(tacons)
      .values({
        slug: manifest.slug,
        name: manifest.name,
        tagline: parsed.data.tagline ?? manifest.about.slice(0, 200),
        description: parsed.data.description ?? "",
        icon: manifest.icon,
        category: manifest.category,
        academyId: req.user!.academyId,
        authorUserId: req.user!.id,
        authorName: req.user!.name,
        visibility: parsed.data.visibility ?? "draft",
      })
      .returning();
    tacon = created;
  }

  const [clash] = await db
    .select()
    .from(taconVersions)
    .where(and(eq(taconVersions.taconId, tacon.id), eq(taconVersions.version, manifest.version)))
    .limit(1);
  if (clash) {
    return res.status(409).json({
      error: `Version ${manifest.version} is already published. Raise "version" in manifest.json before publishing again.`,
    });
  }

  const [version] = await db
    .insert(taconVersions)
    .values({
      taconId: tacon.id,
      version: manifest.version,
      source: prepared.source,
      manifest: manifest as unknown as Record<string, unknown>,
      changelog: parsed.data.changelog ?? null,
      publishedByUserId: req.user!.id,
    })
    .returning();

  await db
    .update(tacons)
    .set({
      name: manifest.name,
      icon: manifest.icon,
      category: manifest.category,
      latestVersionId: version.id,
      tagline: parsed.data.tagline ?? tacon.tagline ?? manifest.about.slice(0, 200),
      description: parsed.data.description ?? tacon.description,
      visibility: parsed.data.visibility ?? tacon.visibility,
      updatedAt: new Date(),
    })
    .where(eq(tacons.id, tacon.id));

  await logActivity({
    academyId: req.user!.academyId,
    studioId: req.user!.studioId,
    actorUserId: req.user!.id,
    action: "tacon.published",
    entityType: "tacon",
    entityId: tacon.id,
    summary: `${req.user!.name} published ${manifest.name} ${manifest.version}.`,
    metadata: { slug: manifest.slug, version: manifest.version },
  });

  res.status(201).json({
    tacon: { id: tacon.id, slug: tacon.slug },
    version: { id: version.id, version: version.version },
    checks: prepared.checks,
  });
});

const listingSchema = z.object({
  tagline: z.string().max(200).optional(),
  description: z.string().max(20_000).optional(),
  visibility: z.enum(TACON_VISIBILITIES).optional(),
});

/** The listing, as opposed to the code: blurb, description, who can see it. */
taconsRouter.patch("/dev/:id", requirePermission("tacons.develop"), async (req, res) => {
  const parsed = listingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Couldn't save that." });

  const [tacon] = await db.select().from(tacons).where(eq(tacons.id, Number(req.params.id))).limit(1);
  if (!tacon || tacon.authorUserId !== req.user!.id) {
    return res.status(404).json({ error: "That isn't one of yours." });
  }

  const [updated] = await db
    .update(tacons)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(tacons.id, tacon.id))
    .returning();

  res.json({ tacon: updated });
});

/** Version history and who is running what. The dev's statistics page. */
taconsRouter.get("/dev/:id/stats", requirePermission("tacons.develop"), async (req, res) => {
  const [tacon] = await db.select().from(tacons).where(eq(tacons.id, Number(req.params.id))).limit(1);
  if (!tacon || tacon.authorUserId !== req.user!.id) {
    return res.status(404).json({ error: "That isn't one of yours." });
  }

  const versions = await db
    .select()
    .from(taconVersions)
    .where(eq(taconVersions.taconId, tacon.id))
    .orderBy(desc(taconVersions.createdAt));

  const installs = await db
    .select()
    .from(taconInstalls)
    .where(eq(taconInstalls.taconId, tacon.id))
    .orderBy(asc(taconInstalls.installedAt));

  res.json({
    tacon: { id: tacon.id, slug: tacon.slug, name: tacon.name, installCount: tacon.installCount },
    versions: versions.map((version) => ({
      id: version.id,
      version: version.version,
      changelog: version.changelog,
      createdAt: version.createdAt,
      running: installs.filter((install) => install.versionId === version.id).length,
    })),
    installs: {
      total: installs.length,
      enabled: installs.filter((install) => install.enabled).length,
      academies: new Set(installs.map((install) => install.academyId)).size,
      /** One point per day, for the little chart on the stats page. */
      timeline: timeline(installs.map((install) => install.installedAt)),
    },
  });
});

function timeline(dates: Date[]): { day: string; installs: number }[] {
  const byDay = new Map<string, number>();
  for (const date of dates) {
    const day = date.toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, installs]) => ({ day, installs }));
}
