import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  aiFindings,
  positions,
  wikiRevisions,
  wikiRules,
  wikiSections,
} from "@shared/schema";
import type { FindingSpec, PositionSpec, WikiOperation } from "./schemas";

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "section"
  );
}

async function uniqueSlug(academyId: number, base: string): Promise<string> {
  const slug = slugify(base);
  const existing = await db
    .select({ slug: wikiSections.slug })
    .from(wikiSections)
    .where(eq(wikiSections.academyId, academyId));
  const taken = new Set(existing.map((row) => row.slug));
  if (!taken.has(slug)) return slug;
  let n = 2;
  while (taken.has(`${slug}-${n}`)) n += 1;
  return `${slug}-${n}`;
}

export type ApplyOutcome = {
  created: number;
  amended: number;
  repealed: number;
  moved: number;
  sectionsCreated: number;
  /** Ops that named a rule or section that doesn't exist. Surfaced to the admin. */
  skipped: string[];
  ruleIdsTouched: number[];
};

/**
 * Executes AI-authored operations against the wiki.
 *
 * Every single change writes a `wiki_revisions` row carrying the before text,
 * the after text, and the rationale, tagged with the job that caused it. That
 * trail is what makes `revertJob` possible and what the wiki's history view
 * reads from.
 */
export async function applyOperations(opts: {
  academyId: number;
  operations: WikiOperation[];
  actorUserId: number | null;
  actorType: "user" | "ai";
  sourceType: string;
  sourceRef: string | null;
  jobId: number | null;
  /** The studio these changes belong to. New sections are filed against it. */
  studioId: number | null;
  /** Maps a create_section op's key to the section it made, within this batch. */
  sectionKeyMap?: Map<string, number>;
}): Promise<ApplyOutcome> {
  const outcome: ApplyOutcome = {
    created: 0,
    amended: 0,
    repealed: 0,
    moved: 0,
    sectionsCreated: 0,
    skipped: [],
    ruleIdsTouched: [],
  };

  const keyToSectionId = opts.sectionKeyMap ?? new Map<string, number>();

  // Existing sections are addressable by slug - but only the ones this studio
  // can actually see, so an operation can never reach into another studio's
  // Contract by naming its slug.
  const existingSections = (
    await db.select().from(wikiSections).where(eq(wikiSections.academyId, opts.academyId))
  ).filter(
    (section) =>
      opts.studioId === null ||
      section.studioId === opts.studioId ||
      section.studioId === null,
  );
  for (const section of existingSections) keyToSectionId.set(section.slug, section.id);
  const reachableSectionIds = new Set(existingSections.map((section) => section.id));

  const revisionBase = {
    academyId: opts.academyId,
    actorUserId: opts.actorUserId,
    actorType: opts.actorType,
    sourceType: opts.sourceType,
    sourceRef: opts.sourceRef,
    jobId: opts.jobId,
  };

  // create_section first, so create_rule ops in the same batch can target them.
  for (const op of opts.operations) {
    if (op.op !== "create_section") continue;
    const slug = await uniqueSlug(opts.academyId, op.key || op.title);
    const [maxOrder] = await db
      .select({ max: sql<number>`coalesce(max(${wikiSections.orderIndex}), -1)` })
      .from(wikiSections)
      .where(eq(wikiSections.academyId, opts.academyId));
    const [section] = await db
      .insert(wikiSections)
      .values({
        academyId: opts.academyId,
        studioId: opts.studioId,
        title: op.title,
        slug,
        summary: op.summary,
        orderIndex: (maxOrder?.max ?? -1) + 1,
      })
      .returning();
    keyToSectionId.set(op.key, section.id);
    keyToSectionId.set(slug, section.id);
    reachableSectionIds.add(section.id);
    outcome.sectionsCreated += 1;
  }

  for (const op of opts.operations) {
    switch (op.op) {
      case "create_section":
        break; // already handled

      case "create_rule": {
        const sectionId = keyToSectionId.get(op.sectionKey);
        if (!sectionId) {
          outcome.skipped.push(`Couldn't add "${op.title}" - no section called "${op.sectionKey}".`);
          break;
        }
        const [maxOrder] = await db
          .select({ max: sql<number>`coalesce(max(${wikiRules.orderIndex}), -1)` })
          .from(wikiRules)
          .where(eq(wikiRules.sectionId, sectionId));
        const [rule] = await db
          .insert(wikiRules)
          .values({
            academyId: opts.academyId,
            sectionId,
            title: op.title,
            body: op.body,
            status: "active",
            orderIndex: (maxOrder?.max ?? -1) + 1,
            sourceType: opts.sourceType,
            sourceRef: opts.sourceRef,
            citation: op.rationale,
            effectiveFrom: new Date(),
            createdBy: opts.actorUserId,
          })
          .returning();
        await db.insert(wikiRevisions).values({
          ...revisionBase,
          ruleId: rule.id,
          changeType: "created",
          titleAfter: rule.title,
          bodyAfter: rule.body,
          rationale: op.rationale,
        });
        outcome.created += 1;
        outcome.ruleIdsTouched.push(rule.id);
        break;
      }

      case "amend_rule": {
        const [before] = await db
          .select()
          .from(wikiRules)
          .where(and(eq(wikiRules.id, op.ruleId), eq(wikiRules.academyId, opts.academyId)))
          .limit(1);
        if (!before) {
          outcome.skipped.push(`Couldn't amend rule ${op.ruleId} - it no longer exists.`);
          break;
        }
        if (!reachableSectionIds.has(before.sectionId)) {
          outcome.skipped.push(
            `Skipped rule ${op.ruleId} - it belongs to a different studio's wiki.`,
          );
          break;
        }
        await db
          .update(wikiRules)
          .set({ title: op.title, body: op.body, updatedAt: new Date() })
          .where(eq(wikiRules.id, op.ruleId));
        await db.insert(wikiRevisions).values({
          ...revisionBase,
          ruleId: op.ruleId,
          changeType: "amended",
          titleBefore: before.title,
          titleAfter: op.title,
          bodyBefore: before.body,
          bodyAfter: op.body,
          rationale: op.rationale,
        });
        outcome.amended += 1;
        outcome.ruleIdsTouched.push(op.ruleId);
        break;
      }

      case "repeal_rule": {
        const [before] = await db
          .select()
          .from(wikiRules)
          .where(and(eq(wikiRules.id, op.ruleId), eq(wikiRules.academyId, opts.academyId)))
          .limit(1);
        if (!before) {
          outcome.skipped.push(`Couldn't repeal rule ${op.ruleId} - it no longer exists.`);
          break;
        }
        if (!reachableSectionIds.has(before.sectionId)) {
          outcome.skipped.push(
            `Skipped repealing rule ${op.ruleId} - it belongs to a different studio's wiki.`,
          );
          break;
        }
        if (before.status === "repealed") break;
        await db
          .update(wikiRules)
          .set({ status: "repealed", repealedAt: new Date(), updatedAt: new Date() })
          .where(eq(wikiRules.id, op.ruleId));
        await db.insert(wikiRevisions).values({
          ...revisionBase,
          ruleId: op.ruleId,
          changeType: "repealed",
          titleBefore: before.title,
          bodyBefore: before.body,
          rationale: op.rationale,
        });
        outcome.repealed += 1;
        outcome.ruleIdsTouched.push(op.ruleId);
        break;
      }

      case "move_rule": {
        const sectionId = keyToSectionId.get(op.sectionKey);
        const [before] = await db
          .select()
          .from(wikiRules)
          .where(and(eq(wikiRules.id, op.ruleId), eq(wikiRules.academyId, opts.academyId)))
          .limit(1);
        if (!before || !sectionId || !reachableSectionIds.has(before.sectionId)) {
          outcome.skipped.push(`Couldn't move rule ${op.ruleId} to "${op.sectionKey}".`);
          break;
        }
        await db
          .update(wikiRules)
          .set({ sectionId, updatedAt: new Date() })
          .where(eq(wikiRules.id, op.ruleId));
        await db.insert(wikiRevisions).values({
          ...revisionBase,
          ruleId: op.ruleId,
          changeType: "moved",
          titleBefore: before.title,
          titleAfter: before.title,
          rationale: op.rationale,
        });
        outcome.moved += 1;
        outcome.ruleIdsTouched.push(op.ruleId);
        break;
      }
    }
  }

  return outcome;
}

