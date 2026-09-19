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
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  TACON_VISIBILITIES,
  studios,
  taconInstalls,
  taconRecords,
  taconVersions,
  tacons,
  users,
} from "@shared/schema";
import { requireAuth, requirePermission } from "../auth";
import { logActivity } from "../activity";
import { requireScope, writeStudioId, StudioChoiceError } from "../studio";
import { compile, type Manifest, type PageDef, type PanelDef, type Widget } from "@shared/tacons";
import type { TaconNavEntry, TaconPanelView, TaconView } from "@shared/tacons/view";
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
  renderPage,
  renderPanel,
  runActions,
} from "../tacons/runtime";

export const taconsRouter = Router();

/* -------------------------------------------------------------------------- */
/*  What this academy is running                                               */
/* -------------------------------------------------------------------------- */

/** The sidebar entries installed Tac-Ons contribute, for the current studio. */
taconsRouter.get("/nav", requirePermission("tacons.use"), async (req, res) => {
  const installs = await visibleInstalls(req.user!.academyId, req.scope);
  const entries: TaconNavEntry[] = [];

  for (const entry of installs) {
    for (const page of entry.manifest.pages) {
      if (!page.nav) continue;
      if (!audienceAllows(page.showTo, req.user!)) continue;
      entries.push({
        installId: entry.install.id,
        page: page.name,
        label: page.title,
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
  const panels: TaconPanelView[] = [];

  for (const entry of installs) {
    const matching = entry.manifest.panels.filter(
      (panel) => panel.host === host && audienceAllows(panel.showTo, req.user!),
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
      panels.push(await renderPanel(runtime, panel));
    }
  }

  res.json({ panels });
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
  if (!audienceAllows(page.showTo, req.user!)) {
    return res.status(403).json({ error: "This page isn't open to your role." });
  }

  const runtime = await buildRuntime({
    academy: req.academy!,
    settings: req.settings!,
    user: req.user!,
    scope: req.scope,
    install: entry,
  });
  const view: TaconView = await renderPage(runtime, page);
  res.json({ view });
});

/** Finds the widget a submission refers to, in the page or panel it came from. */
function findWidget(
  manifest: Manifest,
  location: { page?: string; panel?: string },
  index: number,
): { widget: Widget; owner: PageDef | PanelDef } | null {
  const owner: PageDef | PanelDef | undefined = location.page
    ? manifest.pages.find((page) => page.name === location.page)
    : manifest.panels.find((panel) => panel.host === location.panel);
  if (!owner) return null;
  const widget = owner.widgets[index];
  return widget ? { widget, owner } : null;
}

const submitSchema = z.object({
  page: z.string().max(60).optional(),
  panel: z.string().max(60).optional(),
  index: z.number().int().min(0).max(200),
  values: z.record(z.unknown()).default({}),
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

  if (!audienceAllows(found.owner.showTo, req.user!) || !audienceAllows(form.allow, req.user!)) {
    return res.status(403).json({ error: "Your role can't add to this." });
  }

  const runtime = await buildRuntime({
    academy: req.academy!,
    settings: req.settings!,
    user: req.user!,
    scope: req.scope,
    install: entry,
  });

  // Only the fields the form actually asked for are accepted, whatever the
  // browser sent. A form is a contract about what gets written.
  const values: Record<string, unknown> = {};
  for (const field of form.fields) values[field.field] = parsed.data.values[field.field];

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
  const parsed = submitSchema.omit({ values: true }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Couldn't read that." });

  const entry = await openInstall(req);
  if (!entry || !entry.install.enabled) {
    return res.status(404).json({ error: "That Tac-On isn't installed here." });
  }

  const found = findWidget(entry.manifest, parsed.data, parsed.data.index);
  if (!found || found.widget.kind !== "button") {
    return res.status(404).json({ error: "That button isn't part of this Tac-On." });
  }
  if (!audienceAllows(found.widget.allow, req.user!)) {
    return res.status(403).json({ error: "Your role can't do that." });
  }

  const runtime = await buildRuntime({
    academy: req.academy!,
    settings: req.settings!,
    user: req.user!,
    scope: req.scope,
    install: entry,
  });
  const result = await runActions(runtime, found.widget.does, {
    actorUserId: req.user!.id,
    studioId: entry.install.studioId,
    reason: "button",
  });

  res.json({ ok: true, ...result });
});

taconsRouter.delete(
  "/view/:installId/records/:recordId",
  requirePermission("tacons.use"),
  async (req, res) => {
    const entry = await openInstall(req);
    if (!entry) return res.status(404).json({ error: "That Tac-On isn't installed here." });

    const [record] = await db
      .select()
      .from(taconRecords)
      .where(
        and(
          eq(taconRecords.id, Number(req.params.recordId)),
          eq(taconRecords.installId, entry.install.id),
        ),
      )
      .limit(1);
    if (!record) return res.status(404).json({ error: "That row is already gone." });

    // Removal is only ever offered by a list that said who may remove, so the
    // permission question is "does any such list exist, for this person?".
    const allowed = [...entry.manifest.pages, ...entry.manifest.panels].some((owner) =>
      audienceAllows(owner.showTo, req.user!) &&
      owner.widgets.some(
        (widget) =>
          widget.kind === "list" &&
          widget.source.kind === "store" &&
          widget.source.store.length === 1 &&
          widget.source.store[0] === record.store &&
          widget.allowRemove.length > 0 &&
          audienceAllows(widget.allowRemove, req.user!),
      ),
    );
    if (!allowed) return res.status(403).json({ error: "Your role can't remove this." });

    await db.delete(taconRecords).where(eq(taconRecords.id, record.id));
    res.json({ ok: true });
  },
);

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
    .select({ install: taconInstalls, studioName: studios.name })
    .from(taconInstalls)
    .leftJoin(studios, eq(studios.id, taconInstalls.studioId))
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
      enabled: row.install.enabled,
      versionId: row.install.versionId,
      settings: row.install.settings,
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
  settings: z.record(z.unknown()).default({}),
});

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

  const scope = requireScope(req);
  let studioId: number | null;
  try {
    // A Tac-On installed academy-wide appears in every studio, which is a
    // bigger decision than it looks - so the same rule as everything else
    // applies: only an admin makes it, and only deliberately.
    studioId = writeStudioId(scope, parsed.data.studioId);
  } catch (error) {
    if (error instanceof StudioChoiceError) {
      return res.status(400).json({ error: error.message, needsStudio: true });
    }
    throw error;
  }

  const [existing] = await db
    .select()
    .from(taconInstalls)
    .where(
      and(
        eq(taconInstalls.academyId, academyId),
        eq(taconInstalls.taconId, tacon.id),
        studioId === null ? sql`${taconInstalls.studioId} is null` : eq(taconInstalls.studioId, studioId),
      ),
    )
    .limit(1);
  if (existing) {
    return res.status(409).json({ error: `${tacon.name} is already installed here.` });
  }

  const [install] = await db
    .insert(taconInstalls)
    .values({
      academyId,
      studioId,
      taconId: tacon.id,
      versionId: tacon.latestVersionId,
      settings: parsed.data.settings as Record<string, unknown>,
      installedBy: req.user!.id,
    })
    .returning();

  await db
    .update(tacons)
    .set({
      installCount: tacon.installCount + 1,
      activeInstalls: tacon.activeInstalls + 1,
    })
    .where(eq(tacons.id, tacon.id));

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

  res.status(201).json({ install });
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
  if (parsed.data.settings !== undefined) patch.settings = parsed.data.settings;

  const [install] = await db
    .update(taconInstalls)
    .set(patch)
    .where(eq(taconInstalls.id, entry.install.id))
    .returning();

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

  await db
    .update(taconInstalls)
    .set({ versionId: version.id, updatedAt: new Date() })
    .where(eq(taconInstalls.id, entry.install.id));

  await logActivity({
    academyId: req.user!.academyId,
    studioId: entry.install.studioId,
    actorUserId: req.user!.id,
    action: "tacon.updated",
    entityType: "tacon",
    entityId: entry.install.id,
    summary: `${req.user!.name} updated "${entry.tacon.name}" to ${version.version}.`,
  });

  res.json({ ok: true, version: version.version });
});

taconsRouter.delete("/installs/:id", requirePermission("tacons.install"), async (req, res) => {
  const entry = await loadInstall(req.user!.academyId, Number(req.params.id), req.scope);
  if (!entry) return res.status(404).json({ error: "That isn't installed here." });

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(taconRecords)
    .where(eq(taconRecords.installId, entry.install.id));

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
    summary: `${req.user!.name} removed "${entry.tacon.name}" and its ${Number(total)} saved row${Number(total) === 1 ? "" : "s"}.`,
    metadata: { slug: entry.tacon.slug, records: Number(total) },
  });

  res.json({ ok: true, removedRecords: Number(total) });
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

/** Compiles without saving. This is what the editor calls as you type. */
taconsRouter.post("/dev/check", requirePermission("tacons.develop"), async (req, res) => {
  const parsed = z.object({ source: z.string().max(200_000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Send the source." });

  const result = compile(parsed.data.source);
  res.json({
    ok: result.ok,
    diagnostics: result.diagnostics,
    manifest: result.manifest,
  });
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
        source: row.version?.source ?? "",
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
  source: z.string().min(10).max(200_000),
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

  const result = compile(parsed.data.source);
  if (!result.ok) {
    return res.status(400).json({
      error: "This Tac-On doesn't compile yet.",
      diagnostics: result.diagnostics,
    });
  }
  const manifest: Manifest = result.manifest;

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
      error: `Version ${manifest.version} is already published. Change the \`version\` line before publishing again.`,
    });
  }

  const [version] = await db
    .insert(taconVersions)
    .values({
      taconId: tacon.id,
      version: manifest.version,
      source: parsed.data.source,
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
    diagnostics: result.diagnostics,
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
