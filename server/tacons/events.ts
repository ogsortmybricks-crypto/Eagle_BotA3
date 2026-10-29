/**
 * How a Tac-On hears about the rest of Eagle Bot.
 *
 * Rather than inventing a second event system, Tac-Ons subscribe to the
 * activity log - the one place the app already records everything it considers
 * worth remembering. A Town Hall being processed, an election certified, a rule
 * repealed: if it reached the log, a `when` block can act on it.
 *
 * Dispatch is fire-and-forget and swallows its own failures. A Tac-On written
 * by a fourteen-year-old must never be able to fail somebody's election.
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import { academies, taconRecords, users, type Academy, type User } from "@shared/schema";
import { resolveSettings } from "@shared/settings";
import { HOOK_EVENTS, display, matches, type Row } from "@shared/tacons";
import { studioCircle } from "../studio";
import { allInstalls, type LoadedInstall } from "./registry";
import { buildRuntime, contextFor, runActions } from "./runtime";

export type TaconEvent = {
  academyId: number;
  studioId: number | null;
  action: string;
  summary: string;
  actorUserId: number | null;
  entityType: string | null;
  entityId: number | null;
  metadata: Record<string, unknown> | null;
};

/** Cheap enough to run on every log write: a string check against a short list. */
export function isSubscribable(action: string): boolean {
  return (HOOK_EVENTS as readonly string[]).includes(action);
}

/**
 * The shape a hook sees as `event.*`.
 *
 * Two fields are worth the special-casing: `event.actor` is who did it, and
 * `event.winner` is who won, which is the difference between "the admin who
 * certified the election" and "the Hero who was elected". Tac-Ons get that
 * wrong constantly unless the runtime hands them both.
 */
function eventRow(event: TaconEvent, actorName: string | null): Row {
  const metadata = event.metadata ?? {};
  const ranked = Array.isArray(metadata.ranked)
    ? (metadata.ranked as { userId?: number | null; label?: string; votes?: number }[])
    : [];
  const winner = ranked.find((entry) => typeof entry.userId === "number");

  return {
    action: event.action,
    summary: event.summary,
    actor: event.actorUserId,
    actorName: actorName ?? "Eagle Bot",
    entityType: event.entityType,
    entityId: event.entityId,
    studioId: event.studioId,
    winner: winner?.userId ?? null,
    winnerName: winner?.label ?? "",
    votes: winner?.votes ?? 0,
    // Calendar changes: what was added, moved or removed, and when it runs.
    kind: typeof metadata.kind === "string" ? metadata.kind : "",
    title: typeof metadata.title === "string" ? metadata.title : "",
    starts: typeof metadata.starts === "string" ? metadata.starts : "",
    ends: typeof metadata.ends === "string" ? metadata.ends : "",
    quest: typeof metadata.quest === "string" ? metadata.quest : "",
    meta: metadata,
  };
}

/**
 * Runs every `when` block that named this event.
 *
 * A hook only fires for installs the event could plausibly belong to: an
 * academy-wide install hears everything in the academy, a studio install hears
 * only its own studio. A Spark Tac-On has no business reacting to a Launchpad
 * election.
 */
export async function dispatchTaconEvent(event: TaconEvent): Promise<void> {
  if (!isSubscribable(event.action)) return;

  const [academy] = await db
    .select()
    .from(academies)
    .where(eq(academies.id, event.academyId))
    .limit(1);
  if (!academy) return;

  // Hooks run with no viewer: they are the Tac-On acting on its own behalf, so
  // they can only ever touch their own storage. That also means the usual
  // "what may this person see" filter doesn't apply - the event's studio does.
  // A grouped studio's Tac-Ons hear about everything that happens in the group.
  const installs = await allInstalls(event.academyId);
  const circle = await studioCircle(event.studioId);
  const relevant = installs.filter(
    (entry) =>
      (entry.manifest.hooks.some((hook) => hook.event === event.action) ||
        (entry.manifest.app?.reactions ?? []).some((reaction) => reaction.on === event.action)) &&
      (entry.install.visibility === "academy" ||
        (entry.install.visibility === "group" && entry.install.groupId !== null
          ? circle.includes(entry.install.studioId ?? -1)
          : entry.install.visibility === "studio"
            ? entry.install.studioId === event.studioId
            : entry.install.studioId === null || circle.includes(entry.install.studioId))),
  );
  if (relevant.length === 0) return;

  const actorName = (await loadActor(event.actorUserId))?.name ?? null;
  const row = eventRow(event, actorName);
  const settings = resolveSettings(academy.settings);

  for (const install of relevant) {
    try {
      if (install.manifest.app) {
        await runReactions(install, row, event);
        continue;
      }
      await runHooks(academy, settings, install, row, event);
    } catch (error) {
      console.error(`[tacon] ${install.tacon.slug} failed on ${event.action}`, error);
    }
  }
}

async function loadActor(userId: number | null): Promise<User | null> {
  if (!userId) return null;
  const [found] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return found ?? null;
}

async function runHooks(
  academy: Academy,
  settings: ReturnType<typeof resolveSettings>,
  install: LoadedInstall,
  row: Row,
  event: TaconEvent,
): Promise<void> {
  const runtime = await buildRuntime({
    academy,
    settings,
    // The hook is the Tac-On acting, not the person whose action triggered it.
    user: null,
    scope: undefined,
    install,
  });

  for (const hook of install.manifest.hooks) {
    if (hook.event !== event.action) continue;
    if (hook.when && !matches(hook.when, { ...contextFor(runtime, { event: row }), event: row })) {
      continue;
    }
    await runActions(runtime, hook.does, {
      event: row,
      // Rows written by a hook belong to the Tac-On, not to whoever happened to
      // trigger it - attributing them to the actor would misread the history.
      actorUserId: null,
      studioId: install.install.studioId ?? event.studioId,
      reason: event.action,
    });
  }
}

/**
 * An app's `reactions`: when the event matches, save the record it describes,
 * with `{event.x}` filled in. Written as the Tac-On, not as whoever triggered
 * the event - the same rule TacScript reactions followed.
 */
async function runReactions(install: LoadedInstall, row: Row, event: TaconEvent): Promise<void> {
  const read = (key: string) => (key.startsWith("event.") ? row[key.slice("event.".length)] : undefined);
  for (const reaction of install.manifest.app?.reactions ?? []) {
    if (reaction.on !== event.action) continue;
    const when = Object.entries(reaction.when ?? {});
    if (!when.every(([key, wanted]) => String(read(key) ?? "") === String(wanted))) continue;

    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(reaction.data)) {
      if (typeof value !== "string") {
        data[key] = value;
        continue;
      }
      // "{event.winner}" on its own keeps the value as it is (a number stays a number).
      const whole = value.match(/^\{(event\.[A-Za-z0-9_]+)\}$/);
      data[key] = whole
        ? (read(whole[1]) ?? null)
        : value.replace(/\{(event\.[A-Za-z0-9_]+)\}/g, (_match, path: string) => display(read(path)));
    }
    await db.insert(taconRecords).values({
      academyId: install.install.academyId,
      installId: install.install.id,
      store: reaction.store,
      data,
      createdByType: "tacon",
      createdBy: null,
    });
  }
}

/** Only the academy tables are touched, so a missing event is never fatal. */
export function dispatchInBackground(event: TaconEvent): void {
  void dispatchTaconEvent(event).catch((error) =>
    console.error("[tacon] event dispatch failed", event.action, error),
  );
}

