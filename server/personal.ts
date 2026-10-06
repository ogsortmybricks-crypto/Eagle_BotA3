/** Generic account settings shared by Tac-Ons. One confirmation-code authority. */
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "./db";
import { absences, users } from "@shared/schema";
import { VerificationCodeError, setVerificationCode, resetVerificationCode, verifyUserCode } from "./verification-code";
export { VerificationCodeError as VerifyCodeError };
export const VERIFY_CODE = /^\d{6}$/;
export const setVerifyCode = setVerificationCode;
export const clearVerifyCode = resetVerificationCode;
export async function checkVerifyCode(userId: number, code: string): Promise<void> {
  const error = await db.transaction(tx => verifyUserCode(tx, userId, code));
  if (error) throw new VerificationCodeError(error);
}

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
