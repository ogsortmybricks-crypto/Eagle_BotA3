import type { NextFunction, Request, Response } from "express";
import { and, asc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "./db";
import { studios, type Studio } from "@shared/schema";
import {
  effectiveFor,
  resolveOverrides,
  type AcademySettings,
  type EffectiveSettings,
} from "@shared/settings";

/**
 * Studio scoping.
 *
 * An Acton academy is not one governing body - it is three or four. Spark does
 * not share a Contract with Launchpad, does not elect the same people, and does
 * not sit in the same Town Hall. So almost every read in this app is "the rows
 * for the studio I'm looking at, plus anything the academy holds in common".
 *
 * That last part matters: a null `studio_id` means academy-wide, and shows up
 * in every studio rather than none. It is how a shared standard gets recorded
 * once instead of five times.
 */

export type StudioScope = {
  /** The studio being viewed. Null means "everything I'm allowed to see". */
  studioId: number | null;
  studio: Studio | null;
  /** Every studio this person may read. */
  allowed: Studio[];
  allowedIds: number[];
  /** True when `allowed` is the whole academy, so reads need no studio filter. */
  canSeeAll: boolean;
  /** May file things against the academy rather than one studio. */
  canWriteShared: boolean;
  /** Academy settings with this studio's overrides folded in. */
  effective: EffectiveSettings;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      scope?: StudioScope;
    }
  }
}

export async function listStudios(academyId: number, includeArchived = false): Promise<Studio[]> {
  const rows = await db
    .select()
    .from(studios)
    .where(eq(studios.academyId, academyId))
    .orderBy(asc(studios.orderIndex), asc(studios.id));
  return includeArchived ? rows : rows.filter((studio) => !studio.archived);
}

/**
 * Which studios a person may read.
 *
 * Admins see the academy. Guides usually do too - an adult who cannot see the
 * Spark studio's rules cannot help anybody. Learners see their own studio,
 * because another studio's governance is genuinely none of their business, and
 * because a fourteen-year-old reading Spark's Contract is how confusion starts.
 */
export function visibleStudios(
  role: string,
  homeStudioId: number | null,
  all: Studio[],
  settings: { governance: { guidesSeeAllStudios: boolean; learnersSeeAllStudios: boolean } },
): { allowed: Studio[]; canSeeAll: boolean } {
  if (role === "admin") return { allowed: all, canSeeAll: true };
  if (role === "guide" && settings.governance.guidesSeeAllStudios) {
    return { allowed: all, canSeeAll: true };
  }
  if (settings.governance.learnersSeeAllStudios) return { allowed: all, canSeeAll: true };

  // A secretary may be taking notes for more than one studio, but until an
  // academy asks for that the home studio is the honest default.
  const home = all.filter((studio) => studio.id === homeStudioId);
  return { allowed: home, canSeeAll: home.length === all.length && all.length > 0 };
}

/**
 * Resolves the studio for this request from the `x-studio-id` header (the
 * client sends it on every call), falling back to the session, then to the
 * person's home studio. An id they may not see is ignored rather than refused -
 * a stale tab should degrade, not error.
 */
export async function attachStudioScope(req: Request, _res: Response, next: NextFunction) {
  if (!req.user || !req.settings) return next();

  try {
    const all = await listStudios(req.user.academyId);
    const { allowed, canSeeAll } = visibleStudios(
      req.user.role,
      req.user.studioId,
      all,
      req.settings,
    );

    const header = req.header("x-studio-id") ?? (req.query.studioId as string | undefined);
    let studioId: number | null;
    if (header === "all") {
      studioId = null;
    } else if (header !== undefined && header !== "") {
      const parsed = Number(header);
      studioId = Number.isFinite(parsed) ? parsed : null;
    } else if (req.session.studioId !== undefined) {
      studioId = req.session.studioId;
    } else {
      studioId = req.user.studioId;
    }

    const studio = allowed.find((entry) => entry.id === studioId) ?? null;
    if (studio === null) studioId = null;

    req.scope = {
      studioId,
      studio,
      allowed,
      allowedIds: allowed.map((entry) => entry.id),
      canSeeAll,
      canWriteShared: req.user.role === "admin",
      effective: effectiveFor(req.settings, studio ? resolveOverrides(studio.settings) : null),
    };
  } catch (error) {
    console.error("[studio] failed to resolve scope", error);
  }
  next();
}

export function requireScope(req: Request): StudioScope {
  if (!req.scope) throw new Error("Studio scope was not resolved for this request.");
  return req.scope;
}

/**
 * Effective settings for a specific studio, which is not always the one being
 * viewed - certifying a Launchpad election from the "all studios" view still
 * has to use Launchpad's rules.
 */
export async function effectiveForStudio(
  studioId: number | null,
  settings: AcademySettings,
): Promise<EffectiveSettings> {
  if (studioId === null) return effectiveFor(settings, null);
  const [studio] = await db.select().from(studios).where(eq(studios.id, studioId)).limit(1);
  return effectiveFor(settings, studio ? resolveOverrides(studio.settings) : null);
}

