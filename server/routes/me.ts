import { Router } from "express";
import { and, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { absences, users } from "@shared/schema";
import { verifyPassword } from "../auth";
import { logActivity } from "../activity";
import { VerifyCodeError, setVerifyCode } from "../personal";
import { hasVerificationCode } from "../verification-code";

/** Settings that belong to the signed-in person: their code and their attendance. */
export const meRouter = Router();

const DAY = /^\d{4}-\d{2}-\d{2}$/;

meRouter.get("/personal", async (req, res) => {
  const user = req.user!;
  // A term's worth back is plenty for the settings list; Tac-Ons ask for their own ranges.
  const since = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
  const rows = await db
    .select()
    .from(absences)
    .where(and(eq(absences.userId, user.id), gte(absences.day, since)))
    .orderBy(desc(absences.day));
  res.json({
    hasVerifyCode: await hasVerificationCode(user.id),
    attendanceDays: user.attendanceDays,
    absences: rows.map((row) => ({ day: row.day, kind: row.kind, note: row.note })),
  });
});

meRouter.put("/verify-code", async (req, res) => {
  const parsed = z.object({ code: z.string(), password: z.string().min(1), currentCode: z.string().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a six-digit code and your password." });
  const user = req.user!;
  // Your password, so someone at your open laptop can't quietly set a code they know.
  if (!user.passwordHash || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return res.status(401).json({ error: "Your password isn't right." });
  }
  try {
    await setVerifyCode(user.id, parsed.data.code, parsed.data.currentCode);
  } catch (error) {
    if (error instanceof VerifyCodeError) return res.status(400).json({ error: error.message });
    throw error;
  }
  await logActivity({
    academyId: user.academyId,
    studioId: user.studioId,
    actorUserId: user.id,
    action: "user.verify_code_set",
    entityType: "user",
    entityId: user.id,
    summary: `${user.name} set their account confirmation code.`,
  });
  res.json({ ok: true });
});

meRouter.put("/attendance", async (req, res) => {
  const parsed = z.object({ days: z.array(z.number().int().min(0).max(6)).max(7) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Pick the days you're normally in." });
  const days = [...new Set(parsed.data.days)].sort();
  await db.update(users).set({ attendanceDays: days }).where(eq(users.id, req.user!.id));
  res.json({ ok: true, days });
});

meRouter.post("/absences", async (req, res) => {
  const parsed = z
    .object({
      day: z.string().regex(DAY).refine(day => {
        const date = new Date(`${day}T12:00:00Z`);
        return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
      }),
      kind: z.enum(["sick", "other"]).default("sick"),
      note: z.string().max(300).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Pick the day you missed." });
  const user = req.user!;
  // Recording a sick day ahead of time is fine for an appointment, but not months out.
  const limit = new Date(Date.now() + 31 * 86_400_000).toISOString().slice(0, 10);
  if (parsed.data.day > limit) return res.status(400).json({ error: "That's too far ahead to record." });
  await db
    .insert(absences)
    .values({ academyId: user.academyId, userId: user.id, day: parsed.data.day, kind: parsed.data.kind, note: parsed.data.note?.trim() || null })
    .onConflictDoUpdate({
      target: [absences.userId, absences.day],
      set: { kind: parsed.data.kind, note: parsed.data.note?.trim() || null },
    });
  res.status(201).json({ ok: true });
});

meRouter.delete("/absences/:day", async (req, res) => {
  if (!DAY.test(req.params.day)) return res.status(400).json({ error: "That isn't a day." });
  await db.delete(absences).where(and(eq(absences.userId, req.user!.id), eq(absences.day, req.params.day)));
  res.json({ ok: true });
});
