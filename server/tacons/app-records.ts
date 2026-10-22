/**
 * The records an app keeps: `EagleBot.api.getRecords()` and friends.
 *
 * They are the same `tacon_records` rows TacScript Tac-Ons always wrote, one
 * set per install. That is what carries a Tac-On's data across the move from
 * TacScript to an app: the author publishes the app under the same name, the
 * admin presses Update, the install keeps its id, and every row it ever saved
 * is still there - each tagged with the store it was saved in (`entry`,
 * `ap_call`, ...), who saved it and when. New rows go in the store `records`
 * unless the app names another.
 *
 * Anyone who can open the app may read its records and add to them, because
 * the app decides what to show. Changing or removing a row is for whoever
 * saved it, or an admin or guide - an app can't let one learner wipe out
 * another's work, whatever its code says.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { taconRecords, users, type User } from "@shared/schema";

export const DEFAULT_STORE = "records";
/** Rows one `getRecords()` returns, newest first. */
export const MAX_APP_RECORDS = 5000;
export const MAX_RECORD_BYTES = 30_000;
const STORE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,59}$/;

export type AppRecord = {
  id: number;
  store: string;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  created_by: number | null;
  created_by_name: string;
};

export class RecordError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A store name an app may use. `__`-names belong to Eagle Bot itself. */
export function storeName(value: unknown): string {
  if (value === undefined || value === null || value === "") return DEFAULT_STORE;
  if (typeof value !== "string" || !STORE_NAME.test(value) || value.startsWith("__")) {
    throw new RecordError(400, "A store name is a word of letters, numbers, _ or -, like \"records\" or \"ap_call\".");
  }
  return value;
}

/** The `data` an app sends: a plain JSON object, not too large. */
export function recordData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RecordError(400, "data must be a non-null object.");
  }
  const size = new TextEncoder().encode(JSON.stringify(value)).length;
  if (size > MAX_RECORD_BYTES) throw new RecordError(400, "A record's data must be under 30 KB.");
  return value as Record<string, unknown>;
}

function shape(
  row: typeof taconRecords.$inferSelect,
  names: Map<number, string>,
  taconName: string,
): AppRecord {
  return {
    id: row.id,
    store: row.store,
    data: row.data ?? {},
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    created_by: row.createdBy,
    created_by_name: row.createdBy ? (names.get(row.createdBy) ?? "Someone") : taconName,
  };
}

async function namesFor(academyId: number): Promise<Map<number, string>> {
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.academyId, academyId));
  return new Map(rows.map((row) => [row.id, row.name]));
}

export async function listRecords(
  install: { id: number; academyId: number },
  taconName: string,
  store: string | null,
): Promise<AppRecord[]> {
  const rows = await db
    .select()
    .from(taconRecords)
    .where(
      store
        ? and(eq(taconRecords.installId, install.id), eq(taconRecords.store, store))
        : eq(taconRecords.installId, install.id),
    )
    .orderBy(desc(taconRecords.createdAt), desc(taconRecords.id))
    .limit(MAX_APP_RECORDS);
  const names = await namesFor(install.academyId);
  // `__`-stores are Eagle Bot's own bookkeeping, never an app's data.
  return rows.filter((row) => !row.store.startsWith("__")).map((row) => shape(row, names, taconName));
}

export async function createRecord(
  install: { id: number; academyId: number },
  taconName: string,
  user: User,
  body: { data?: unknown; store?: unknown },
): Promise<AppRecord> {
  const data = recordData(body.data);
  const store = storeName(body.store);
  const [row] = await db
    .insert(taconRecords)
    .values({ academyId: install.academyId, installId: install.id, store, data, createdByType: "user", createdBy: user.id })
    .returning();
  return shape(row, new Map([[user.id, user.name]]), taconName);
}

/** The row, if this person may change it: its author, an admin or a guide. */
async function ownedRow(install: { id: number }, user: User, recordId: number) {
  if (!Number.isInteger(recordId) || recordId < 1) throw new RecordError(404, "That record isn't here.");
  const [row] = await db
    .select()
    .from(taconRecords)
    .where(and(eq(taconRecords.id, recordId), eq(taconRecords.installId, install.id)))
    .limit(1);
  if (!row || row.store.startsWith("__")) throw new RecordError(404, "That record isn't here.");
  const mayChange = row.createdBy === user.id || user.role === "admin" || user.role === "guide";
  if (!mayChange) throw new RecordError(403, "Only the person who saved this record, or an admin or guide, can change it.");
  return row;
}

export async function updateRecord(
  install: { id: number; academyId: number },
  taconName: string,
  user: User,
  recordId: number,
  body: { data?: unknown },
): Promise<AppRecord> {
  const data = recordData(body.data);
  await ownedRow(install, user, recordId);
  const [row] = await db
    .update(taconRecords)
    .set({ data, updatedAt: new Date() })
    .where(eq(taconRecords.id, recordId))
    .returning();
  return shape(row, await namesFor(install.academyId), taconName);
}

export async function deleteRecord(install: { id: number }, user: User, recordId: number): Promise<void> {
  await ownedRow(install, user, recordId);
  await db.delete(taconRecords).where(eq(taconRecords.id, recordId));
}
