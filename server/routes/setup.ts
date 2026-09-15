import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { academies, studios, users, STUDIO_PRESETS } from "@shared/schema";
import { hashPassword } from "../auth";
import { logActivity } from "../activity";
import { aiConfigured, emailConfigured } from "../env";
import { slugifyStudio } from "../studio";
import { DEFAULT_SETTINGS } from "@shared/settings";

export const setupRouter = Router();

const studioInput = z.object({
  name: z.string().min(2).max(60),
  description: z.string().max(600).nullable().optional(),
  ageRange: z.string().max(40).nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#3b82f6"),
  learnerNoun: z.string().min(2).max(30).nullable().optional(),
});

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
  /** The studios this academy runs. At least one, because everything hangs off them. */
  studios: z.array(studioInput).min(1).max(12),
  /** Index into `studios` for the admin's own studio, or null for none. */
  adminStudioIndex: z.number().int().min(0).nullable().optional(),
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
    /** Offered as starting points in the wizard, not a fixed list. */
    studioPresets: STUDIO_PRESETS,
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
      settings: {
        ...DEFAULT_SETTINGS,
        governance: { ...DEFAULT_SETTINGS.governance, guidesCanVote: input.guidesCanVote },
      },
    })
    .returning();

  // Slugs have to be unique per academy and the admin may well have typed
  // "Middle Studio" twice, so de-duplicate here rather than failing the wizard.
  const usedSlugs = new Set<string>();
  const createdStudios = [];
  for (const [index, spec] of input.studios.entries()) {
    let slug = slugifyStudio(spec.name);
    let n = 2;
    while (usedSlugs.has(slug)) slug = `${slugifyStudio(spec.name)}-${n++}`;
    usedSlugs.add(slug);

    const [studio] = await db
      .insert(studios)
      .values({
        academyId: academy.id,
        name: spec.name.trim(),
        slug,
        description: spec.description?.trim() || null,
        ageRange: spec.ageRange?.trim() || null,
        color: spec.color,
        learnerNoun: spec.learnerNoun?.trim() || null,
        orderIndex: index,
      })
      .returning();
    createdStudios.push(studio);
  }

  const adminStudio =
    input.adminStudioIndex !== null && input.adminStudioIndex !== undefined
      ? (createdStudios[input.adminStudioIndex] ?? null)
      : null;

  const [admin] = await db
    .insert(users)
    .values({
      academyId: academy.id,
      email: adminEmail,
      name: input.adminName.trim(),
      passwordHash: await hashPassword(input.password),
      role: "admin",
      studioId: adminStudio?.id ?? null,
      lastLoginAt: new Date(),
    })
    .returning();

  req.session.userId = admin.id;
  req.session.studioId = adminStudio?.id ?? null;

  await logActivity({
    academyId: academy.id,
    actorUserId: admin.id,
    action: "academy.created",
    entityType: "academy",
    entityId: academy.id,
    summary: `${admin.name} set up ${academy.name} on Eagle Bot with ${createdStudios.length} studio${
      createdStudios.length === 1 ? "" : "s"
    }: ${createdStudios.map((studio) => studio.name).join(", ")}.`,
    metadata: { studios: createdStudios.map((studio) => studio.name) },
  });

  res.status(201).json({ ok: true, studios: createdStudios });
});
