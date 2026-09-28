/**
 * The Tac-Ons that ship with Eagle Bot.
 *
 * They exist for three reasons. An empty market teaches nobody anything. An
 * academy that installs one gets something genuinely useful on day one. And a
 * learner opening the dev menu can read the source of a Tac-On they have
 * already seen working, which is how most people start writing their first.
 *
 * They are ordinary Tac-Ons once published: an academy can uninstall them, and
 * a dev can fork the source.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { positions, taconInstalls, taconRecords, taconVersions, tacons } from "@shared/schema";
import { compile, type Manifest } from "@shared/tacons";

type Starter = {
  slug: string;
  tagline: string;
  description: string;
  category: string;
  /** What changed in the version `source` declares. */
  changelog: string;
  source: string;
};

/**
 * Official Tac-Ons that used to ship and no longer do.
 *
 * Kept as a list rather than quietly dropped, because removing a Tac-On from
 * `STARTERS` is not enough on a server that already seeded it - the listing,
 * its installs and the rows those installs recorded are all still there. The
 * seeder deletes them by slug, once, and says how much it deleted.
 */
export const RETIRED_STARTER_SLUGS = [
  "hero-bucks",
  "quest-board",
  "gratitude-wall",
  "buck-shop",
] as const;

export const STARTERS: Starter[] = [];

/**
 * Publishes the starters and deletes the retired ones.
 *
 * Runs every boot and is idempotent. A starter already in the market gets a new
 * version only when its source declares one that isn't published yet - never
 * an overwrite - and academies running it are offered the update like any
 * other. Anything that fails to compile is skipped with a loud log rather than
 * taking the server down with it - a broken starter is a bug in Eagle Bot, not
 * a reason an academy can't sign in.
 */
export async function seedStarters(): Promise<void> {
  await retireStarters();

  for (const starter of STARTERS) {
    const result = compile(starter.source);
    if (!result.ok) {
      const first = result.diagnostics.find((entry) => entry.severity === "error");
      console.error(
        `[tacons] the starter "${starter.slug}" doesn't compile - line ${first?.line}: ${first?.message}`,
      );
      continue;
    }

    const manifest = result.manifest;
    const [already] = await db
      .select({ id: tacons.id, official: tacons.official })
      .from(tacons)
      .where(eq(tacons.slug, manifest.slug))
      .limit(1);
    if (already) {
      // Publishing over a version that exists is refused everywhere else in
      // Eagle Bot, and startup is no exception. A slug somebody else owns is
      // theirs.
      if (already.official) await publishNewVersion(already.id, starter, manifest);
      continue;
    }

    const [tacon] = await db
      .insert(tacons)
      .values({
        slug: manifest.slug,
        name: manifest.name,
        tagline: starter.tagline,
        description: starter.description,
        icon: manifest.icon,
        category: starter.category,
        academyId: null,
        authorName: "Eagle Bot",
        official: true,
        visibility: "public",
      })
      .returning();

    const [version] = await db
      .insert(taconVersions)
      .values({
        taconId: tacon.id,
        version: manifest.version,
        source: starter.source,
        manifest: manifest as unknown as Record<string, unknown>,
        changelog: starter.changelog,
      })
      .returning();

    await db
      .update(tacons)
      .set({ latestVersionId: version.id })
      .where(eq(tacons.id, tacon.id));

    console.log(`[tacons] published the official Tac-On "${manifest.slug}" to the market`);
  }
}

/** Publishes the starter's version on a listing that doesn't have it yet. */
async function publishNewVersion(taconId: number, starter: Starter, manifest: Manifest): Promise<void> {
  const [published] = await db
    .select({ id: taconVersions.id })
    .from(taconVersions)
    .where(and(eq(taconVersions.taconId, taconId), eq(taconVersions.version, manifest.version)))
    .limit(1);
  if (published) return;

  const [version] = await db
    .insert(taconVersions)
    .values({
      taconId,
      version: manifest.version,
      source: starter.source,
      manifest: manifest as unknown as Record<string, unknown>,
      changelog: starter.changelog,
    })
    .returning();

  await db
    .update(tacons)
    .set({
      name: manifest.name,
      icon: manifest.icon,
      tagline: starter.tagline,
      description: starter.description,
      latestVersionId: version.id,
      updatedAt: new Date(),
    })
    .where(eq(tacons.id, taconId));

  console.log(
    `[tacons] published ${manifest.version} of the official Tac-On "${manifest.slug}"; installs keep their version until an admin updates`,
  );
}

/**
 * Removes the official Tac-Ons that no longer ship.
 *
 * This deletes rows an academy recorded, which is the same bargain removing any
 * Tac-On makes - so it counts them first and says so in the log. Only official
 * listings are touched: a learner's own Tac-On is never anybody else's to pull.
 */
async function retireStarters(): Promise<void> {
  const doomed = await db
    .select({ id: tacons.id, slug: tacons.slug })
    .from(tacons)
    .where(and(inArray(tacons.slug, [...RETIRED_STARTER_SLUGS]), eq(tacons.official, true)));

  if (doomed.length === 0) return;

  const ids = doomed.map((row) => row.id);
  const installs = await db
    .select({ id: taconInstalls.id })
    .from(taconInstalls)
    .where(inArray(taconInstalls.taconId, ids));

  let records = 0;
  if (installs.length > 0) {
    const [counted] = await db
      .select({ total: sql<number>`count(*)` })
      .from(taconRecords)
      .where(inArray(taconRecords.installId, installs.map((row) => row.id)));
    records = Number(counted?.total ?? 0);
  }

  // Positions they added outlive them, archived, with their history.
  if (installs.length > 0) {
    await db
      .update(positions)
      .set({ archived: true, updatedAt: new Date() })
      .where(inArray(positions.taconInstallId, installs.map((row) => row.id)));
  }

  // Versions, installs and records all cascade from the listing.
  await db.delete(tacons).where(inArray(tacons.id, ids));

  console.log(
    `[tacons] retired ${doomed.length} official Tac-On(s) (${doomed
      .map((row) => row.slug)
      .join(", ")}): ${installs.length} install(s) and ${records} recorded row(s) deleted`,
  );
}
