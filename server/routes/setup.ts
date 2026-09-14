import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { academies, users } from "@shared/schema";
import { hashPassword } from "../auth";
import { logActivity } from "../activity";
import { aiConfigured, emailConfigured } from "../env";

export const setupRouter = Router();

const setupSchema = z.object({
  academyName: z.string().min(2).max(120),
  emailDomain: z
    .string()
    .min(3)
    .max(120)
    .transform((value) => value.trim().toLowerCase().replace(/^@/, ""))
    .refine((value) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(value), {
      message: "That doesn't look like an email domain. Try something like youracton.com",
    }),
  adminName: z.string().min(2).max(120),
  adminEmail: z.string().email(),
  password: z.string().min(8, "Use at least 8 characters."),
  palette: z.object({
    primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    surface: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
  logoUrl: z.string().max(1_500_000).nullable().optional(),
  learnerNoun: z.string().min(2).max(30).default("Hero"),
  guidesCanVote: z.boolean().default(false),
});

/** Tells the client whether to show the setup wizard or the login screen. */
setupRouter.get("/status", async (_req, res) => {
  const [academy] = await db.select().from(academies).limit(1);
  res.json({
    needsSetup: !academy,
    academy: academy
      ? {
          id: academy.id,
          name: academy.name,
          palette: academy.palette,
          logoUrl: academy.logoUrl,
          learnerNoun: academy.learnerNoun,
          emailDomain: academy.emailDomain,
        }
      : null,
    aiConfigured,
    emailConfigured,
  });
});

setupRouter.post("/", async (req, res) => {
  const [existing] = await db.select().from(academies).limit(1);
  if (existing) {
    return res.status(409).json({ error: "This Eagle Bot already belongs to an academy." });
  }

  const parsed = setupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the form." });
  }
  const input = parsed.data;

  const adminEmail = input.adminEmail.trim().toLowerCase();
  if (!adminEmail.endsWith(`@${input.emailDomain}`)) {
    return res.status(400).json({
      error: `Your email needs to be on the academy's domain (@${input.emailDomain}). That domain is what keeps outsiders from joining.`,
    });
  }

  const [academy] = await db
    .insert(academies)
    .values({
      name: input.academyName.trim(),
      emailDomain: input.emailDomain,
      palette: input.palette,
      logoUrl: input.logoUrl ?? null,
      learnerNoun: input.learnerNoun,
      guidesCanVote: input.guidesCanVote,
    })
    .returning();

  const [admin] = await db
    .insert(users)
    .values({
      academyId: academy.id,
      email: adminEmail,
      name: input.adminName.trim(),
      passwordHash: await hashPassword(input.password),
      role: "admin",
      lastLoginAt: new Date(),
    })
    .returning();

  req.session.userId = admin.id;

  await logActivity({
    academyId: academy.id,
    actorUserId: admin.id,
    action: "academy.created",
    entityType: "academy",
    entityId: academy.id,
    summary: `${admin.name} set up ${academy.name} on Eagle Bot.`,
  });

  res.status(201).json({ ok: true });
});
