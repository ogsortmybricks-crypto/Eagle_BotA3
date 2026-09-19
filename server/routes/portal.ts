/**
 * The dev portal.
 *
 * A different door into the same building. Academy staff never see it; you get
 * there with Ctrl+D and a set of credentials that has nothing to do with any
 * academy. Portal devs maintain Eagle Bot itself: they publish the official
 * Tac-Ons, send notices every academy sees, and can pull a Tac-On that turns
 * out to be a problem.
 *
 * The separation is the point. No academy admin can promote themselves into
 * this, because portal accounts live in their own table and are only ever
 * created by an existing portal dev - or, once, by whoever sets the deployment
 * up in the first place.
 */

import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db";
import {
  TACON_VISIBILITIES,
  portalDevs,
  portalInvites,
  portalNotices,
  taconInstalls,
  taconVersions,
  tacons,
  type PortalDev,
} from "@shared/schema";
import { hashPassword, verifyPassword } from "../auth";
import { env } from "../env";
import { compile } from "@shared/tacons";

export const portalRouter = Router();

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      portalDev?: PortalDev;
    }
  }
}

async function attachPortalDev(req: Request, _res: Response, next: NextFunction) {
  if (!req.session?.portalDevId) return next();
  try {
    const [dev] = await db
      .select()
      .from(portalDevs)
      .where(eq(portalDevs.id, req.session.portalDevId))
      .limit(1);
    if (dev && dev.active) req.portalDev = dev;
  } catch (error) {
    console.error("[portal] couldn't load the signed-in dev", error);
  }
  next();
}

function requirePortal(req: Request, res: Response, next: NextFunction) {
  if (!req.portalDev) return res.status(401).json({ error: "Sign in to the dev portal." });
  next();
}

function requireHead(req: Request, res: Response, next: NextFunction) {
  if (!req.portalDev) return res.status(401).json({ error: "Sign in to the dev portal." });
  if (!req.portalDev.head) {
    return res.status(403).json({ error: "Only the head dev can do that." });
  }
  next();
}

function publicDev(dev: PortalDev) {
  const { passwordHash, ...rest } = dev;
  void passwordHash;
  return rest;
}

portalRouter.use(attachPortalDev);

/* -------------------------------------------------------------------------- */
/*  Getting in                                                                 */
/* -------------------------------------------------------------------------- */

async function headExists(): Promise<boolean> {
  const [row] = await db.select({ total: sql<number>`count(*)` }).from(portalDevs);
  return Number(row?.total ?? 0) > 0;
}

portalRouter.get("/status", async (req, res) => {
  res.json({
    needsSetup: !(await headExists()),
    /** Whether a setup key is required, so the form can say so honestly. */
    setupKeyRequired: Boolean(env.portalSetupKey) || env.isProduction,
    dev: req.portalDev ? publicDev(req.portalDev) : null,
  });
});

/**
 * Claims the head dev account. Works exactly once, and in production needs
 * DEV_PORTAL_SETUP_KEY - otherwise the first person to find Ctrl+D owns the
 * deployment.
 */
