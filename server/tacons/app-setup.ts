/**
 * Running an app's `setup` actions when it's installed or updated.
 *
 * Each action runs at most once per answer: a position or wiki section that
 * already exists is left alone ("idempotent"), so updating, re-installing or
 * re-running never makes a second one. Optional actions only run when the
 * installing admin left their tickbox ticked, and the answers are kept on the
 * install so an update asks the same questions the same way.
 *
 * Positions an app makes belong to its install, like the ones TacScript
 * Tac-Ons declared: turning the Tac-On off or removing it archives them and
 * keeps who held them. A TacScript Tac-On's old position with the same title
 * is taken over, holders and history included - that's how a seat survives
 * the move to an app.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { positions, taconInstalls, wikiSections, type TaconInstall } from "@shared/schema";
import { actionKey, chosenActions, type Manifest, type SetupAction } from "@shared/tacons";
import { applyOperations } from "../ai/apply";
import { logActivity } from "../activity";

/** Keys on `tacon_installs.settings` that belong to Eagle Bot, not the Tac-On. */
export const DISPLAY_KEY = "__display";
export const SELECTION_KEY = "__setupSelection";
export const RESULTS_KEY = "__setupResults";

export type DisplayMode = "inline" | "fullscreen";

export type SetupResult = {
  type: SetupAction["type"];
  key: string;
  ok: boolean;
  /** The installer declined it. */
  skipped?: boolean;
  /** It was already there, so nothing was made. */
  existed?: boolean;
  message?: string;
};

/** How a TacScript-free install names a position it made, in `positions.tacon_position`. */
export function setupPositionName(title: string): string {
  return `setup:${title.trim().toLowerCase()}`;
}

/** The position names an app's manifest owns, for syncing and archiving. */
export function setupPositionNames(manifest: Manifest): string[] {
  return (manifest.app?.setup ?? [])
    .filter((action): action is Extract<SetupAction, { type: "createPosition" }> => action.type === "createPosition")
    .map((action) => setupPositionName(action.title));
}

/** Whether the app opens full screen, from the actions that ran. */
export function displayModeFor(setup: SetupAction[], chosen: boolean[]): DisplayMode {
  const index = setup.findIndex((action) => action.type === "enableFullWindow");
  if (index === -1 || !chosen[index]) return "inline";
  const action = setup[index] as Extract<SetupAction, { type: "enableFullWindow" }>;
  return action.mode === "inline" ? "inline" : "fullscreen";
}

export function displayModeOf(install: TaconInstall): DisplayMode {
  return (install.settings as Record<string, unknown> | null)?.[DISPLAY_KEY] === "fullscreen" ? "fullscreen" : "inline";
}

/**
 * Runs an app's setup for one install and records the answers, the results
 * and the display mode on it. `selection` is what the admin ticked; undefined
 * means "the same as last time", falling back to each action's default.
 */
export async function runSetup(options: {
  install: TaconInstall;
  manifest: Manifest;
  taconName: string;
  actorUserId: number | null;
  selection?: (string | number)[];
}): Promise<SetupResult[]> {
  const { install, manifest, taconName } = options;
  const setup = manifest.app?.setup ?? [];
  const stored = (install.settings ?? {}) as Record<string, unknown>;
  const selection = options.selection ?? (Array.isArray(stored[SELECTION_KEY]) ? (stored[SELECTION_KEY] as string[]) : undefined);
  const chosen = chosenActions(setup, selection);

  const results: SetupResult[] = [];
  for (const [index, action] of setup.entries()) {
    const key = actionKey(action, index);
    if (!chosen[index]) {
      results.push({ type: action.type, key, ok: true, skipped: true });
      continue;
    }
    try {
      if (action.type === "createPosition") {
        results.push({ type: action.type, key, ...(await createPosition(install, action, taconName, options.actorUserId)) });
      } else if (action.type === "createWikiPage") {
        results.push({ type: action.type, key, ...(await createWikiPage(install, action, taconName, options.actorUserId)) });
      } else {
        results.push({ type: action.type, key, ok: true });
      }
    } catch (error) {
      console.error(`[tacon] ${taconName} setup action ${key} failed`, error);
      results.push({ type: action.type, key, ok: false, message: "This step couldn't be done. Try updating the Tac-On again." });
    }
  }

  // Remember the answers as keys, so a later version asks the same questions the same way.
  const answers = setup.map((action, index) => (chosen[index] ? actionKey(action, index) : null)).filter((key): key is string => key !== null);
  await db
    .update(taconInstalls)
    .set({
      settings: {
        ...stored,
        [DISPLAY_KEY]: displayModeFor(setup, chosen),
        [SELECTION_KEY]: answers,
        [RESULTS_KEY]: results,
      },
      updatedAt: new Date(),
    })
    .where(eq(taconInstalls.id, install.id));
  return results;
}

