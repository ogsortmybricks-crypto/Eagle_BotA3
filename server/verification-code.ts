/** Account credentials reusable by Tac-Ons. Only verification, never retrieval. */
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { verificationCodes } from "@shared/schema";

export class VerificationCodeError extends Error {}
async function lock(tx: any, userId: number) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`user-verification-code:${userId}`}, 0))`);
}
export async function hasVerificationCode(userId: number): Promise<boolean> {
  const [row] = await db.select({ userId: verificationCodes.userId }).from(verificationCodes)
    .where(eq(verificationCodes.userId, userId));
  return Boolean(row);
}
/** Caller must commit the transaction even when an error string is returned. */
export async function verifyUserCode(tx: any, userId: number, code: string): Promise<string | null> {
  await lock(tx, userId);
  const [row] = await tx.select().from(verificationCodes).where(eq(verificationCodes.userId, userId));
  if (!row) return "Set your personal six-digit certification code in your Eagle Bot profile first.";
  if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) return "Too many incorrect codes. Try again in 15 minutes.";
  if (!/^\d{6}$/.test(code) || !(await bcrypt.compare(code, row.hash))) {
    const failures = (row.lockedUntil ? 0 : row.failures) + 1;
    await tx.update(verificationCodes).set({
      failures, lockedUntil: failures >= 5 ? new Date(Date.now() + 15 * 60_000) : null, updatedAt: new Date(),
    }).where(eq(verificationCodes.userId, userId));
    return failures >= 5 ? "Too many incorrect codes. Try again in 15 minutes." : "That certification code doesn't match.";
  }
  await tx.update(verificationCodes).set({ failures: 0, lockedUntil: null, updatedAt: new Date() })
    .where(eq(verificationCodes.userId, userId));
  return null;
}
export async function setVerificationCode(userId: number, code: string, currentCode?: string) {
  if (!/^\d{6}$/.test(code)) throw new VerificationCodeError("Choose exactly six digits.");
  const hash = await bcrypt.hash(code, 12);
  const error = await db.transaction(async tx => {
    await lock(tx, userId);
    const [row] = await tx.select().from(verificationCodes).where(eq(verificationCodes.userId, userId));
    if (row) {
      const failure = await verifyUserCode(tx, userId, currentCode ?? "");
      if (failure) return failure;
    }
    await tx.insert(verificationCodes).values({ userId, hash }).onConflictDoUpdate({
      target: verificationCodes.userId, set: { hash, failures: 0, lockedUntil: null, updatedAt: new Date() },
    });
    return null;
  });
  if (error) throw new VerificationCodeError(error);
}
export async function resetVerificationCode(userId: number) {
  await db.transaction(async tx => {
    await lock(tx, userId);
    await tx.delete(verificationCodes).where(eq(verificationCodes.userId, userId));
  });
}