/**
 * Undoes everything one AI job did to the wiki, newest revision first.
 * Recorded as new revisions rather than deletions - the history stays honest.
 */
export async function revertJob(opts: {
  academyId: number;
  jobId: number;
  actorUserId: number | null;
  reason: string;
}): Promise<{ reverted: number }> {
  const revisions = await db
    .select()
    .from(wikiRevisions)
    .where(and(eq(wikiRevisions.academyId, opts.academyId), eq(wikiRevisions.jobId, opts.jobId)))
    .orderBy(desc(wikiRevisions.id));

  let reverted = 0;

  for (const revision of revisions) {
    if (!revision.ruleId) continue;
    const [current] = await db
      .select()
      .from(wikiRules)
      .where(eq(wikiRules.id, revision.ruleId))
      .limit(1);
    if (!current) continue;

    if (revision.changeType === "created") {
      await db
        .update(wikiRules)
        .set({ status: "repealed", repealedAt: new Date(), updatedAt: new Date() })
        .where(eq(wikiRules.id, revision.ruleId));
    } else if (revision.changeType === "amended") {
      await db
        .update(wikiRules)
        .set({
          title: revision.titleBefore ?? current.title,
          body: revision.bodyBefore ?? current.body,
          updatedAt: new Date(),
        })
        .where(eq(wikiRules.id, revision.ruleId));
    } else if (revision.changeType === "repealed") {
      await db
        .update(wikiRules)
        .set({ status: "active", repealedAt: null, updatedAt: new Date() })
        .where(eq(wikiRules.id, revision.ruleId));
    } else {
      continue; // moves are cosmetic; leave them
    }

    await db.insert(wikiRevisions).values({
      academyId: opts.academyId,
      ruleId: revision.ruleId,
      changeType: "restored",
      titleBefore: current.title,
      titleAfter: revision.titleBefore ?? current.title,
      bodyBefore: current.body,
      bodyAfter: revision.bodyBefore ?? current.body,
      rationale: opts.reason,
      actorUserId: opts.actorUserId,
      actorType: "user",
      sourceType: "revert",
      sourceRef: String(opts.jobId),
      jobId: null,
    });
    reverted += 1;
  }

  // Findings raised by the same job are no longer meaningful.
  await db
    .update(aiFindings)
    .set({ status: "dismissed", resolutionNote: opts.reason, resolvedAt: new Date() })
    .where(and(eq(aiFindings.academyId, opts.academyId), eq(aiFindings.jobId, opts.jobId)));

  return { reverted };
}

