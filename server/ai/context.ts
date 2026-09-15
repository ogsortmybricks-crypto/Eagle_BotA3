import { and, asc, eq, isNull, ne, or, type SQL } from "drizzle-orm";
import { db } from "../db";
import { positions, studios, wikiRules, wikiSections, type Studio } from "@shared/schema";

/**
 * Everything the AI sees is scoped to one studio.
 *
 * Handing Claude every studio's rules at once produces one merged Contract,
 * which is exactly the mess this tool exists to undo. A studio's context is
 * its own rules plus anything the academy holds in common - the same thing a
 * learner sees when they open the wiki.
 */

/** Studio rows plus academy-wide rows. A null studioId means the whole academy. */
function inStudio(column: Parameters<typeof eq>[0], studioId: number | null): SQL | undefined {
  if (studioId === null) return undefined;
  return or(eq(column, studioId), isNull(column));
}

export async function loadStudio(studioId: number | null): Promise<Studio | null> {
  if (studioId === null) return null;
  const [studio] = await db.select().from(studios).where(eq(studios.id, studioId)).limit(1);
  return studio ?? null;
}

/** Orients Claude in the studio it's working for, in the studio's own terms. */
export function renderStudioContext(studio: Studio | null, learnerNoun: string): string {
  if (!studio) {
    return [
      "# The studio you're working for",
      "",
      "These are the academy's shared rules, which apply across every studio.",
      `Learners here are called ${learnerNoun}s.`,
      "",
      "Write for the whole academy. If something only makes sense for one age group,",
      "say so in a finding rather than writing it as a shared rule.",
    ].join("\n");
  }

  return [
    "# The studio you're working for",
    "",
    `**${studio.name}**${studio.ageRange ? ` (ages ${studio.ageRange})` : ""}`,
    studio.description ? `\n${studio.description}` : "",
    "",
    `Learners here are called ${studio.learnerNoun ?? learnerNoun}s.`,
    "",
    "Everything you write is this studio's Contract, not the academy's. Other studios",
    "have their own rules, their own elected positions, and their own Town Halls, and",
    "they are none of this studio's business. Write for the people in this room.",
    studio.ageRange
      ? `Pitch the language at ages ${studio.ageRange} - a rule a ${studio.name} learner can't read alone is a rule that doesn't exist.`
      : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * Renders the live wiki as text for Claude, with database ids inline so the
 * model can reference exact rules in its operations. This is the large stable
 * prefix we cache, so keep the ordering deterministic.
 */
export async function renderWikiContext(
  academyId: number,
  studioId: number | null,
): Promise<string> {
  const studioCondition = inStudio(wikiSections.studioId, studioId);
  const sections = await db
    .select()
    .from(wikiSections)
    .where(
      studioCondition
        ? and(eq(wikiSections.academyId, academyId), studioCondition)
        : eq(wikiSections.academyId, academyId),
    )
    .orderBy(asc(wikiSections.orderIndex), asc(wikiSections.id));

  const sectionIds = new Set(sections.map((section) => section.id));

  const rules = await db
    .select()
    .from(wikiRules)
    .where(and(eq(wikiRules.academyId, academyId), ne(wikiRules.status, "repealed")))
    .orderBy(asc(wikiRules.sectionId), asc(wikiRules.orderIndex), asc(wikiRules.id));

  const scopedRules = rules.filter((rule) => sectionIds.has(rule.sectionId));

  if (sections.length === 0) {
    return "# Current wiki\n\n(This studio has no wiki yet. Every rule you add will be new.)";
  }

  const bySection = new Map<number, typeof scopedRules>();
  for (const rule of scopedRules) {
    const list = bySection.get(rule.sectionId) ?? [];
    list.push(rule);
    bySection.set(rule.sectionId, list);
  }

  const parts = [
    "# Current wiki",
    "",
    "Each rule is listed with its database id. Use those ids exactly in amend_rule,",
    "repeal_rule and move_rule operations. Section slugs are valid sectionKey values.",
    "Sections marked [academy-wide] are shared with every studio - amend those only",
    "when the decision really does apply academy-wide, and raise a finding if it doesn't.",
    "",
  ];

  for (const section of sections) {
    parts.push(
      `## ${section.title}  [sectionKey: ${section.slug}]${section.studioId === null ? "  [academy-wide]" : ""}`,
    );
    if (section.summary) parts.push(`_${section.summary}_`);
    parts.push("");
    const sectionRules = bySection.get(section.id) ?? [];
    if (sectionRules.length === 0) {
      parts.push("(no rules in this section yet)", "");
      continue;
    }
    for (const rule of sectionRules) {
      parts.push(`### [ruleId: ${rule.id}] ${rule.title}`);
      if (rule.status !== "active") parts.push(`(status: ${rule.status})`);
      parts.push(rule.body.trim(), "");
    }
  }

  return parts.join("\n");
}

export async function renderPositionsContext(
  academyId: number,
  studioId: number | null,
): Promise<string> {
  const studioCondition = inStudio(positions.studioId, studioId);
  const base = and(eq(positions.academyId, academyId), eq(positions.archived, false));

  const rows = await db
    .select()
    .from(positions)
    .where(studioCondition ? and(base, studioCondition) : base)
    .orderBy(asc(positions.title));

  if (rows.length === 0) return "# Existing positions\n\n(none recorded for this studio yet)";

  return [
    "# Existing positions",
    "",
    ...rows.map(
      (p) =>
        `- **${p.title}** (${p.seats} seat${p.seats === 1 ? "" : "s"}, ${p.elected ? "elected" : "appointed"}${p.termLength ? `, term: ${p.termLength}` : ""})${p.studioId === null ? " _[academy-wide]_" : ""}`,
    ),
  ].join("\n");
}