portalRouter.post("/setup", async (req, res) => {
  if (await headExists()) {
    return res.status(409).json({ error: "The dev portal already has a head dev." });
  }

  const parsed = z
    .object({
      name: z.string().min(2).max(120),
      email: z.string().email(),
      password: z.string().min(10),
      key: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Name, email and a password of at least 10 characters." });
  }

  if (env.portalSetupKey) {
    if (parsed.data.key !== env.portalSetupKey) {
      return res.status(403).json({ error: "That setup key isn't right." });
    }
  } else if (env.isProduction) {
    return res.status(403).json({
      error: "Set DEV_PORTAL_SETUP_KEY on the server before claiming the portal.",
    });
  }

  const [dev] = await db
    .insert(portalDevs)
    .values({
      email: parsed.data.email.trim().toLowerCase(),
      name: parsed.data.name.trim(),
      passwordHash: await hashPassword(parsed.data.password),
      head: true,
      lastLoginAt: new Date(),
    })
    .returning();

  req.session.portalDevId = dev.id;
  res.status(201).json({ dev: publicDev(dev) });
});

portalRouter.post("/login", async (req, res) => {
  const parsed = z
    .object({ email: z.string().email(), password: z.string().min(1) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter your email and password." });

  const [dev] = await db
    .select()
    .from(portalDevs)
    .where(eq(portalDevs.email, parsed.data.email.trim().toLowerCase()))
    .limit(1);

  const generic = { error: "That email and password don't match." };
  if (!dev || !dev.active) return res.status(401).json(generic);
  if (!(await verifyPassword(parsed.data.password, dev.passwordHash))) {
    return res.status(401).json(generic);
  }

  req.session.portalDevId = dev.id;
  await db.update(portalDevs).set({ lastLoginAt: new Date() }).where(eq(portalDevs.id, dev.id));
  res.json({ dev: publicDev(dev) });
});

portalRouter.post("/logout", (req, res) => {
  // Only the portal half of the session goes - an admin who happened to be
  // signed into their academy in the same browser stays signed in there.
  delete req.session.portalDevId;
  res.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/*  Invites                                                                    */
/* -------------------------------------------------------------------------- */

portalRouter.get("/devs", requirePortal, async (_req, res) => {
  const devs = await db.select().from(portalDevs).orderBy(desc(portalDevs.head), portalDevs.name);
  const invites = await db
    .select()
    .from(portalInvites)
    .where(isNull(portalInvites.acceptedAt))
    .orderBy(desc(portalInvites.createdAt));
  res.json({ devs: devs.map(publicDev), invites });
});

portalRouter.post("/invites", requireHead, async (req, res) => {
  const parsed = z
    .object({ email: z.string().email(), name: z.string().max(120).optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter an email address." });

  const email = parsed.data.email.trim().toLowerCase();
  const [existing] = await db.select().from(portalDevs).where(eq(portalDevs.email, email)).limit(1);
  if (existing) return res.status(409).json({ error: "That person already has portal access." });

  const token = nanoid(48);
  const [invite] = await db
    .insert(portalInvites)
    .values({
      email,
      name: parsed.data.name ?? null,
      token,
      invitedBy: req.portalDev!.id,
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    })
    .returning();

  // The portal has no mailer of its own; the head dev passes the link on.
  res.status(201).json({ invite, link: `${env.appUrl}/dev-portal/invite/${token}` });
});

portalRouter.get("/invites/:token", async (req, res) => {
  const [invite] = await db
    .select()
    .from(portalInvites)
    .where(eq(portalInvites.token, req.params.token))
    .limit(1);
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    return res.status(410).json({ error: "That invite is no longer usable." });
  }
  res.json({ email: invite.email, name: invite.name });
});

portalRouter.post("/invites/:token", async (req, res) => {
  const parsed = z
    .object({ name: z.string().min(2).max(120), password: z.string().min(10) })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Enter your name and a password of at least 10 characters." });
  }

  const [invite] = await db
    .select()
    .from(portalInvites)
    .where(eq(portalInvites.token, req.params.token))
    .limit(1);
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    return res.status(410).json({ error: "That invite is no longer usable." });
  }

  const [dev] = await db
    .insert(portalDevs)
    .values({
      email: invite.email,
      name: parsed.data.name.trim(),
      passwordHash: await hashPassword(parsed.data.password),
      head: false,
      lastLoginAt: new Date(),
    })
    .returning();

  await db
    .update(portalInvites)
    .set({ acceptedAt: new Date() })
    .where(eq(portalInvites.id, invite.id));

  req.session.portalDevId = dev.id;
  res.status(201).json({ dev: publicDev(dev) });
});

/* -------------------------------------------------------------------------- */
/*  Notices                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What every academy sees.
 *
 * Open to any signed-in person, because a notice nobody reads is not a notice -
 * but filtered here rather than in the browser, so a notice aimed at admins
 * does not travel to everyone's laptop first.
 */
portalRouter.get("/notices/active", async (req, res) => {
  if (!req.user && !req.portalDev) {
    return res.status(401).json({ error: "Sign in to continue." });
  }

  const audiences = ["everyone"];
  if (req.portalDev) {
    audiences.push("admins", "devs");
  } else if (req.user) {
    if (req.user.role === "admin") audiences.push("admins");
    if (req.user.devStatus) audiences.push("devs");
  }

  const now = new Date();
  const notices = await db
    .select({
      id: portalNotices.id,
      title: portalNotices.title,
      body: portalNotices.body,
      tone: portalNotices.tone,
      audience: portalNotices.audience,
      createdAt: portalNotices.createdAt,
    })
    .from(portalNotices)
    .where(
      and(
        eq(portalNotices.active, true),
        inArray(portalNotices.audience, audiences),
        or(isNull(portalNotices.expiresAt), sql`${portalNotices.expiresAt} > ${now}`),
      ),
    )
    .orderBy(desc(portalNotices.createdAt))
    .limit(5);
  res.json({ notices });
});

portalRouter.get("/notices", requirePortal, async (_req, res) => {
  const notices = await db.select().from(portalNotices).orderBy(desc(portalNotices.createdAt));
  res.json({ notices });
});

const noticeSchema = z.object({
  title: z.string().min(3).max(140),
  body: z.string().min(3).max(4000),
  tone: z.enum(["info", "warning", "release"]).default("info"),
  audience: z.enum(["everyone", "admins", "devs"]).default("admins"),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

portalRouter.post("/notices", requirePortal, async (req, res) => {
  const parsed = noticeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the notice." });
  }

  const [notice] = await db
    .insert(portalNotices)
    .values({
      title: parsed.data.title,
      body: parsed.data.body,
      tone: parsed.data.tone,
      audience: parsed.data.audience,
      publishedBy: req.portalDev!.id,
      expiresAt: parsed.data.expiresInDays
        ? new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000)
        : null,
    })
    .returning();

  res.status(201).json({ notice });
});

portalRouter.patch("/notices/:id", requirePortal, async (req, res) => {
  const parsed = z.object({ active: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Say on or off." });

  const [notice] = await db
    .update(portalNotices)
    .set({ active: parsed.data.active })
    .where(eq(portalNotices.id, Number(req.params.id)))
    .returning();
  if (!notice) return res.status(404).json({ error: "No such notice." });
  res.json({ notice });
});

/* -------------------------------------------------------------------------- */
/*  Official Tac-Ons, and the registry as a whole                              */
/* -------------------------------------------------------------------------- */

portalRouter.get("/tacons", requirePortal, async (_req, res) => {
  const rows = await db
    .select({ tacon: tacons, version: taconVersions })
    .from(tacons)
    .leftJoin(taconVersions, eq(taconVersions.id, tacons.latestVersionId))
    .orderBy(desc(tacons.official), desc(tacons.installCount));

  const installs = await db
    .select({ taconId: taconInstalls.taconId, academyId: taconInstalls.academyId })
    .from(taconInstalls);

  res.json({
    tacons: rows.map((row) => ({
      id: row.tacon.id,
      slug: row.tacon.slug,
      name: row.tacon.name,
      tagline: row.tacon.tagline,
      icon: row.tacon.icon,
      official: row.tacon.official,
      visibility: row.tacon.visibility,
      authorName: row.tacon.authorName,
      installCount: row.tacon.installCount,
      suspendedReason: row.tacon.suspendedReason,
      version: row.version?.version ?? null,
      source: row.version?.source ?? "",
      academies: new Set(
        installs.filter((install) => install.taconId === row.tacon.id).map((i) => i.academyId),
      ).size,
    })),
  });
});

const officialSchema = z.object({
  source: z.string().min(10).max(200_000),
  tagline: z.string().max(200).optional(),
  description: z.string().max(20_000).optional(),
  changelog: z.string().max(2000).optional(),
  visibility: z.enum(TACON_VISIBILITIES).default("public"),
});

/** Publishes an official Tac-On. Same compiler, same rules, different badge. */
portalRouter.post("/tacons/publish", requirePortal, async (req, res) => {
  const parsed = officialSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the form." });
  }

  const result = compile(parsed.data.source);
  if (!result.ok) {
    return res.status(400).json({
      error: "This Tac-On doesn't compile yet.",
      diagnostics: result.diagnostics,
    });
  }
  const manifest = result.manifest;

  const [existing] = await db.select().from(tacons).where(eq(tacons.slug, manifest.slug)).limit(1);
  if (existing && !existing.official) {
    return res.status(409).json({
      error: `"${manifest.slug}" belongs to ${existing.authorName}. Publishing over an academy's Tac-On isn't something the portal does.`,
    });
  }

  let tacon = existing;
  if (!tacon) {
    const [created] = await db
      .insert(tacons)
      .values({
        slug: manifest.slug,
        name: manifest.name,
        tagline: parsed.data.tagline ?? manifest.about.slice(0, 200),
        description: parsed.data.description ?? "",
        icon: manifest.icon,
        category: manifest.category,
        academyId: null,
        authorPortalId: req.portalDev!.id,
        authorName: "Eagle Bot",
        official: true,
        visibility: parsed.data.visibility,
      })
      .returning();
    tacon = created;
  }

  const [clash] = await db
    .select()
    .from(taconVersions)
    .where(and(eq(taconVersions.taconId, tacon.id), eq(taconVersions.version, manifest.version)))
    .limit(1);
  if (clash) {
    return res
      .status(409)
      .json({ error: `Version ${manifest.version} is already published. Bump the version line.` });
  }

  const [version] = await db
    .insert(taconVersions)
    .values({
      taconId: tacon.id,
      version: manifest.version,
      source: parsed.data.source,
      manifest: manifest as unknown as Record<string, unknown>,
      changelog: parsed.data.changelog ?? null,
      publishedByPortalId: req.portalDev!.id,
    })
    .returning();

  await db
    .update(tacons)
    .set({
      name: manifest.name,
      icon: manifest.icon,
      category: manifest.category,
      latestVersionId: version.id,
      tagline: parsed.data.tagline ?? tacon.tagline,
      description: parsed.data.description ?? tacon.description,
      visibility: parsed.data.visibility,
      updatedAt: new Date(),
    })
    .where(eq(tacons.id, tacon.id));

  res.status(201).json({ tacon: { id: tacon.id, slug: tacon.slug }, version: version.version });
});

/**
 * Pulls a Tac-On from the market.
 *
 * Existing installs keep working: an academy that built a term's records on it
 * should not lose them because the portal disagreed with the author. What stops
 * is new installs, and the listing says why.
 */
portalRouter.post("/tacons/:id/suspend", requireHead, async (req, res) => {
  const parsed = z.object({ reason: z.string().max(300).nullable() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give a reason, or null to restore." });

  const [tacon] = await db
    .update(tacons)
    .set({ suspendedReason: parsed.data.reason, updatedAt: new Date() })
    .where(eq(tacons.id, Number(req.params.id)))
    .returning();
  if (!tacon) return res.status(404).json({ error: "No such Tac-On." });

  res.json({ tacon });
});