export async function saveFindings(opts: {
  academyId: number;
  studioId: number | null;
  findings: FindingSpec[];
  sourceType: string;
  sourceRef: string | null;
  jobId: number | null;
  /** Maps rule keys emitted by the AI to real ids, for build-wiki runs. */
  ruleKeyMap?: Map<string, number>;
}): Promise<number> {
  if (opts.findings.length === 0) return 0;

  const rows = opts.findings.map((finding) => {
    const fromKeys = (finding.relatedRuleKeys ?? [])
      .map((key) => opts.ruleKeyMap?.get(key))
      .filter((id): id is number => typeof id === "number");
    return {
      academyId: opts.academyId,
      studioId: opts.studioId,
      type: finding.type,
      severity: finding.severity,
      title: finding.title,
      description: finding.description,
      options: finding.options ?? [],
      relatedRuleIds: [...new Set([...(finding.relatedRuleIds ?? []), ...fromKeys])],
      status: "open",
      sourceType: opts.sourceType,
      sourceRef: opts.sourceRef,
      jobId: opts.jobId,
    };
  });

  await db.insert(aiFindings).values(rows);
  return rows.length;
}

/** Inserts positions the AI detected, skipping ones that already exist by title. */
export async function savePositions(opts: {
  academyId: number;
  studioId: number | null;
  positions: PositionSpec[];
  sourceType: string;
  sourceRef: string | null;
}): Promise<number> {
  if (opts.positions.length === 0) return 0;

  // Two studios can each have a "Hero Buck Committee"; they are different
  // committees, so only collide titles within the same studio.
  const existing = (
    await db
      .select({ title: positions.title, studioId: positions.studioId })
      .from(positions)
      .where(eq(positions.academyId, opts.academyId))
  ).filter((row) => row.studioId === opts.studioId || row.studioId === null);
  const taken = new Set(existing.map((row) => row.title.trim().toLowerCase()));

  const fresh = opts.positions.filter((p) => !taken.has(p.title.trim().toLowerCase()));
  if (fresh.length === 0) return 0;

  await db.insert(positions).values(
    fresh.map((p) => ({
      academyId: opts.academyId,
      studioId: opts.studioId,
      title: p.title,
      description: p.description,
      responsibilities: p.responsibilities,
      seats: p.seats,
      termLength: p.termLength,
      elected: p.elected,
      sourceType: opts.sourceType,
      sourceRef: opts.sourceRef,
    })),
  );
  return fresh.length;
}

/** Resolves position titles to ids, case-insensitively. */
export async function findPositionByTitle(academyId: number, title: string) {
  const rows = await db
    .select()
    .from(positions)
    .where(eq(positions.academyId, academyId))
    .orderBy(asc(positions.id));
  const needle = title.trim().toLowerCase();
  return rows.find((row) => row.title.trim().toLowerCase() === needle) ?? null;
}

export async function rulesByIds(academyId: number, ids: number[]) {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(wikiRules)
    .where(and(eq(wikiRules.academyId, academyId), inArray(wikiRules.id, ids)));
}
