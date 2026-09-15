import { Router } from "express";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { academies, invites, positionHolders, positions, studios, users } from "@shared/schema";
import { hashPassword, publicUser, requireAuth, verifyPassword } from "../auth";
import { logActivity } from "../activity";
import { effectivePermissions } from "@shared/permissions";
import { resolveSettings } from "@shared/settings";
import { listStudios, visibleStudios } from "../studio";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const parsed = z
    .object({ email: z.string().email(), password: z.string().min(1) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter your email and password." });

  const email = parsed.data.email.trim().toLowerCase();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  // Same message either way - don't confirm which emails exist.
  const genericFailure = { error: "That email and password don't match." };
  if (!user || !user.passwordHash) return res.status(401).json(genericFailure);
  if (!user.active) {
    return res.status(403).json({ error: "This account has been deactivated. Ask an admin." });
  }
  if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return res.status(401).json(genericFailure);
  }

  req.session.userId = user.id;
  // Open on their own studio unless they've deliberately switched before.
  if (req.session.studioId === undefined) req.session.studioId = user.studioId;
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

  await logActivity({
    academyId: user.academyId,
    studioId: user.studioId,
    actorUserId: user.id,
    action: "auth.login",
    entityType: "user",
    entityId: user.id,
    summary: `${user.name} signed in.`,
  });

  res.json({ user: publicUser(user) });
});

authRouter.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

/** Everything the client needs to render the shell for the signed-in user. */
authRouter.get("/me", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not signed in." });

  const [academy] = await db
    .select()
    .from(academies)
    .where(eq(academies.id, req.user.academyId))
    .limit(1);

  const settings = resolveSettings(academy?.settings);
  const all = await listStudios(req.user.academyId);
  const { allowed, canSeeAll } = visibleStudios(
    req.user.role,
    req.user.studioId,
    all,
    settings,
  );

  const scope = req.scope;
  const selectedStudioId = scope?.studioId ?? null;
  const selected = allowed.find((studio) => studio.id === selectedStudioId) ?? null;

  const held = await db
    .select({
      id: positionHolders.id,
      positionId: positionHolders.positionId,
      title: positions.title,
      studioId: positions.studioId,
      startedAt: positionHolders.startedAt,
      endedAt: positionHolders.endedAt,
    })
    .from(positionHolders)
    .innerJoin(positions, eq(positions.id, positionHolders.positionId))
    .where(and(eq(positionHolders.userId, req.user.id), isNull(positionHolders.endedAt)));

  const [homeStudio] = req.user.studioId
    ? await db.select().from(studios).where(eq(studios.id, req.user.studioId)).limit(1)
    : [null];

  /**
   * Simple mode is a property of the studio a person *belongs to*, not the one
   * they happen to be viewing: a Spark learner gets the stripped-back app
   * everywhere, and a Guide looking at Spark still gets the full tool because
   * they are the one who has to fix things. An admin can preview it from
   * Settings without changing anyone else's experience.
   */
  const previewSimple = req.session.previewSimpleMode === true;
  const simpleMode =
    (req.user.role === "learner" && (homeStudio?.simpleMode ?? false)) || previewSimple;

  res.json({
    user: publicUser(req.user),
    academy,
    settings,
    permissions: effectivePermissions(req.user.role, settings),
    currentPositions: held,
    studios: allowed,
    /** The studio this session is looking at. Null means every studio at once. */
    selectedStudioId,
    /** Whatever noun the selected studio uses, falling back to the academy's. */
    learnerNoun: selected?.learnerNoun ?? academy?.learnerNoun ?? "Hero",
    homeStudio: homeStudio ?? null,
    canSeeAllStudios: canSeeAll,
    effective: scope?.effective ?? null,
    simpleMode,
    /** True when the full view is only hidden because the admin asked to preview. */
    simpleModePreview: previewSimple,
  });
});

/**
 * Lets an admin see exactly what a Spark learner sees.
 *
 * Session-scoped and reversible - it changes nothing for anyone else, which is
 * the only honest way to offer a preview of a mode built for six-year-olds.
 */
