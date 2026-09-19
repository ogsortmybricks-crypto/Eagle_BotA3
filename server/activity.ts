import { db } from "./db";
import { activityLog } from "@shared/schema";
import { dispatchInBackground, isSubscribable } from "./tacons/events";

type LogInput = {
  academyId: number;
  /** Which studio this happened in. Null for academy-level events. */
  studioId?: number | null;
  action: string;
  summary: string;
  actorUserId?: number | null;
  actorType?: "user" | "ai" | "system";
  actorLabel?: string | null;
  entityType?: string | null;
  entityId?: number | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * Append-only record of everything that happens in the academy. The admin
 * Activity page reads straight off this table, so if an action isn't logged
 * here it effectively didn't happen as far as the studio is concerned.
 *
 * Never throws - a logging failure must not roll back the thing being logged.
 *
 * It is also where Tac-Ons listen from. Every `when` block in every installed
 * Tac-On is driven off these rows, which means a Tac-On can react to anything
 * the academy already considers worth recording, and to nothing it doesn't.
 */
export async function logActivity(entry: LogInput): Promise<void> {
  try {
    await db.insert(activityLog).values({
      academyId: entry.academyId,
      studioId: entry.studioId ?? null,
      actorUserId: entry.actorUserId ?? null,
      actorType: entry.actorType ?? "user",
      actorLabel: entry.actorLabel ?? null,
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      summary: entry.summary,
      metadata: entry.metadata ?? null,
    });
  } catch (error) {
    console.error("[activity] failed to write log entry", entry.action, error);
  }

  // Tac-Ons run after the fact and off the request's critical path: the thing
  // that happened has already been recorded, and nothing a Tac-On does can
  // undo it.
  if (isSubscribable(entry.action)) {
    dispatchInBackground({
      academyId: entry.academyId,
      studioId: entry.studioId ?? null,
      action: entry.action,
      summary: entry.summary,
      actorUserId: entry.actorUserId ?? null,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata ?? null,
    });
  }
}
