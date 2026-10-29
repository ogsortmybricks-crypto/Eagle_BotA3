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
 * Anyone who can open the app may read its records and add to them, unless
 * the manifest's `stores` narrows who may read or write a store - which the
 * server enforces, whatever the app's code does. Changing or removing a row
 * is for whoever saved it, or an admin or guide: an app can't let one learner
 * wipe out another's work.
 *
 * A store marked `sign` takes only records signed with the saver's six-digit
 * confirmation code. The signature is a row in Eagle Bot's own `__signatures`
 * store, which no app can write, and a signed record can't be changed.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { taconRecords, users, type User } from "@shared/schema";

export const DEFAULT_STORE = "records";
export const SIGNATURES = "__signatures";

/** What this person may do with each store, worked out from the manifest by the caller. */
export type StoreAccess = {
  mayRead(store: string): boolean;
  mayWrite(store: string): boolean;
  mustSign(store: string): boolean;
};
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
  /** Set when the saver confirmed it with their own code. */
  signed: { by: number; by_name: string; at: string } | null;
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

type Signature = { by: number; at: Date };

function shape(
  row: typeof taconRecords.$inferSelect,
  names: Map<number, string>,
  taconName: string,
  signature?: Signature,
): AppRecord {
  return {
    id: row.id,
    store: row.store,
    data: row.data ?? {},
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    created_by: row.createdBy,
    created_by_name: row.createdBy ? (names.get(row.createdBy) ?? "Someone") : taconName,
    signed: signature
      ? { by: signature.by, by_name: names.get(signature.by) ?? "Someone", at: signature.at.toISOString() }
      : null,
  };
}

/** Every signature on this install's records, by record id. */
async function signaturesFor(installId: number): Promise<Map<number, Signature>> {
  const rows = await db
    .select()
    .from(taconRecords)
    .where(and(eq(taconRecords.installId, installId), eq(taconRecords.store, SIGNATURES)));
  const map = new Map<number, Signature>();
  for (const row of rows) {
    const recordId = Number((row.data as { recordId?: unknown }).recordId);
    if (Number.isInteger(recordId) && row.createdBy) map.set(recordId, { by: row.createdBy, at: row.createdAt });
  }
  return map;
}

async function namesFor(academyId: number): Promise<Map<number, string>> {
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.academyId, academyId));
  return new Map(rows.map((row) => [row.id, row.name]));
}

export async function listRecords(
  install: { id: number; academyId: number },
  taconName: string,
  store: string | null,
  access: StoreAccess,
): Promise<AppRecord[]> {
  if (store && !access.mayRead(store)) throw new RecordError(403, `You can't read the "${store}" records.`);
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
  const [names, signatures] = await Promise.all([namesFor(install.academyId), signaturesFor(install.id)]);
  // `__`-stores are Eagle Bot's own bookkeeping, never an app's data; stores
  // this person may not read are left out entirely.
  return rows
    .filter((row) => !row.store.startsWith("__") && access.mayRead(row.store))
    .map((row) => shape(row, names, taconName, signatures.get(row.id)));
}

export async function createRecord(
  install: { id: number; academyId: number },
  taconName: string,
  user: User,
  body: { data?: unknown; store?: unknown; code?: unknown; sign?: unknown },
  access: StoreAccess,
  /** Checks the person's own confirmation code; throws with a message if it's wrong. */
  checkCode: (code: string) => Promise<void>,
): Promise<AppRecord> {
  const data = recordData(body.data);
  const store = storeName(body.store);
  if (!access.mayWrite(store)) throw new RecordError(403, `You can't add to the "${store}" records.`);
  const signing = access.mustSign(store) || body.sign === true;
  if (signing) {
    if (typeof body.code !== "string" || !body.code) {
      throw new RecordError(400, "This has to be signed with your six-digit confirmation code.");
    }
    try {
      await checkCode(body.code);
    } catch (error) {
      throw new RecordError(400, error instanceof Error ? error.message : "That confirmation code doesn't match.");
    }
  }
  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(taconRecords)
      .values({ academyId: install.academyId, installId: install.id, store, data, createdByType: "user", createdBy: user.id })
      .returning();
    if (signing) {
      await tx.insert(taconRecords).values({
        academyId: install.academyId,
        installId: install.id,
        store: SIGNATURES,
        data: { recordId: created.id },
        createdByType: "user",
        createdBy: user.id,
      });
    }
    return created;
  });
  return shape(row, new Map([[user.id, user.name]]), taconName, signing ? { by: user.id, at: row.createdAt } : undefined);
}

/** The row, if this person may change it: its author, an admin or a guide. */
async function ownedRow(install: { id: number }, user: User, recordId: number, access: StoreAccess) {
  if (!Number.isInteger(recordId) || recordId < 1) throw new RecordError(404, "That record isn't here.");
  const [row] = await db
    .select()
    .from(taconRecords)
    .where(and(eq(taconRecords.id, recordId), eq(taconRecords.installId, install.id)))
    .limit(1);
  if (!row || row.store.startsWith("__")) throw new RecordError(404, "That record isn't here.");
  const mayChange = row.createdBy === user.id || user.role === "admin" || user.role === "guide" || access.mayWrite(row.store);
  if (!mayChange) throw new RecordError(403, "You can only change records you saved or records your Tac-On role can manage.");
  return row;
}

export async function updateRecord(
  install: { id: number; academyId: number },
  taconName: string,
  user: User,
  recordId: number,
  body: { data?: unknown },
  access: StoreAccess,
): Promise<AppRecord> {
  const data = recordData(body.data);
  await ownedRow(install, user, recordId, access);
  if ((await signaturesFor(install.id)).has(recordId)) {
    throw new RecordError(409, "A signed record can't be changed. Add a new record instead.");
  }
  const [row] = await db
    .update(taconRecords)
    .set({ data, updatedAt: new Date() })
    .where(eq(taconRecords.id, recordId))
    .returning();
  return shape(row, await namesFor(install.academyId), taconName);
}

export async function deleteRecord(install: { id: number }, user: User, recordId: number, access: StoreAccess): Promise<void> {
  await ownedRow(install, user, recordId, access);
  await db.transaction(async (tx) => {
    await tx.delete(taconRecords).where(eq(taconRecords.id, recordId));
    // Its signature goes with it.
    await tx
      .delete(taconRecords)
      .where(
        and(
          eq(taconRecords.installId, install.id),
          eq(taconRecords.store, SIGNATURES),
          sql`(${taconRecords.data}->>'recordId')::int = ${recordId}`,
        ),
      );
  });
}
