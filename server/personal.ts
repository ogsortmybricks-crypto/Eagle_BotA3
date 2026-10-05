import { and, eq, gte, inArray, lte } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { absences, users } from "@shared/schema";

/**
 * Things that belong to a person rather than to any one feature: the
 * six-digit code they sign with, and when they're in. Core owns them; Tac-Ons
 * ask through these helpers and never see the code itself.
 */

export const VERIFY_CODE = /^\d{6}$/;
const MAX_FAILURES = 5;
const LOCKOUT_MINUTES = 15;

export class VerifyCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerifyCodeError";
  }
}

export async function setVerifyCode(userId: number, code: string): Promise<void> {
  if (!VERIFY_CODE.test(code)) throw new VerifyCodeError("Your code has to be exactly six digits.");
  if (/^(\d)\1{5}$/.test(code) || code === "123456" || code === "654321") {
    throw new VerifyCodeError("Pick something harder to guess than that.");
  }
  await db
    .update(users)
    .set({ verifyCodeHash: await bcrypt.hash(code, 10), verifyCodeFailures: 0, verifyCodeLockedUntil: null })
    .where(eq(users.id, userId));
}

export async function clearVerifyCode(userId: number): Promise<void> {
  await db
    .update(users)
    .set({ verifyCodeHash: null, verifyCodeFailures: 0, verifyCodeLockedUntil: null })
    .where(eq(users.id, userId));
}

/**
 * Checks someone's code, throwing a message fit to show them if it's wrong.
 * Five wrong tries lock it for fifteen minutes - six digits is a million
 * guesses, which is plenty only if nobody gets to make them all.
 */
export async function checkVerifyCode(userId: number, code: string): Promise<void> {
  const [person] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!person) throw new VerifyCodeError("That person doesn't exist.");
  if (!person.verifyCodeHash) {
    throw new VerifyCodeError("Set your six-digit code first, under Settings → My account.");
  }
  if (person.verifyCodeLockedUntil && person.verifyCodeLockedUntil > new Date()) {
    const minutes = Math.ceil((person.verifyCodeLockedUntil.getTime() - Date.now()) / 60_000);
    throw new VerifyCodeError(`Too many wrong tries. Your code unlocks in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
  }
  if (VERIFY_CODE.test(code) && (await bcrypt.compare(code, person.verifyCodeHash))) {
    if (person.verifyCodeFailures > 0) {
      await db.update(users).set({ verifyCodeFailures: 0, verifyCodeLockedUntil: null }).where(eq(users.id, userId));
    }
    return;
  }
  const failures = person.verifyCodeFailures + 1;
  const locked = failures >= MAX_FAILURES;
  await db
    .update(users)
    .set({
      verifyCodeFailures: locked ? 0 : failures,
      verifyCodeLockedUntil: locked ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
    })
    .where(eq(users.id, userId));
  throw new VerifyCodeError(
    locked
      ? `That's not your code. It's locked for ${LOCKOUT_MINUTES} minutes.`
      : `That's not your code. ${MAX_FAILURES - failures} tr${MAX_FAILURES - failures === 1 ? "y" : "ies"} left.`,
  );
}

/* -------------------------------------------------------------------------- */
/*  Attendance                                                                 */
/* -------------------------------------------------------------------------- */

export type Absence = { day: string; kind: "sick" | "other"; note: string | null };
export type Attendance = { userId: number; days: number[]; absences: Absence[] };

/** Normal days and absences for each person, absences limited to [from, to]. */
export async function attendanceFor(userIds: number[], from: string, to: string): Promise<Map<number, Attendance>> {
  const result = new Map<number, Attendance>();
  if (userIds.length === 0) return result;
  const people = await db
    .select({ id: users.id, days: users.attendanceDays })
    .from(users)
    .where(inArray(users.id, userIds));
  for (const person of people) result.set(person.id, { userId: person.id, days: person.days ?? [], absences: [] });
  const rows = await db
    .select()
    .from(absences)
    .where(and(inArray(absences.userId, userIds), gte(absences.day, from), lte(absences.day, to)));
  for (const row of rows) {
    result.get(row.userId)?.absences.push({ day: row.day, kind: row.kind, note: row.note });
  }
  return result;
}

/** True when someone is expected in on `day` and hasn't recorded an absence. */
export function attends(attendance: Attendance | undefined, day: string): boolean {
  if (!attendance) return true;
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return attendance.days.includes(weekday) && !attendance.absences.some((absence) => absence.day === day);
}
