/**
 * Positions a Tac-On adds to the academy.
 *
 * A `position` block in TacScript becomes an ordinary row in `positions` when
 * the Tac-On is installed: it shows on the Positions page, it can be elected or
 * appointed, and its history is kept like any other. What makes it different is
 * that the Tac-On decides what its holder sees - a desk on the Positions page,
 * and any page, panel, form or button that names the position as its audience.
 *
 * The install owns the row. Installing creates it, updating re-syncs it,
 * turning the Tac-On off or removing it archives it. Archiving rather than
 * deleting is deliberate: who held the Treasurer seat last term is part of the
 * studio's record, whether or not the Tac-On that invented the seat survives.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import { positionHolders, positions, users, type Position, type TaconInstall } from "@shared/schema";
import type { Manifest, Row } from "@shared/tacons";
import { logActivity } from "../activity";

/** What a Tac-On's expressions read as `position.<name>`. */
export type PositionFacts = Record<string, Row>;

/** The position rows an install created, archived or not. */
async function ownedBy(installId: number): Promise<Position[]> {
  return db.select().from(positions).where(eq(positions.taconInstallId, installId));
}

/**
 * Makes the Positions page match the manifest an install is running.
 *
 * Called on install and on update. A position the new version dropped is
 * archived, not deleted; one it brings back is un-archived with its history.
 */
export async function syncPositions(options: {
  install: TaconInstall;
  taconName: string;
  manifest: Manifest;
  actorUserId: number | null;
}): Promise<void> {
  const { install, taconName, manifest } = options;
  const existing = await ownedBy(install.id);
  const declared = new Set(manifest.positions.map((def) => def.name));

  for (const def of manifest.positions) {
    const values = {
      title: def.title,
      description: def.about,
      responsibilities: def.duties,
      seats: def.seats,
      termLength: def.term,
      elected: def.elected,
      studioId: install.studioId,
      sourceRef: taconName,
      archived: !install.enabled,
      updatedAt: new Date(),
    };

    const found = existing.find((row) => row.taconPosition === def.name);
    if (found) {
      await db.update(positions).set(values).where(eq(positions.id, found.id));
      continue;
    }

    const [created] = await db
      .insert(positions)
      .values({
        ...values,
        academyId: install.academyId,
        sourceType: "tacon",
        taconInstallId: install.id,
        taconPosition: def.name,
      })
      .returning();

    await logActivity({
      academyId: install.academyId,
      studioId: install.studioId,
      actorUserId: options.actorUserId,
      actorLabel: taconName,
      action: "position.created",
      entityType: "position",
      entityId: created.id,
      summary: `The Tac-On "${taconName}" added the position "${created.title}".`,
    });
  }

  const dropped = existing.filter((row) => !declared.has(row.taconPosition ?? "") && !row.archived);
  if (dropped.length > 0) {
    await db
      .update(positions)
      .set({ archived: true, updatedAt: new Date() })
      .where(inArray(positions.id, dropped.map((row) => row.id)));
  }
}

/**
 * Hides an install's positions (turned off, or about to be removed) or brings
 * them back (turned on again). Holders are left exactly as they were.
 */
export async function setPositionsArchived(install: TaconInstall, manifest: Manifest, archived: boolean) {
  const rows = await ownedBy(install.id);
  // Only the ones the running version declares come back; a dropped one stays archived.
  const declared = new Set(manifest.positions.map((def) => def.name));
  const ids = rows
    .filter((row) => archived || declared.has(row.taconPosition ?? ""))
    .map((row) => row.id);
  if (ids.length === 0) return 0;
  await db
    .update(positions)
    .set({ archived, updatedAt: new Date() })
    .where(inArray(positions.id, ids));
  return ids.length;
}

/**
 * The positions each install gave this person, by install id.
 *
 * This is the whole of "what the holder sees": audiences, desks and nav all
 * come back to whether someone has an unended term in a live position that
 * this install created.
 */
export async function heldPositions(
  userId: number,
  installIds: number[],
): Promise<Map<number, Map<string, { positionId: number; title: string }>>> {
  const held = new Map<number, Map<string, { positionId: number; title: string }>>();
  if (installIds.length === 0) return held;

  const rows = await db
    .select({
      installId: positions.taconInstallId,
      name: positions.taconPosition,
      positionId: positions.id,
      title: positions.title,
    })
    .from(positionHolders)
    .innerJoin(positions, eq(positions.id, positionHolders.positionId))
    .where(
      and(
        eq(positionHolders.userId, userId),
        isNull(positionHolders.endedAt),
        eq(positions.archived, false),
        inArray(positions.taconInstallId, installIds),
      ),
    );

  for (const row of rows) {
    if (row.installId === null || row.name === null) continue;
    const forInstall = held.get(row.installId) ?? new Map();
    forInstall.set(row.name, { positionId: row.positionId, title: row.title });
    held.set(row.installId, forInstall);
  }
  return held;
}

/** Just the names, for an audience check. */
export async function heldNames(userId: number, installId: number): Promise<Set<string>> {
  const held = await heldPositions(userId, [installId]);
  return new Set(held.get(installId)?.keys() ?? []);
}

/**
 * Everything `position.<name>` can read, for one install.
 *
 * Declared positions that are archived or not yet created still resolve - to
 * "nobody yet" - so a note mentioning the Treasurer never prints a blank.
 */
export async function positionFacts(installId: number, manifest: Manifest): Promise<PositionFacts> {
  const facts: PositionFacts = {};
  for (const def of manifest.positions) {
    facts[def.name] = { title: def.title, names: "nobody yet", holder: null, holders: 0, ids: [] };
  }
  if (manifest.positions.length === 0) return facts;

  const rows = await db
    .select({
      name: positions.taconPosition,
      title: positions.title,
      archived: positions.archived,
      userId: positionHolders.userId,
      userName: users.name,
      endedAt: positionHolders.endedAt,
    })
    .from(positions)
    .leftJoin(positionHolders, eq(positionHolders.positionId, positions.id))
    .leftJoin(users, eq(users.id, positionHolders.userId))
    .where(eq(positions.taconInstallId, installId));

  for (const def of manifest.positions) {
    const mine = rows.filter((row) => row.name === def.name && !row.archived);
    const current = mine.filter((row) => row.userId !== null && row.endedAt === null);
    facts[def.name] = {
      title: mine[0]?.title ?? def.title,
      names: current.length ? current.map((row) => row.userName).join(", ") : "nobody yet",
      holder: current[0]?.userId ?? null,
      holders: current.length,
      ids: current.map((row) => row.userId),
    };
  }
  return facts;
}
