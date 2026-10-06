import { joined, text, words, type Node } from "../../shared/tacons/parse";
import { AUDIENCES, positionAudience } from "../../shared/tacons/types";
import type { ExtensionCompileContext, TaconCompilerExtension } from "../../shared/tacons/extensions";
import { EXTENSION_ID, partnerDefinitions, type PartnersConfiguration, type PartnersDef } from "./shared/definition";

const IDENTIFIER = /^[a-z][a-z0-9_]*$/i;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
function error(ctx: ExtensionCompileContext, node: Node, message: string) {
  ctx.diagnostics.push({ line: node.line, column: node.column, severity: "error", message });
}
function audiences(ctx: ExtensionCompileContext, node: Node) {
  const roles: string[] = [];
  for (const entry of words(node.args).filter(word => word.toLowerCase() !== "to")) {
    const lower = entry.toLowerCase();
    if (ctx.positions.has(entry)) roles.push(positionAudience(entry));
    else if (!(AUDIENCES as readonly string[]).includes(lower)) {
      error(ctx, node, `"${entry}" isn't an audience. Use ${[...AUDIENCES, ...ctx.positions].join(", ")}.`);
    } else if (lower === "everyone") return [];
    else roles.push(lower);
  }
  return roles;
}
function compilePartner(ctx: ExtensionCompileContext, node: Node, definitions: Map<string, PartnersDef>): PartnersDef | null {
  const name = text(node.args[0]);
  if (!IDENTIFIER.test(name) || name.length > 48) {
    error(ctx, node, "Partners need a one-word name, like `partners ap { ... }` (up to 48 characters).");
    return null;
  }
  if (definitions.has(name)) {
    error(ctx, node, `There's already a partners block called "${name}".`);
    return null;
  }
  const partners: PartnersDef = {
    name, title: "Accountability Partners", core: ["Math", "Reading"], evidence: [],
    required: 3, due: null, trios: true, managers: ["admin", "guide"],
  };
  const seen = new Set<string>();
  for (const child of node.children) {
    const keyword = child.keyword.toLowerCase();
    if (seen.has(keyword)) error(ctx, child, `"${keyword}" is already set for these partners.`);
    seen.add(keyword);
    if (keyword === "title") partners.title = joined(child.args) || partners.title;
    else if (keyword === "core" || keyword === "evidence") {
      const subjects = words(child.args);
      if (subjects.some(subject => subject.length > 40) || new Set(subjects.map(subject => subject.toLowerCase())).size !== subjects.length || subjects.length > 8) {
        error(ctx, child, `List up to 8 different ${keyword} subjects, each under 40 characters.`);
      } else partners[keyword] = subjects;
    } else if (keyword === "required") {
      const value = Number(joined(child.args));
      if (!Number.isSafeInteger(value) || value < 1 || value > 7) error(ctx, child, "`required` is how many days a week to check in: a whole number from 1 to 7.");
      else partners.required = value;
    } else if (keyword === "due") {
      const day = joined(child.args).toLowerCase();
      if (day === "none") partners.due = null;
      else if (!WEEKDAYS.includes(day)) error(ctx, child, "`due` takes a day of the week, like `due friday`, or `due none`.");
      else partners.due = WEEKDAYS.indexOf(day);
    } else if (keyword === "trios") {
      const value = text(child.args[0]).toLowerCase();
      partners.trios = !value || value === "true" || value === "yes" || value === "on";
    } else if (keyword === "managers") {
      const managers = audiences(ctx, child);
      if (!managers.length) error(ctx, child, "Name who sets the pairings, like `managers admin, guide`.");
      else partners.managers = managers;
    } else error(ctx, child, `"${child.keyword}" doesn't belong in partners. Use title, core, evidence, required, due, trios or managers.`);
  }
  if (partners.core.length + partners.evidence.length === 0) error(ctx, node, "Partners need something to check: add `core` or `evidence` subjects.");
  definitions.set(name, partners);
  return partners;
}
const extension: TaconCompilerExtension = {
  id: EXTENSION_ID,
  definitionKeywords: ["partners"],
  widgetKeywords: ["partners"],
  compileDefinitions(ctx, nodes): PartnersConfiguration {
    const definitions = new Map<string, PartnersDef>();
    for (const node of nodes) compilePartner(ctx, node, definitions);
    return { partners: [...definitions.values()] };
  },
  compileWidget(ctx, node, configuration) {
    const name = text(node.args[0]);
    if (!(configuration as PartnersConfiguration | undefined)?.partners.some(entry => entry.name === name)) {
      error(ctx, node, `There are no partners called "${name}". Declare them at the top level first.`);
      return null;
    }
    if (node.children.length || node.args.length !== 1) {
      error(ctx, node, "Show partners with `partners <name>`; configure them in the top-level partners block.");
    }
    return { kind: "partners", partners: name };
  },
  describe(manifest) {
    return partnerDefinitions(manifest).map(partners => ({
      title: partners.title,
      description: `Accountability pairings, ${partners.required} weekly check-ins, work evidence, and preserved history.`,
    }));
  },
};
export default extension;
