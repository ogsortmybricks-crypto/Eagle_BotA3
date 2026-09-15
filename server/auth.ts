import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { academies, users, type Academy, type Role, type User } from "@shared/schema";
import { can } from "@shared/permissions";
import { resolveSettings, type AcademySettings } from "@shared/settings";

declare module "express-session" {
  interface SessionData {
    userId?: number;
    /** Last studio this person was looking at, so the app reopens where they left. */
    studioId?: number | null;
    /** An admin checking what the simple view looks like. Affects only them. */
    previewSimpleMode?: boolean;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      academy?: Academy;
      /** Always present once `attachUser` has run for a signed-in request. */
      settings?: AcademySettings;
    }
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Loads req.user, their academy, and the academy's settings on every request.
 *
 * The academy comes along because permission checks now depend on settings -
 * whether learners may edit the wiki, for instance - so there is no useful
 * point at which we have a user but not their settings. Never rejects.
 */
export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.session?.userId) return next();
  try {
    const [found] = await db.select().from(users).where(eq(users.id, req.session.userId)).limit(1);
    if (found && found.active) {
      req.user = found;
      const [academy] = await db
        .select()
        .from(academies)
        .where(eq(academies.id, found.academyId))
        .limit(1);
      if (academy) {
        req.academy = academy;
        req.settings = resolveSettings(academy.settings);
      }
    }
  } catch (error) {
    console.error("[auth] failed to load session user", error);
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Sign in to continue." });
  next();
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Sign in to continue." });
    if (!can(req.user.role, permission, req.settings)) {
      return res.status(403).json({
        error: `Your role (${req.user.role}) can't do that.`,
        permission,
      });
    }
    next();
  };
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Sign in to continue." });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You don't have access to that." });
    }
    next();
  };
}

/** Public shape of a user - never leaks the password hash. */
export function publicUser(user: User) {
  const { passwordHash, ...rest } = user;
  void passwordHash;
  return rest;
}
