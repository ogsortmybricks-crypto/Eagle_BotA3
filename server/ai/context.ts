import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "../db";
import { positions, wikiRules, wikiSections } from "@shared/schema";

/**
 * Renders the live wiki as text for Claude, with database ids inline so the
 * model can reference exact rules in its operations. This is the large stable
 * prefix we cache, so keep the ordering deterministic.
 */
export async function renderWikiContext(academyId: number): Promise<string> {
  const sections = await db
    .select()
    .from(wikiSections)
    .where(eq(wikiSections.academyId, academyId))
    .orderBy(asc(wikiSections.orderIndex), asc(wikiSections.id));

  const rules = await db
    .select()
    .from(wikiRules)
    .where(and(eq(wikiRules.academyId, academyId), ne(wikiRules.status, "repealed")))
    .orderBy(asc(wikiRules.sectionId), asc(wikiRules.orderIndex), asc(wikiRules.id));

  if (sections.length === 0) {
    return "# Current wiki\n\n(The wiki is empty. Every rule you add will be new.)";
  }

  const bySection = new Map<number, typeof rules>();
  for (const rule of rules) {
    const list = bySection.get(rule.sectionId) ?? [];
    list.push(rule);
    bySection.set(rule.sectionId, list);
  }

  const parts = [
    "# Current wiki",
    "",
    "Each rule is listed with its database id. Use those ids exactly in amend_rule,",
    "repeal_rule and move_rule operations. Section slugs are valid sectionKey values.",
    "",
  ];

  for (const section of sections) {
    parts.push(`## ${section.title}  [sectionKey: ${section.slug}]`);
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

export async function renderPositionsContext(academyId: number): Promise<string> {
  const rows = await db
    .select()
    .from(positions)
    .where(and(eq(positions.academyId, academyId), eq(positions.archived, false)))
    .orderBy(asc(positions.title));

  if (rows.length === 0) return "# Existing positions\n\n(none recorded yet)";

  return [
    "# Existing positions",
    "",
    ...rows.map(
      (p) =>
        `- **${p.title}** (${p.seats} seat${p.seats === 1 ? "" : "s"}, ${p.elected ? "elected" : "appointed"}${p.termLength ? `, term: ${p.termLength}` : ""})`,
    ),
  ].join("\n");
}
