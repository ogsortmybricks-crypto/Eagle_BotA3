/**
 * Which Tac-Ons are running, for whom, and at which version.
 *
 * Everything in the runtime starts here. An install is the unit: one academy
 * (optionally narrowed to one studio) running one version of one Tac-On. A
 * Tac-On that isn't installed has no pages, no storage and no hooks - it is
 * just a listing in the market.
 */

import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../db";
import {
  studios,
  taconInstalls,
  taconVersions,
  tacons,
  users,
  type Tacon,
  type TaconInstall,
  type TaconVersion,
} from "@shared/schema";
import { isManifest, type Manifest } from "@shared/tacons";
import type { StudioScope } from "../studio";

export type LoadedInstall = {
  install: TaconInstall;
  tacon: Tacon;
  version: TaconVersion;
  manifest: Manifest;
  /** The studio it was installed into, if it isn't academy-wide. */
  studioName: string | null;
};

/** A manifest that survived the round trip through JSONB, or null. */
export function readManifest(version: Pick<TaconVersion, "manifest">): Manifest | null {
  return isManifest(version.manifest) ? (version.manifest as unknown as Manifest) : null;
}

/**
 * Every enabled install visible from the current studio.
 *
 * An academy-wide install shows everywhere; a studio install shows only in that
 * studio. Viewing "all studios" shows everything the person is allowed into,
 * which keeps the sidebar honest for an admin switching between Spark and
 * Launchpad - they see both studios' Tac-Ons, labelled.
 */
export async function visibleInstalls(
  academyId: number,
  scope: StudioScope | undefined,
): Promise<LoadedInstall[]> {
  const rows = await db
    .select({ install: taconInstalls, tacon: tacons, version: taconVersions, studioName: studios.name })
    .from(taconInstalls)
    .innerJoin(tacons, eq(tacons.id, taconInstalls.taconId))
    .innerJoin(taconVersions, eq(taconVersions.id, taconInstalls.versionId))
    .leftJoin(studios, eq(studios.id, taconInstalls.studioId))
    .where(and(eq(taconInstalls.academyId, academyId), eq(taconInstalls.enabled, true)))
    .orderBy(desc(taconInstalls.installedAt));

  const allowed = (install: TaconInstall): boolean => {
    if (install.studioId === null) return true;
    if (!scope) return false;
    if (scope.studioId !== null) return install.studioId === scope.studioId;
    return scope.canSeeAll || scope.allowedIds.includes(install.studioId);
  };

  const loaded: LoadedInstall[] = [];
  for (const row of rows) {
    if (!allowed(row.install)) continue;
    const manifest = readManifest(row.version);
    if (!manifest) continue; // A version that can't be read is simply not run.
    loaded.push({
      install: row.install,
      tacon: row.tacon,
      version: row.version,
      manifest,
      studioName: row.studioName ?? null,
    });
  }
  return loaded;
}

/**
 * Every enabled install in an academy, with no viewer and no studio scope.
 *
 * Only for work the Tac-On does on its own behalf - reacting to an event. A
 * request rendering a page must go through `visibleInstalls`, which asks what
 * the person looking is allowed to see; this one deliberately does not, because
 * an event has nobody looking at it and a studio's Tac-On still has to hear
 * about its own studio's election.
 */
export async function allInstalls(academyId: number): Promise<LoadedInstall[]> {
  const rows = await db
    .select({ install: taconInstalls, tacon: tacons, version: taconVersions, studioName: studios.name })
    .from(taconInstalls)
    .innerJoin(tacons, eq(tacons.id, taconInstalls.taconId))
    .innerJoin(taconVersions, eq(taconVersions.id, taconInstalls.versionId))
    .leftJoin(studios, eq(studios.id, taconInstalls.studioId))
    .where(and(eq(taconInstalls.academyId, academyId), eq(taconInstalls.enabled, true)));

  const loaded: LoadedInstall[] = [];
  for (const row of rows) {
    const manifest = readManifest(row.version);
    if (!manifest) continue;
    loaded.push({
      install: row.install,
      tacon: row.tacon,
      version: row.version,
      manifest,
      studioName: row.studioName ?? null,
    });
  }
  return loaded;
}

