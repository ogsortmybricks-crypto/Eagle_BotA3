import { db } from "./db";
import { activityLog } from "@shared/schema";

type LogInput = {
  academyId: number;
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
 */
export async function logActivity(entry: LogInput): Promise<void> {
  try {
    await db.insert(activityLog).values({
      academyId: entry.academyId,
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
}