/* -------------------------------------------------------------------------- */
/*  Query helpers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The studio predicate for one table's `studio_id` column, or undefined when
 * no restriction applies. Academy-wide rows (null) always pass.
 */
export function studioFilter(column: PgColumn, scope: StudioScope): SQL | undefined {
  if (scope.studioId !== null) return or(eq(column, scope.studioId), isNull(column));
  if (scope.canSeeAll) return undefined;
  if (scope.allowedIds.length === 0) return isNull(column);
  return or(inArray(column, scope.allowedIds), isNull(column));
}

/** `and(...)` that tolerates the filter being undefined. */
export function scoped(base: SQL | undefined, column: PgColumn, scope: StudioScope): SQL {
  const filter = studioFilter(column, scope);
  return (filter ? and(base, filter) : base) as SQL;
}

/**
 * Like `studioFilter`, but also lets through rows a studio has been *shared*
 * into.
 *
 * Two studios often keep one space in common - a Hero Bucks system Middle and
 * Launchpad both run, which Spark has nothing to do with. Making that
 * academy-wide would push it into Spark; duplicating it would let the two
 * copies drift. So the row stays owned by one studio and names the others it
 * is shared with.
 */
export function sharedStudioFilter(
  column: PgColumn,
  sharedColumn: PgColumn,
  scope: StudioScope,
): SQL | undefined {
  const contains = (id: number) => sql`${sharedColumn} @> ${JSON.stringify([id])}::jsonb`;

  if (scope.studioId !== null) {
    return or(eq(column, scope.studioId), isNull(column), contains(scope.studioId));
  }
  if (scope.canSeeAll) return undefined;
  if (scope.allowedIds.length === 0) return isNull(column);
  return or(
    inArray(column, scope.allowedIds),
    isNull(column),
    ...scope.allowedIds.map((id) => contains(id)),
  );
}

/** `scoped`, for tables that support cross-studio sharing. */
export function scopedShared(
  base: SQL | undefined,
  column: PgColumn,
  sharedColumn: PgColumn,
  scope: StudioScope,
): SQL {
  const filter = sharedStudioFilter(column, sharedColumn, scope);
  return (filter ? and(base, filter) : base) as SQL;
}

/** True when this person can read a row owned by `studioId` and shared with `sharedIds`. */
export function canReadShared(
  scope: StudioScope,
  studioId: number | null,
  sharedIds: number[] | null | undefined,
): boolean {
  if (canReadStudio(scope, studioId)) return true;
  return (sharedIds ?? []).some((id) => scope.allowedIds.includes(id));
}

/** Same, but for a column that must match exactly (no academy-wide fallthrough). */
export function strictStudioFilter(column: PgColumn, scope: StudioScope): SQL | undefined {
  if (scope.studioId !== null) return eq(column, scope.studioId);
  if (scope.canSeeAll) return undefined;
  if (scope.allowedIds.length === 0) return isNull(column);
  return inArray(column, scope.allowedIds);
}

/* -------------------------------------------------------------------------- */
/*  Write targets                                                              */
/* -------------------------------------------------------------------------- */

export class StudioChoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioChoiceError";
  }
}

/**
 * Which studio a newly created thing belongs to.
 *
 * `explicit` is what the request asked for: a studio id, or null meaning
 * academy-wide. Anything else falls back to the studio currently being viewed.
 * Refusing to guess here is deliberate - a rule filed against the wrong studio
 * is worse than a form that makes you pick.
 */
export function writeStudioId(scope: StudioScope, explicit?: number | null | undefined): number | null {
  if (explicit !== undefined) {
    if (explicit === null) {
      if (!scope.canWriteShared) {
        throw new StudioChoiceError(
          "Only an admin can file something against the whole academy. Pick a studio.",
        );
      }
      return null;
    }
    if (!scope.allowedIds.includes(explicit)) {
      throw new StudioChoiceError("That isn't a studio you can add to.");
    }
    return explicit;
  }

  if (scope.studioId !== null) return scope.studioId;
  if (scope.canWriteShared) {
    throw new StudioChoiceError(
      "You're viewing every studio. Choose which studio this belongs to, or file it academy-wide.",
    );
  }
  throw new StudioChoiceError("You don't have a studio set. Ask an admin to place you in one.");
}

/** True when this person can read rows carrying `studioId`. */
export function canReadStudio(scope: StudioScope, studioId: number | null): boolean {
  if (studioId === null) return true;
  return scope.allowedIds.includes(studioId);
}

/** Labels a studio for prose: "Middle Studio" or "the whole academy". */
export function studioLabel(studio: Studio | null | undefined): string {
  return studio ? studio.name : "the whole academy";
}

export function slugifyStudio(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "studio"
  );
}

/** Finds a free slug within one academy. */
export async function uniqueStudioSlug(academyId: number, base: string): Promise<string> {
  const wanted = slugifyStudio(base);
  const taken = new Set(
    (await db.select({ slug: studios.slug }).from(studios).where(eq(studios.academyId, academyId))).map(
      (row) => row.slug,
    ),
  );
  if (!taken.has(wanted)) return wanted;
  let n = 2;
  while (taken.has(`${wanted}-${n}`)) n += 1;
  return `${wanted}-${n}`;
}