/** One install, checked against what this person is allowed to see. */
export async function loadInstall(
  academyId: number,
  installId: number,
  scope: StudioScope | undefined,
): Promise<LoadedInstall | null> {
  const [row] = await db
    .select({ install: taconInstalls, tacon: tacons, version: taconVersions, studioName: studios.name })
    .from(taconInstalls)
    .innerJoin(tacons, eq(tacons.id, taconInstalls.taconId))
    .innerJoin(taconVersions, eq(taconVersions.id, taconInstalls.versionId))
    .leftJoin(studios, eq(studios.id, taconInstalls.studioId))
    .where(and(eq(taconInstalls.id, installId), eq(taconInstalls.academyId, academyId)))
    .limit(1);

  if (!row) return null;
  if (row.install.studioId !== null && scope) {
    const reachable =
      scope.canSeeAll || scope.allowedIds.includes(row.install.studioId);
    if (!reachable) return null;
  }
  const manifest = readManifest(row.version);
  if (!manifest) return null;

  return {
    install: row.install,
    tacon: row.tacon,
    version: row.version,
    manifest,
    studioName: row.studioName ?? null,
  };
}

/**
 * The installs a Tac-On may read through `use`.
 *
 * Only installs in the same academy, only Tac-Ons that named the store or value
 * under `provides`, and only ever read. One studio's Tac-On borrowing another
 * studio's ledger is the interesting case, and it stays inside the academy.
 */
export async function resolveUses(
  academyId: number,
  manifest: Manifest,
): Promise<Map<string, LoadedInstall>> {
  const resolved = new Map<string, LoadedInstall>();
  if (manifest.uses.length === 0) return resolved;

  const slugs = manifest.uses.map((use) => use.slug);
  const rows = await db
    .select({ install: taconInstalls, tacon: tacons, version: taconVersions })
    .from(taconInstalls)
    .innerJoin(tacons, eq(tacons.id, taconInstalls.taconId))
    .innerJoin(taconVersions, eq(taconVersions.id, taconInstalls.versionId))
    .where(
      and(
        eq(taconInstalls.academyId, academyId),
        eq(taconInstalls.enabled, true),
        inArray(tacons.slug, slugs),
      ),
    );

  for (const use of manifest.uses) {
    const row = rows.find((entry) => entry.tacon.slug === use.slug);
    if (!row) continue;
    const other = readManifest(row.version);
    if (!other) continue;
    resolved.set(use.alias, {
      install: row.install,
      tacon: row.tacon,
      version: row.version,
      manifest: other,
      studioName: null,
    });
  }
  return resolved;
}

/** Installs of one Tac-On across studios - what the market tile checks. */
export async function installsOf(academyId: number, taconId: number): Promise<TaconInstall[]> {
  return db
    .select()
    .from(taconInstalls)
    .where(and(eq(taconInstalls.academyId, academyId), eq(taconInstalls.taconId, taconId)));
}

/**
 * The Tac-Ons this academy can see in the market: everything public or
 * official, plus its own academy's drafts and unlisted work.
 */
export async function marketListings(academyId: number, includeOwnDrafts: boolean) {
  const visible = includeOwnDrafts
    ? or(eq(tacons.visibility, "public"), eq(tacons.academyId, academyId))
    : or(eq(tacons.visibility, "public"), isNull(tacons.academyId));

  return db
    .select({ tacon: tacons, authorHandle: users.devHandle, version: taconVersions })
    .from(tacons)
    .leftJoin(users, eq(users.id, tacons.authorUserId))
    .leftJoin(taconVersions, eq(taconVersions.id, tacons.latestVersionId))
    .where(visible)
    .orderBy(desc(tacons.official), desc(tacons.installCount), desc(tacons.updatedAt));
}