async function createPosition(
  install: TaconInstall,
  action: Extract<SetupAction, { type: "createPosition" }>,
  taconName: string,
  actorUserId: number | null,
): Promise<Omit<SetupResult, "type" | "key">> {
  const title = action.title.trim();
  const name = setupPositionName(title);
  const same = sql`lower(${positions.title}) = ${title.toLowerCase()}`;

  // This install's own position by that title - made by an earlier version of
  // the app, or declared by its TacScript version - is taken over and brought
  // back if it was archived. Its holders and history come with it.
  const [own] = await db
    .select()
    .from(positions)
    .where(and(eq(positions.taconInstallId, install.id), same))
    .limit(1);
  if (own) {
    await db
      .update(positions)
      .set({ taconPosition: name, archived: !install.enabled, updatedAt: new Date() })
      .where(eq(positions.id, own.id));
    return { ok: true, existed: true };
  }

  // Anyone else's live position with that title, in this studio or across the
  // academy, is the studio's already. Nothing to make.
  const [existing] = await db
    .select({ id: positions.id, studioId: positions.studioId, shared: positions.sharedStudioIds })
    .from(positions)
    .where(and(eq(positions.academyId, install.academyId), eq(positions.archived, false), same));
  const visible =
    existing &&
    (install.studioId === null ||
      existing.studioId === null ||
      existing.studioId === install.studioId ||
      (existing.shared ?? []).includes(install.studioId));
  if (visible) return { ok: true, existed: true };

  const [created] = await db
    .insert(positions)
    .values({
      academyId: install.academyId,
      studioId: install.studioId,
      title,
      description: action.description ?? null,
      seats: action.seats ?? 1,
      elected: action.elected ?? true,
      archived: !install.enabled,
      sourceType: "tacon",
      sourceRef: taconName,
      taconInstallId: install.id,
      taconPosition: name,
    })
    .returning();
  await logActivity({
    academyId: install.academyId,
    studioId: install.studioId,
    actorUserId,
    actorLabel: taconName,
    action: "position.created",
    entityType: "position",
    entityId: created.id,
    summary: `The Tac-On "${taconName}" added the position "${created.title}".`,
  });
  return { ok: true };
}

async function createWikiPage(
  install: TaconInstall,
  action: Extract<SetupAction, { type: "createWikiPage" }>,
  taconName: string,
  actorUserId: number | null,
): Promise<Omit<SetupResult, "type" | "key">> {
  const title = action.title.trim();
  // A wiki "page" is a section of the Contract with the content as its first rule.
  const [existing] = await db
    .select({ id: wikiSections.id, studioId: wikiSections.studioId, shared: wikiSections.sharedStudioIds })
    .from(wikiSections)
    .where(and(eq(wikiSections.academyId, install.academyId), sql`lower(${wikiSections.title}) = ${title.toLowerCase()}`));
  const visible =
    existing &&
    (install.studioId === null ||
      existing.studioId === null ||
      existing.studioId === install.studioId ||
      (existing.shared ?? []).includes(install.studioId));
  if (visible) return { ok: true, existed: true };

  const outcome = await applyOperations({
    academyId: install.academyId,
    operations: [
      { op: "create_section", key: "page", title, summary: "", rationale: `Added by the Tac-On "${taconName}" when it was installed.` },
      { op: "create_rule", sectionKey: "page", title, body: action.content, rationale: `Added by the Tac-On "${taconName}" when it was installed.` },
    ],
    actorUserId,
    actorType: "user",
    sourceType: "tacon",
    sourceRef: taconName,
    jobId: null,
    studioId: install.studioId,
  });
  if (outcome.sectionsCreated === 0) {
    return { ok: false, message: outcome.skipped[0] ?? "The wiki section couldn't be made." };
  }
  return { ok: true };
}
