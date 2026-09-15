import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { academies } from "@shared/schema";
import { requireAuth, requirePermission } from "../auth";
import { logActivity } from "../activity";
import {
  academySettingsSchema,
  accessSchema,
  aiSchema,
  displaySchema,
  electionsSchema,
  governanceSchema,
  notificationsSchema,
  resolveSettings,
  townHallSchema,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from "@shared/settings";
import { aiConfigured, emailConfigured, env } from "../env";
import { requireScope } from "../studio";

export const settingsRouter = Router();

/**
 * Everyone reads settings - the client needs them to decide what to render -
 * but only an admin writes them. The response also carries what the server
 * can't do (no API key, no SMTP) so the settings page can say so instead of
 * offering a switch that won't work.
 */
settingsRouter.get("/", requireAuth, async (req, res) => {
  const scope = requireScope(req);
  res.json({
    settings: req.settings,
    effective: scope.effective,
    academy: {
      id: req.academy!.id,
      name: req.academy!.name,
      emailDomain: req.academy!.emailDomain,
      learnerNoun: req.academy!.learnerNoun,
      logoUrl: req.academy!.logoUrl,
      palette: req.academy!.palette,
    },
    server: {
      aiConfigured,
      emailConfigured,
      model: env.anthropicModel,
      appUrl: env.appUrl,
    },
  });
});

/**
 * A deep partial patch. Sending `{ elections: { quorumPercent: 50 } }` leaves
 * every other election setting alone - the settings page saves one section at
 * a time and two admins in different tabs shouldn't clobber each other.
 */
const patchSchema = z.object({
  governance: governanceSchema.partial().optional(),
  elections: electionsSchema.partial().optional(),
  townHall: townHallSchema.partial().optional(),
  ai: aiSchema.partial().optional(),
  notifications: notificationsSchema.partial().optional(),
  access: accessSchema.partial().optional(),
  display: displaySchema.partial().optional(),
});

settingsRouter.patch("/", requirePermission("settings.manage"), async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Couldn't save that." });
  }

  const current = resolveSettings(req.academy!.settings);
  const merged = { ...current };
  for (const [section, values] of Object.entries(parsed.data)) {
    if (!values) continue;
    const key = section as keyof typeof merged;
    merged[key] = { ...(merged[key] as object), ...(values as object) } as never;
  }

  const validated = academySettingsSchema.parse(merged);

  // `guidesCanVote` predates the settings blob and is still a column other code
  // reads, so keep the two in step rather than having two sources of truth.
  const [academy] = await db
    .update(academies)
    .set({ settings: validated, guidesCanVote: validated.governance.guidesCanVote })
    .where(eq(academies.id, req.user!.academyId))
    .returning();

  const touched = Object.keys(parsed.data);
  await logActivity({
    academyId: req.user!.academyId,
    actorUserId: req.user!.id,
    action: "settings.updated",
    entityType: "academy",
    entityId: academy.id,
    summary: `${req.user!.name} changed ${touched.join(", ")} settings.`,
    metadata: parsed.data,
  });

  res.json({ settings: validated });
});

/** Puts one section back to the shipped default, for when an academy over-tunes. */
settingsRouter.post("/reset/:section", requirePermission("settings.manage"), async (req, res) => {
  const section = req.params.section as SettingsSection;
  if (!(section in SETTINGS_SECTIONS)) {
    return res.status(400).json({ error: "No such settings section." });
  }

  const current = resolveSettings(req.academy!.settings);
  const defaults = academySettingsSchema.parse({});
  const merged = academySettingsSchema.parse({ ...current, [section]: defaults[section] });

  await db
    .update(academies)
    .set({ settings: merged, guidesCanVote: merged.governance.guidesCanVote })
    .where(eq(academies.id, req.user!.academyId));

  await logActivity({
    academyId: req.user!.academyId,
    actorUserId: req.user!.id,
    action: "settings.reset",
    summary: `${req.user!.name} reset the ${section} settings to their defaults.`,
  });

  res.json({ settings: merged });
});