authRouter.post("/preview-simple", requireAuth, async (req, res) => {
  const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Say on or off." });
  if (req.user!.role !== "admin" && req.user!.role !== "guide") {
    return res.status(403).json({ error: "Only an admin or guide can preview simple mode." });
  }
  req.session.previewSimpleMode = parsed.data.enabled;
  res.json({ ok: true, enabled: parsed.data.enabled });
});

authRouter.post("/password", requireAuth, async (req, res) => {
  const minimum = req.settings!.access.minPasswordLength;
  const parsed = z
    .object({ current: z.string().min(1), next: z.string().min(minimum) })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: `New password needs at least ${minimum} characters.` });
  }
  const user = req.user!;
  if (!user.passwordHash || !(await verifyPassword(parsed.data.current, user.passwordHash))) {
    return res.status(401).json({ error: "Your current password isn't right." });
  }
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(parsed.data.next) })
    .where(eq(users.id, user.id));

  await logActivity({
    academyId: user.academyId,
    studioId: user.studioId,
    actorUserId: user.id,
    action: "auth.password_changed",
    entityType: "user",
    entityId: user.id,
    summary: `${user.name} changed their password.`,
  });

  res.json({ ok: true });
});

/* ------------------------------- invites --------------------------------- */

authRouter.get("/invite/:token", async (req, res) => {
  const [invite] = await db
    .select()
    .from(invites)
    .where(eq(invites.token, req.params.token))
    .limit(1);

  if (!invite) return res.status(404).json({ error: "That invite link isn't valid." });
  if (invite.acceptedAt) return res.status(410).json({ error: "That invite has already been used." });
  if (invite.expiresAt < new Date()) {
    return res.status(410).json({ error: "That invite has expired. Ask an admin for a new one." });
  }

  const [academy] = await db
    .select()
    .from(academies)
    .where(eq(academies.id, invite.academyId))
    .limit(1);

  const [studio] = invite.studioId
    ? await db.select().from(studios).where(eq(studios.id, invite.studioId)).limit(1)
    : [null];

  res.json({
    email: invite.email,
    name: invite.name,
    role: invite.role,
    studio: studio ? { name: studio.name, description: studio.description, color: studio.color } : null,
    minPasswordLength: resolveSettings(academy?.settings).access.minPasswordLength,
    academy: { name: academy?.name, palette: academy?.palette, logoUrl: academy?.logoUrl },
  });
});

authRouter.post("/invite/:token", async (req, res) => {
  const [invite] = await db
    .select()
    .from(invites)
    .where(eq(invites.token, req.params.token))
    .limit(1);

  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    return res.status(410).json({ error: "That invite is no longer usable." });
  }

  const [academy] = await db
    .select()
    .from(academies)
    .where(eq(academies.id, invite.academyId))
    .limit(1);
  const minimum = resolveSettings(academy?.settings).access.minPasswordLength;

  const parsed = z
    .object({ name: z.string().min(2).max(120), password: z.string().min(minimum) })
    .safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: `Enter your name and a password of at least ${minimum} characters.` });
  }

  const [existing] = await db.select().from(users).where(eq(users.email, invite.email)).limit(1);
  if (existing) {
    return res.status(409).json({ error: "There's already an account for that email. Try signing in." });
  }

  const [user] = await db
    .insert(users)
    .values({
      academyId: invite.academyId,
      email: invite.email,
      name: parsed.data.name.trim(),
      passwordHash: await hashPassword(parsed.data.password),
      role: invite.role,
      studioId: invite.studioId,
      lastLoginAt: new Date(),
    })
    .returning();

  await db.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, invite.id));
  req.session.userId = user.id;
  req.session.studioId = user.studioId;

  await logActivity({
    academyId: user.academyId,
    studioId: user.studioId,
    actorUserId: user.id,
    action: "invite.accepted",
    entityType: "user",
    entityId: user.id,
    summary: `${user.name} joined as ${user.role}.`,
  });

  res.status(201).json({ user: publicUser(user) });
});
