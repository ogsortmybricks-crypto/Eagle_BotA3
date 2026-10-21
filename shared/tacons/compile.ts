/**
 * TacScript, stage two: blocks to a checked manifest.
 *
 * Everything a Tac-On can get wrong is caught here, with a line number and a
 * sentence a learner can act on. That matters more than it sounds: the dev menu
 * runs this compiler in the browser as you type, so the error messages *are*
 * the documentation for most people who ever write one.
 *
 * The rule the compiler enforces above all others: a Tac-On declares what it
 * touches. Reading the wiki, listing people, reacting to an election - each one
 * has to be named in `needs`, and the installing admin sees that list before
 * anything is installed. A Tac-On still cannot read anything the person looking
 * at it couldn't already read; the declaration is honesty, not permission.
 */

import { joined, parse, text, words, type Node, type Token } from "./parse";
import { parseCondition, parseExpr, parseTemplate } from "./expr";
import { compilerExtensions } from "./extension-registry";
import { compileProgram } from "./programs";
import { compileContract } from "./contract";
import {
  AGGREGATES,
  AUDIENCES,
  BASE_COLUMNS,
  BASE_SOURCES,
  CALENDAR_FEED_KINDS,
  DATE_PARTS,
  FIELD_TYPES,
  HOOK_EVENTS,
  LINK_COLUMN,
  PANEL_HOSTS,
  PROGRESS_COLUMN,
  SOURCE_PERMISSIONS,
  positionAudience,
  studioPositionAudience,
  type Action,
  type DatePart,
  type FormSet,
  type GroupLevel,
  type Audience,
  type BaseSource,
  type CalendarFeedDef,
  type CalendarFeedKind,
  type CompileResult,
  type ComputeDef,
  type Condition,
  type Diagnostic,
  type Expr,
  type FieldType,
  type FormWidget,
  type ListValue,
  type ListWidget,
  type HookDef,
  type HookEvent,
  type Manifest,
  type PageDef,
  type PanelDef,
  type PanelHost,
  type PositionDef,
  type SettingDef,
  type StoreDef,
  type StoreField,
  type UseDef,
  type Widget,
} from "./types";

const IDENTIFIER = /^[a-z][a-z0-9_]*$/i;
const SLUG = /^[a-z][a-z0-9-]{1,48}[a-z0-9]$/;
const VERSION = /^\d+\.\d+(\.\d+)?$/;

type Ctx = {
  diagnostics: Diagnostic[];
  /** Store names declared so far, for "there's no store called that" checks. */
  stores: Map<string, StoreDef>;
  settings: Set<string>;
  computes: Set<string>;
  uses: Map<string, UseDef>;
  needs: Set<string>;
  /** Position names, collected up front so any `allow` can name one. */
  positions: Set<string>;
  /** Titles of the studio's own positions named with `show to position "..."`. */
  studioPositions: Set<string>;
  /** `choice from` fields, checked once every store is known. */
  choiceSources: { node: Node; store: StoreDef; field: StoreField }[];
  extensionConfigurations: Map<string, unknown>;
};

/** Fields every store row has, whatever the store declares. */
const ROW_FIELDS = ["created", "by", "id", "byId"];

/** Two `where` lines in one block mean both: tests are joined with `and`. */
function joinConditions(first: Condition | null, second: Condition | null): Condition | null {
  if (!first) return second;
  if (!second) return first;
  return { all: [...first.all, ...second.all] };
}

function error(ctx: Ctx, node: { line: number; column: number }, message: string) {
  ctx.diagnostics.push({ line: node.line, column: node.column, severity: "error", message });
}

function warn(ctx: Ctx, node: { line: number; column: number }, message: string) {
  ctx.diagnostics.push({ line: node.line, column: node.column, severity: "warning", message });
}

/** `show to admin, secretary` / `allow learner` / `show to everyone` / `allow treasurer`. */
function audiences(ctx: Ctx, node: Node): string[] {
  const list = words(node.args).filter((word) => word.toLowerCase() !== "to");
  const roles: string[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const entry = list[index];
    const lower = entry.toLowerCase();
    // `position "Town Hall Leader"`: a seat the studio already has, by title.
    if (lower === "position" && !ctx.positions.has(entry)) {
      const title = list[index + 1]?.trim();
      if (!title) {
        error(ctx, node, 'Name the position by its title: `show to position "Town Hall Leader"`.');
        continue;
      }
      index += 1;
      ctx.studioPositions.add(title);
      roles.push(studioPositionAudience(title));
      continue;
    }
    if (ctx.positions.has(entry)) {
      roles.push(positionAudience(entry));
      continue;
    }
    if (!(AUDIENCES as readonly string[]).includes(lower)) {
      const own = [...ctx.positions];
      error(
        ctx,
        node,
        `"${entry}" isn't an audience. Use ${[...AUDIENCES, ...own].join(", ")}, or position "<a title the studio already has>".`,
      );
      continue;
    }
    if (lower === "everyone") return [];
    roles.push(lower as Audience);
  }
  return roles;
}

function flag(node: Node, fallback = true): boolean {
  const value = text(node.args[0]).toLowerCase();
  if (!value) return fallback;
  return value === "true" || value === "yes" || value === "on";
}

/** Reads an expression that may be written inline or as a `value` line. */
function expressionOf(ctx: Ctx, node: Node, from = 0): Expr | null {
  const inline = node.args.slice(from);
  if (inline.length > 0) return parseExpr(inline, node.line, ctx.diagnostics);

  const valueLine = node.children.find((child) => child.keyword.toLowerCase() === "value");
  if (valueLine) return parseExpr(valueLine.args, valueLine.line, ctx.diagnostics);

  error(ctx, node, `"${node.keyword}" needs a value.`);
  return null;
}

function conditionOf(ctx: Ctx, args: Token[], line: number): Condition | null {
  return parseCondition(args, line, ctx.diagnostics);
}

/* -------------------------------------------------------------------------- */
/*  Stores                                                                     */
/* -------------------------------------------------------------------------- */

function compileStore(ctx: Ctx, node: Node): StoreDef | null {
  const name = text(node.args[0]);
  if (!IDENTIFIER.test(name)) {
    error(ctx, node, 'A store needs a one-word name, like `store entry { ... }`.');
    return null;
  }
  if (ctx.stores.has(name)) {
    error(ctx, node, `There's already a store called "${name}".`);
    return null;
  }

  const store: StoreDef = { name, label: titleCase(name), fields: [] };
  const seen = new Set<string>();

  for (const child of node.children) {
    const keyword = child.keyword.toLowerCase();
    if (keyword === "label") {
      store.label = joined(child.args) || store.label;
      continue;
    }
    if (keyword !== "field") {
      error(ctx, child, `A store holds fields. "${child.keyword}" doesn't belong here.`);
      continue;
    }

    const fieldName = text(child.args[0]);
    if (!IDENTIFIER.test(fieldName)) {
      error(ctx, child, 'A field needs a one-word name, like `field amount number`.');
      continue;
    }
    if (seen.has(fieldName)) {
      error(ctx, child, `"${name}" already has a field called "${fieldName}".`);
      continue;
    }
    seen.add(fieldName);

    const typeWord = text(child.args[1]).toLowerCase();
    if (!typeWord) {
      error(
        ctx,
        child,
        `"${fieldName}" needs a type: ${FIELD_TYPES.join(", ")}.`,
      );
      continue;
    }
    if (!(FIELD_TYPES as readonly string[]).includes(typeWord)) {
      error(ctx, child, `"${typeWord}" isn't a field type. Use one of: ${FIELD_TYPES.join(", ")}.`);
      continue;
    }

    let restTokens = child.args.slice(2);
    // `required` may come last or straight after the type; either way it isn't an option.
    const required = restTokens.some((token) => token.kind === "word" && token.value.toLowerCase() === "required");
    restTokens = restTokens.filter((token) => !(token.kind === "word" && token.value.toLowerCase() === "required"));

    // `field assignment choice from assignment.title where ...`
    if (typeWord === "choice" && restTokens[0]?.kind === "word" && restTokens[0].value.toLowerCase() === "from") {
      const path = text(restTokens[1]).split(".").filter(Boolean);
      if (path.length < 2 || path.length > 3) {
        error(ctx, child, `Say which store and field the options come from: \`field ${fieldName} choice from assignment.title\`.`);
        continue;
      }
      const whereAt = restTokens.findIndex((token) => token.kind === "word" && token.value.toLowerCase() === "where");
      // `choice from assignment.title, assignment.block`: more fields to show.
      const sourceName = path.slice(0, -1).join(".");
      const also = words(restTokens.slice(2, whereAt === -1 ? undefined : whereAt)).map((word) =>
        word.startsWith(`${sourceName}.`) ? word.slice(sourceName.length + 1) : word,
      );
      const field: StoreField = {
        name: fieldName,
        type: "choice",
        label: labelFor(child, fieldName),
        options: [],
        required,
        from: {
          store: path.slice(0, -1),
          field: path[path.length - 1],
          ...(also.length > 0 ? { also } : {}),
          where: whereAt === -1 ? null : conditionOf(ctx, restTokens.slice(whereAt + 1), child.line),
        },
      };
      ctx.choiceSources.push({ node: child, store, field });
      store.fields.push(field);
      continue;
    }

    const options = words(restTokens);

    if (typeWord === "choice" && options.length < 2) {
      error(ctx, child, `A choice field needs its options: \`field ${fieldName} choice earn, spend\`, or \`choice from <store>.<field>\`.`);
      continue;
    }
    if (typeWord === "person") ctx.needs.add("wiki.read");

    const field: StoreField = {
      name: fieldName,
      type: typeWord as FieldType,
      label: labelFor(child, fieldName),
      options: typeWord === "choice" ? options : [],
      required,
    };
    store.fields.push(field);
  }

  if (store.fields.length === 0) {
    warn(ctx, node, `"${name}" has no fields, so nothing can be recorded in it.`);
  }
  ctx.stores.set(name, store);
  return store;
}

/** A `label "..."` child, falling back to a readable version of the name. */
function labelFor(node: Node, name: string): string {
  const child = node.children.find((entry) => entry.keyword.toLowerCase() === "label");
  return child ? joined(child.args) || titleCase(name) : titleCase(name);
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    .trim();
}

/* -------------------------------------------------------------------------- */
/*  Settings                                                                   */
/* -------------------------------------------------------------------------- */

function compileSetting(ctx: Ctx, node: Node): SettingDef | null {
  const name = text(node.args[0]);
  if (!IDENTIFIER.test(name)) {
    error(ctx, node, 'A setting needs a one-word name, like `setting rate { ... }`.');
    return null;
  }
  if (ctx.settings.has(name)) {
    error(ctx, node, `There's already a setting called "${name}".`);
    return null;
  }
  ctx.settings.add(name);

  const setting: SettingDef = {
    name,
    label: titleCase(name),
    type: "text",
    options: [],
    default: "",
    hint: null,
  };

  for (const child of node.children) {
    const keyword = child.keyword.toLowerCase();
    const value = joined(child.args);
    switch (keyword) {
      case "label":
        setting.label = value || setting.label;
        break;
      case "hint":
        setting.hint = value || null;
        break;
      case "type": {
        const type = value.toLowerCase();
        if (type === "text" || type === "number" || type === "boolean" || type === "choice") {
          setting.type = type;
        } else {
          error(ctx, child, `A setting's type is text, number, boolean or choice - not "${value}".`);
        }
        break;
      }
      case "options":
        setting.options = words(child.args);
        break;
      case "default":
        setting.default = value;
        break;
      default:
        error(ctx, child, `"${child.keyword}" doesn't belong in a setting.`);
    }
  }

  if (setting.type === "number") setting.default = Number(setting.default) || 0;
  if (setting.type === "boolean") {
    const raw = String(setting.default).toLowerCase();
    setting.default = raw === "true" || raw === "yes" || raw === "on";
  }
  if (setting.type === "choice" && setting.options.length < 2) {
    error(ctx, node, `The setting "${name}" is a choice but doesn't list its options.`);
  }
  return setting;
}

/* -------------------------------------------------------------------------- */
/*  Actions                                                                    */
/* -------------------------------------------------------------------------- */

function compileActions(ctx: Ctx, nodes: Node[]): Action[] {
  const actions: Action[] = [];

  for (const node of nodes) {
    const keyword = node.keyword.toLowerCase();
    if (keyword === "add") {
      const storeName = text(node.args[0]);
      const store = ctx.stores.get(storeName);
      if (!store) {
        error(ctx, node, `There's no store called "${storeName}" to add to.`);
        continue;
      }
      const values: { field: string; value: Expr }[] = [];
      for (const child of node.children) {
        const fieldName = child.keyword;
        const field = store.fields.find((entry) => entry.name === fieldName);
        if (!field) {
          error(ctx, child, `"${storeName}" has no field called "${fieldName}".`);
          continue;
        }
        // Both `hero: event.actor` and `hero event.actor` are accepted; the
        // colon is punctuation, not syntax anyone should have to remember.
        const rest = child.args[0]?.kind === "colon" ? child.args.slice(1) : child.args;
        const value = parseExpr(rest, child.line, ctx.diagnostics);
        if (value) values.push({ field: fieldName, value });
      }
      if (values.length === 0) {
        warn(ctx, node, `This \`add ${storeName}\` sets no fields, so it would record a blank row.`);
      }
      actions.push({ kind: "add", store: storeName, values });
      continue;
    }

    if (keyword === "notify") {
      const raw = node.args[0];
      const expr =
        raw?.kind === "string"
          ? parseTemplate(raw.value, node.line, ctx.diagnostics)
          : parseExpr(node.args, node.line, ctx.diagnostics);
      if (expr) actions.push({ kind: "notify", text: expr });
      continue;
    }

    error(ctx, node, `"${node.keyword}" isn't something a Tac-On can do. Use add or notify.`);
  }

  return actions;
}

/* -------------------------------------------------------------------------- */
/*  Widgets                                                                    */
/* -------------------------------------------------------------------------- */

/** `show if <test>` inside any widget's block. Only `show to` is something else. */
function isShowIf(child: Node): boolean {
  return child.keyword.toLowerCase() === "show" && text(child.args[0]).toLowerCase() === "if";
}

function compileWidget(ctx: Ctx, node: Node): Widget | null {
  const showLines = node.children.filter(isShowIf);
  if (showLines.length === 0) return compileWidgetBody(ctx, node);

  let showIf: Condition | null = null;
  for (const line of showLines) {
    showIf = joinConditions(showIf, conditionOf(ctx, line.args.slice(1), line.line));
  }
  const widget = compileWidgetBody(ctx, { ...node, children: node.children.filter((child) => !isShowIf(child)) });
  return widget && showIf ? { ...widget, showIf } : widget;
}

/** A label that may hold `{...}`: the template, only when there is something to work out. */
function templateOf(ctx: Ctx, raw: string, line: number): Expr | undefined {
  if (!raw.includes("{")) return undefined;
  return parseTemplate(raw, line, ctx.diagnostics);
}

/**
 * Where `progress "Label" <value> of <goal>` splits. The `of` in `sum of`,
 * `max of`, `name of` and friends belongs to its value, so it is skipped.
 */
function progressSplit(args: Token[]): number {
  const owners = new Set<string>([...AGGREGATES, "max", "min", "name"]);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token.kind !== "word" || token.value.toLowerCase() !== "of") continue;
    const before = args[index - 1];
    if (before?.kind === "word" && owners.has(before.value.toLowerCase())) continue;
    return index;
  }
  return -1;
}

function compileWidgetBody(ctx: Ctx, node: Node): Widget | null {
  const keyword = node.keyword.toLowerCase();

  switch (keyword) {
    case "celebrate": {
      const raw = node.args[0];
      if (!raw) {
        error(ctx, node, 'A celebration needs a message: `celebrate "You did it!"`.');
        return null;
      }
      return {
        kind: "celebrate",
        text:
          raw.kind === "string"
            ? parseTemplate(raw.value, node.line, ctx.diagnostics)
            : { kind: "literal", value: joined(node.args) },
      };
    }

    case "progress": {
      const label = text(node.args[0]) || "Progress";
      let value: Expr | null = null;
      let goal: Expr | null = null;
      const inline = node.args.slice(1);
      if (inline.length > 0) {
        let split = progressSplit(inline);
        if (split === -1) {
          error(ctx, node, 'Write it as `progress "Calls this week" my.days of setting.goal`.');
          return null;
        }
        const valueTokens = inline.slice(0, split);
        // `2 out of 3` reads as well as `2 of 3`.
        const last = valueTokens[valueTokens.length - 1];
        if (last?.kind === "word" && last.value.toLowerCase() === "out") valueTokens.pop();
        value = parseExpr(valueTokens, node.line, ctx.diagnostics);
        split += 1;
        goal = parseExpr(inline.slice(split), node.line, ctx.diagnostics);
      } else {
        const valueLine = node.children.find((child) => child.keyword.toLowerCase() === "value");
        const goalLine = node.children.find((child) => ["goal", "of", "out"].includes(child.keyword.toLowerCase()));
        if (valueLine) value = parseExpr(valueLine.args, valueLine.line, ctx.diagnostics);
        if (goalLine) {
          const args = goalLine.keyword.toLowerCase() === "out" && text(goalLine.args[0]).toLowerCase() === "of"
            ? goalLine.args.slice(1)
            : goalLine.args;
          goal = parseExpr(args, goalLine.line, ctx.diagnostics);
        }
      }
      if (!value || !goal) {
        error(ctx, node, "A progress bar needs a value and a goal: `progress \"Calls\" my.days of setting.goal`.");
        return null;
      }
      const hintLine = node.children.find((child) => child.keyword.toLowerCase() === "hint");
      return {
        kind: "progress",
        label,
        labelTemplate: templateOf(ctx, label, node.line),
        value,
        goal,
        hint: hintLine ? parseTemplate(joined(hintLine.args), hintLine.line, ctx.diagnostics) : null,
      };
    }

    case "note":
    case "text": {
      const raw = node.args[0];
      const expr = raw
        ? raw.kind === "string"
          ? parseTemplate(raw.value, node.line, ctx.diagnostics)
          : parseExpr(node.args, node.line, ctx.diagnostics)
        : null;
      if (!expr) {
        error(ctx, node, "A note needs something to say.");
        return null;
      }
      const tone = words(node.args.slice(1)).find((word) =>
        ["info", "warning", "plain"].includes(word.toLowerCase()),
      );
      return { kind: "note", text: expr, tone: (tone as "info" | "warning") ?? "plain" };
    }

    case "heading": {
      const raw = node.args[0];
      if (!raw) {
        error(ctx, node, "A heading needs some words.");
        return null;
      }
      return {
        kind: "heading",
        text:
          raw.kind === "string"
            ? parseTemplate(raw.value, node.line, ctx.diagnostics)
            : { kind: "literal", value: joined(node.args) },
      };
    }

    case "divider":
      return { kind: "divider" };
    case "program":
      return compileProgram(node, new Set(ctx.stores.keys()), ctx.diagnostics);

    case "stat": {
      const label = text(node.args[0]) || "Total";
      const value = expressionOf(ctx, node, 1);
      if (!value) return null;
      const hintLine = node.children.find((child) => child.keyword.toLowerCase() === "hint");
      return {
        kind: "stat",
        label,
        labelTemplate: templateOf(ctx, label, node.line),
        value,
        hint: hintLine
          ? parseTemplate(joined(hintLine.args), hintLine.line, ctx.diagnostics)
          : null,
      };
    }

    case "list":
      return compileList(ctx, node);

    case "form":
      return compileForm(ctx, node);

    case "button":
      return compileButton(ctx, node);



    default:
      {
        const extension = compilerExtensions.find(entry => entry.widgetKeywords.includes(keyword));
        if (extension) {
          const config = extension.compileWidget(ctx, node, ctx.extensionConfigurations.get(extension.id));
          return config ? { kind: "extension", extension: extension.id, config } : null;
        }
      }
      error(
        ctx,
        node,
        `"${node.keyword}" isn't something a page can show. Use note, heading, stat, progress, celebrate, list, form, button, divider or a registered extension widget.`,
      );
      return null;
  }
}

function compileList(ctx: Ctx, node: Node): Widget | null {
  const first = text(node.args[0]);
  let source: { kind: "store"; store: string[] } | { kind: "base"; source: BaseSource };
  let known: string[];

  if (first.toLowerCase() === "from") {
    const sourceName = text(node.args[1]);
    if (!(BASE_SOURCES as readonly string[]).includes(sourceName)) {
      error(
        ctx,
        node,
        `"${sourceName}" isn't part of Eagle Bot you can list. Try: ${BASE_SOURCES.join(", ")}.`,
      );
      return null;
    }
    const base = sourceName as BaseSource;
    // Reading the base app is exactly what `needs` exists to disclose.
    ctx.needs.add(SOURCE_PERMISSIONS[base]);
    source = { kind: "base", source: base };
    known = BASE_COLUMNS[base];
  } else {
    const parts = first.split(".").filter(Boolean);
    if (parts.length === 0) {
      error(ctx, node, "A list needs a store: `list entry { ... }` or `list from elections { ... }`.");
      return null;
    }
    if (parts.length === 1) {
      const store = ctx.stores.get(parts[0]);
      if (!store) {
        error(ctx, node, `There's no store called "${parts[0]}". Declare it with \`store ${parts[0]} { ... }\`.`);
        return null;
      }
      known = store.fields.map((field) => field.name);
    } else {
      const alias = parts[0];
      if (!ctx.uses.has(alias)) {
        error(ctx, node, `To read "${first}" you first need \`use <tac-on> as ${alias}\`.`);
        return null;
      }
      // Another Tac-On's fields aren't knowable at compile time, so columns
      // there are taken on trust and checked when the page renders.
      known = [];
    }
    source = { kind: "store", store: parts };
  }

  const widget = {
    kind: "list" as const,
    title: null as string | null,
    titleTemplate: undefined as Expr | undefined,
    source,
    columns: [] as string[],
    where: null as Condition | null,
    sort: "newest" as "newest" | "oldest" | "az",
    limit: 25,
    empty: "Nothing here yet.",
    allowRemove: [] as string[],
    removeOwn: false,
    groupBy: [] as GroupLevel[],
    linkAnyone: false,
  };
  const ownStore = source.kind === "store" && source.store.length === 1;
  const storeName = source.kind === "store" ? source.store[source.store.length - 1] : null;
  let groupLine: Node | null = null;
  let wantsLink = false;
  const values: ListValue[] = [];
  let progress: { value: string; goal: string } | null = null;
  let totals: string[] = [];
  let progressLine: Node | null = null;
  let totalLine: Node | null = null;

  for (const child of node.children) {
    const keyword = child.keyword.toLowerCase();
    switch (keyword) {
      case "title":
        widget.title = joined(child.args);
        widget.titleTemplate = templateOf(ctx, widget.title, child.line);
        break;
      case "columns":
      case "show": {
        // `columns hero, amount where amount above 5` reads naturally enough
        // that people write it, so split the line rather than complain at it.
        const split = child.args.findIndex((token) => token.value.toLowerCase() === "where");
        if (split === -1) {
          widget.columns = words(child.args);
        } else {
          widget.columns = words(child.args.slice(0, split));
          widget.where = joinConditions(widget.where, conditionOf(ctx, child.args.slice(split + 1), child.line));
        }
        break;
      }
      case "where":
        // A second `where` line narrows further, like `and`.
        widget.where = joinConditions(widget.where, conditionOf(ctx, child.args, child.line));
        break;
      case "group":
        groupLine = child;
        break;
      case "link": {
        // `link anyone`: the row's page opens for anyone in the academy.
        const who = text(child.args[0]).toLowerCase();
        if (who && who !== "anyone") {
          error(ctx, child, "Write `link anyone` to let anyone in the academy open a row's link, or put `link` in `columns`.");
          break;
        }
        widget.linkAnyone = who === "anyone";
        wantsLink = true;
        break;
      }
      case "sort": {
        const value = text(child.args[0]).toLowerCase();
        if (value === "newest" || value === "oldest" || value === "az") {
          widget.sort = value;
        } else {
          error(ctx, child, 'Sort is newest, oldest or az.');
        }
        break;
      }
      case "limit": {
        const value = Number(text(child.args[0]));
        if (!Number.isFinite(value) || value < 1) {
          error(ctx, child, "A limit is a number of rows, like `limit 20`.");
        } else {
          widget.limit = Math.min(200, Math.floor(value));
        }
        break;
      }
      case "empty":
        widget.empty = joined(child.args) || widget.empty;
        break;
      case "allow": {
        // `allow remove admin` - the only per-row action a list offers.
        // `own` lets anyone who can see the list remove the rows they saved.
        const args = child.args.filter((token) => token.value.toLowerCase() !== "remove");
        widget.removeOwn = args.some((token) => token.value.toLowerCase() === "own");
        if (widget.removeOwn && !ownStore) {
          error(ctx, child, "`allow remove own` only works on a list of your own store.");
        }
        // `allow remove admin, own`: admins remove any row shown, everyone else their own.
        widget.allowRemove = audiences(ctx, {
          ...child,
          args: args.filter((token) => token.value.toLowerCase() !== "own"),
        });
        break;
      }
      case "value": {
        // `value done sum of core_log.steps where core_log.byId is each.id`
        const name = text(child.args[0]);
        if (!IDENTIFIER.test(name)) {
          error(ctx, child, "A value needs a one-word name: `value done sum of log.steps where log.byId is each.id`.");
          break;
        }
        if (known.includes(name) || ROW_FIELDS.includes(name) || values.some((entry) => entry.name === name)) {
          error(ctx, child, `"${name}" is already a column here. Give the value its own name.`);
          break;
        }
        const expr = child.args.length > 1 ? parseExpr(child.args.slice(1), child.line, ctx.diagnostics) : null;
        if (!expr) {
          error(ctx, child, `Say how to work out "${name}": \`value ${name} sum of log.steps where log.byId is each.id\`.`);
          break;
        }
        values.push({ name, expr });
        break;
      }
      case "progress": {
        // `progress done of goal` / `progress done out of goal`
        const parts = words(child.args).filter((word) => !["of", "out"].includes(word.toLowerCase()));
        if (parts.length !== 2) {
          error(ctx, child, "Write it as `progress <value> of <goal>`, like `progress done of goal`.");
          break;
        }
        progress = { value: parts[0], goal: parts[1] };
        progressLine = child;
        break;
      }
      case "total":
      case "totals":
        totals = [...totals, ...words(child.args)];
        totalLine = child;
        break;
      default:
        error(ctx, child, `"${child.keyword}" doesn't belong in a list.`);
    }
  }

  if (wantsLink && !widget.columns.includes(LINK_COLUMN)) widget.columns.push(LINK_COLUMN);
  if (progress && !widget.columns.includes(PROGRESS_COLUMN)) widget.columns.push(PROGRESS_COLUMN);
  // `finished.assignment.block` and `assignment.block` mean the same column.
  if (ownStore && storeName) {
    widget.columns = widget.columns.map((column) =>
      column.startsWith(`${storeName}.`) ? column.slice(storeName.length + 1) : column,
    );
  }
  const valueNames = values.map((entry) => entry.name);
  const isThrough = (column: string) => ownStore && storeName !== null && throughColumn(ctx, storeName, column);

  // Fields a store row always has: `created`, `by`, `id`, `byId`; then the list's own values.
  const rowFields = source.kind === "store" && known.length > 0 ? [...known, ...ROW_FIELDS] : known;
  const available = rowFields.length > 0 ? [...rowFields, ...valueNames] : rowFields;

  if (progress) {
    for (const name of [progress.value, progress.goal]) {
      if (available.length > 0 && !available.includes(name) && !valueNames.includes(name)) {
        error(ctx, progressLine!, `There's no "${name}" for the bar. Use a field, or a \`value\` line in this list.`);
      }
    }
  }
  for (const name of totals) {
    if (!widget.columns.includes(name)) {
      error(ctx, totalLine!, `"${name}" isn't one of this list's columns, so there's nothing to add up.`);
    }
  }

  if (widget.columns.includes(LINK_COLUMN) && !ownStore) {
    error(ctx, node, "`link` only works on a list of your own store - those are the rows it can open.");
  }

  if (widget.columns.filter((column) => column !== LINK_COLUMN).length === 0) {
    widget.columns = [...known.slice(0, 5), ...widget.columns];
    if (widget.columns.filter((column) => column !== LINK_COLUMN).length === 0) {
      error(ctx, node, "This list needs a `columns` line saying what to show.");
      return null;
    }
  } else if (known.length > 0) {
    for (const column of widget.columns) {
      if (available.includes(column) || column === LINK_COLUMN || column === PROGRESS_COLUMN) continue;
      if (isThrough(column)) continue;
      error(ctx, node, `There's no "${column}" to show here. Available: ${available.join(", ")}.`);
    }
  }

  if (groupLine) widget.groupBy = groupLevels(ctx, groupLine, rowFields, storeName, isThrough);

  const compiled: ListWidget = {
    kind: "list",
    title: widget.title,
    source: widget.source,
    columns: widget.columns,
    where: widget.where,
    sort: widget.sort,
    limit: widget.limit,
    empty: widget.empty,
    allowRemove: widget.allowRemove,
  };
  // Only what was used goes into the manifest, so older readers see what they always have.
  if (widget.titleTemplate) compiled.titleTemplate = widget.titleTemplate;
  if (widget.removeOwn) compiled.removeOwn = true;
  if (widget.groupBy.length > 0) compiled.groupBy = widget.groupBy;
  if (widget.linkAnyone) compiled.linkAnyone = true;
  if (values.length > 0) compiled.values = values;
  if (progress) compiled.progress = progress;
  if (totals.length > 0) compiled.totals = totals;
  return compiled;
}

/**
 * `group by created.week, day` -> [created by week, created by day]. A bare
 * `year`, `month`, `week` or `day` that isn't a field reuses the field before it.
 */
function groupLevels(
  ctx: Ctx,
  node: Node,
  available: string[],
  storeName: string | null,
  isThrough: (column: string) => boolean = () => false,
): GroupLevel[] {
  const items = words(node.args).filter((word, index) => !(index === 0 && word.toLowerCase() === "by"));
  if (text(node.args[0]).toLowerCase() !== "by" || items.length === 0) {
    error(ctx, node, "Write it as `group by <field>`, like `group by created.week, day`.");
    return [];
  }
  const levels: GroupLevel[] = [];
  for (const item of items) {
    let path = item.split(".").filter(Boolean);
    // `call.day` always means the field; a bare `day` after a date level means "by day".
    const named = Boolean(storeName && path.length > 1 && path[0] === storeName);
    if (named) path = path.slice(1);
    const last = path[path.length - 1]?.toLowerCase();
    const isPart = (DATE_PARTS as readonly string[]).includes(last);
    const previous = levels[levels.length - 1];

    let level: GroupLevel | null = null;
    // `assignment.block`: a field of the row a `choice from` field picked.
    if (path.length >= 2 && !(path.length === 2 && isPart) && isThrough(path.join("."))) {
      levels.push({ field: path.join("."), part: null });
      continue;
    }
    if (path.length === 2 && isPart) level = { field: path[0], part: last as DatePart };
    else if (path.length === 1 && isPart && !named && previous?.part) level = { field: previous.field, part: last as DatePart };
    else if (path.length === 1 && (available.length === 0 || available.includes(path[0]))) level = { field: path[0], part: null };
    else if (path.length === 1 && isPart && previous) level = { field: previous.field, part: last as DatePart };

    if (!level) {
      error(ctx, node, `"${item}" isn't something to group by. Use a field, or a date field with .year, .month, .week or .day.`);
      continue;
    }
    if (available.length > 0 && !available.includes(level.field)) {
      error(ctx, node, `There's no "${level.field}" to group by. Available: ${available.join(", ")}.`);
      continue;
    }
    if (level.part && storeName) {
      const store = ctx.stores.get(storeName);
      const field = store?.fields.find((entry) => entry.name === level!.field);
      if (field && field.type !== "date") {
        error(ctx, node, `"${level.field}" is a ${field.type} field. Only date fields and \`created\` can be grouped by ${level.part}.`);
        continue;
      }
    }
    levels.push(level);
  }
  if (levels.length > 3) {
    warn(ctx, node, "More than three levels of folders is hard to find your way around. Only the first three are used.");
    return levels.slice(0, 3);
  }
  return levels;
}

function compileForm(ctx: Ctx, node: Node): Widget | null {
  const title = joined(node.args) || "Add";
  const intoLine = node.children.find((child) => child.keyword.toLowerCase() === "into");
  const storeName = intoLine ? text(intoLine.args[0]) : "";
  const store = ctx.stores.get(storeName);
  if (!store) {
    error(
      ctx,
      node,
      storeName
        ? `There's no store called "${storeName}" for this form to fill.`
        : "A form needs an `into <store>` line saying where its answers go.",
    );
    return null;
  }

  const widget = {
    kind: "form" as const,
    title,
    into: storeName,
    fields: [] as { field: string; label: string | null }[],
    sets: [] as FormSet[],
    allow: [] as string[],
    submitLabel: "Save",
    confirm: null as string | null,
    confirmCode: false,
    then: [] as Action[],
  };

  for (const child of node.children) {
    const keyword = child.keyword.toLowerCase();
    switch (keyword) {
      case "into":
        break;
      case "confirm": {
        // `confirm "Sign it?"`, `confirm with code`, or `confirm with code "Sign it?"`.
        let args = child.args;
        if (text(args[0]).toLowerCase() === "with" && text(args[1]).toLowerCase() === "code") {
          widget.confirmCode = true;
          args = args.slice(2);
        }
        if (args.length > 0) widget.confirm = joined(args);
        else if (!widget.confirmCode) widget.confirm = "Are you sure?";
        break;
      }
      case "set": {
        // `set day weekday` / `set who: me.id` - filled in on the server, never asked.
        const fieldName = text(child.args[0]);
        const field = store.fields.find((entry) => entry.name === fieldName);
        if (!field) {
          error(ctx, child, `"${storeName}" has no field called "${fieldName}".`);
          break;
        }
        const rest = child.args[1]?.kind === "colon" ? child.args.slice(2) : child.args.slice(1);
        const value = rest.length > 0 ? parseExpr(rest, child.line, ctx.diagnostics) : null;
        if (!value) {
          error(ctx, child, `Say what to set it to: \`set ${fieldName} me.id\`.`);
          break;
        }
        widget.sets.push({ field: fieldName, value });
        break;
      }
      case "ask": {
        const fieldName = text(child.args[0]);
        const field = store.fields.find((entry) => entry.name === fieldName);
        if (!field) {
          error(ctx, child, `"${storeName}" has no field called "${fieldName}".`);
          break;
        }
        const label = child.args[1]?.kind === "string" ? text(child.args[1]) : null;
        widget.fields.push({ field: fieldName, label });
        break;
      }
      case "allow":
        widget.allow = audiences(ctx, child);
        break;
      case "submit":
        widget.submitLabel = joined(child.args) || widget.submitLabel;
        break;
      case "then":
        widget.then = compileActions(ctx, child.children);
        break;
      default:
        error(ctx, child, `"${child.keyword}" doesn't belong in a form.`);
    }
  }

  const setNames = new Set(widget.sets.map((entry) => entry.field));
  if (widget.fields.length === 0 && widget.sets.length === 0) {
    // A form with no questions is almost always a half-finished one.
    widget.fields = store.fields.map((field) => ({ field: field.name, label: null }));
    warn(ctx, node, `This form doesn't ask anything, so it asks for every field in "${storeName}".`);
  }
  for (const entry of widget.fields) {
    if (setNames.has(entry.field)) {
      error(ctx, node, `"${entry.field}" is both asked and set. A form either asks for a field or fills it in.`);
    }
  }

  const compiled: FormWidget = {
    kind: "form",
    title: widget.title,
    into: widget.into,
    fields: widget.fields,
    allow: widget.allow,
    submitLabel: widget.submitLabel,
    then: widget.then,
  };
  if (widget.sets.length > 0) compiled.sets = widget.sets;
  if (widget.confirm) compiled.confirm = widget.confirm;
  if (widget.confirmCode) compiled.confirmCode = true;
  return compiled;
}

function compileButton(ctx: Ctx, node: Node): Widget | null {
  const label = joined(node.args) || "Run";
  const widget = {
    kind: "button" as const,
    label,
    allow: [] as string[],
    confirm: null as string | null,
    does: [] as Action[],
  };

  const actionNodes: Node[] = [];
  for (const child of node.children) {
    const keyword = child.keyword.toLowerCase();
    if (keyword === "allow") {
      widget.allow = audiences(ctx, child);
      continue;
    }
    if (keyword === "confirm") {
      widget.confirm = joined(child.args) || "Are you sure?";
      continue;
    }
    if (keyword === "does" || keyword === "do") {
      actionNodes.push(...child.children);
      continue;
    }
    actionNodes.push(child);
  }

  widget.does = compileActions(ctx, actionNodes);
  if (widget.does.length === 0) {
    error(ctx, node, `The button "${label}" doesn't do anything.`);
    return null;
  }
  return widget;
}

function compileWidgets(ctx: Ctx, nodes: Node[]): Widget[] {
  const widgets: Widget[] = [];
  for (const node of nodes) {
    const widget = compileWidget(ctx, node);
    if (widget) widgets.push(widget);
  }
  return widgets;
}

/**
 * True for the lines that configure a page or panel rather than draw on it.
 * `show to admin` is an audience; `show hero, amount` inside a list is columns,
 * which is why this asks what follows the keyword.
 */
function isLayoutKey(child: Node): boolean {
  const keyword = child.keyword.toLowerCase();
  if (keyword === "show") return text(child.args[0]).toLowerCase() === "to";
  return PAGE_KEYS.includes(keyword);
}

/* -------------------------------------------------------------------------- */
/*  Pages, panels, hooks                                                       */
/* -------------------------------------------------------------------------- */

const PAGE_KEYS = ["title", "icon", "nav", "subtitle", "show"];

function compilePage(ctx: Ctx, node: Node): PageDef | null {
  const name = text(node.args[0]);
  if (!IDENTIFIER.test(name)) {
    error(ctx, node, 'A page needs a one-word name, like `page ledger { ... }`.');
    return null;
  }

  const page: PageDef = {
    name,
    title: titleCase(name),
    icon: "puzzle",
    nav: true,
    subtitle: null,
    showTo: [],
    widgets: [],
  };

  for (const child of node.children) {
    const keyword = child.keyword.toLowerCase();
    if (keyword === "title") page.title = joined(child.args) || page.title;
    else if (keyword === "icon") page.icon = text(child.args[0]) || page.icon;
    else if (keyword === "nav") page.nav = flag(child);
    else if (keyword === "subtitle") page.subtitle = joined(child.args) || null;
    else if (keyword === "show" && text(child.args[0]).toLowerCase() === "to") {
      page.showTo = audiences(ctx, child);
    }
  }

  const titleTemplate = templateOf(ctx, page.title, node.line);
  if (titleTemplate) page.titleTemplate = titleTemplate;

  page.widgets = compileWidgets(ctx, node.children.filter((child) => !isLayoutKey(child)));

  if (page.widgets.length === 0) {
    warn(ctx, node, `The page "${name}" is empty.`);
  }
  return page;
}

function compilePanel(ctx: Ctx, node: Node): PanelDef | null {
  const args = words(node.args).filter((word) => word.toLowerCase() !== "on");
  const host = args[0];
  if (!(PANEL_HOSTS as readonly string[]).includes(host)) {
    error(
      ctx,
      node,
      `A panel attaches to one of Eagle Bot's own pages: ${PANEL_HOSTS.join(", ")}.`,
    );
    return null;
  }

  const panel: PanelDef = { host: host as PanelHost, title: "", showTo: [], widgets: [] };

  for (const child of node.children) {
    const keyword = child.keyword.toLowerCase();
    if (keyword === "title") panel.title = joined(child.args);
    else if (keyword === "show" && text(child.args[0]).toLowerCase() === "to") {
      panel.showTo = audiences(ctx, child);
    }
  }

  panel.widgets = compileWidgets(ctx, node.children.filter((child) => !isLayoutKey(child)));

  if (!panel.title) panel.title = titleCase(host);
  return panel;
}

/**
 * `calendar <store> { ... }` - a Tac-On's records, as entries on the studio
 * calendar. Checked hard because a wrong field name here would otherwise just
 * mean an empty calendar and no idea why.
 */
function compileCalendar(ctx: Ctx, node: Node): CalendarFeedDef | null {
  const first = text(node.args[0]);
  const parts = first.split(".").filter(Boolean);
  let fields: StoreField[] | null = null;
  if (parts.length === 1) {
    const store = ctx.stores.get(parts[0]);
    if (!store) {
      error(ctx, node, `There's no store called "${first}". A calendar shows a store: \`calendar trip { ... }\`.`);
      return null;
    }
    fields = store.fields;
  } else if (parts.length === 2) {
    if (!ctx.uses.has(parts[0])) {
      error(ctx, node, `To show "${first}" you first need \`use <tac-on> as ${parts[0]}\`.`);
      return null;
    }
  } else {
    error(ctx, node, "A calendar shows one store: `calendar trip { ... }`.");
    return null;
  }

  const storeName = parts[parts.length - 1];
  const feed: CalendarFeedDef = {
    store: parts,
    title: { kind: "literal", value: titleCase(storeName) },
    on: "",
    until: null,
    at: null,
    kind: "event",
    color: null,
    where: null,
    showTo: [],
    open: null,
  };
  let titled = false;

  /** `trip.day` or `day` -> "day", checked against the store when we can see it. */
  const fieldOf = (child: Node, wantDate: boolean): string | null => {
    const raw = text(child.args[0]);
    const name = raw.startsWith(`${storeName}.`) ? raw.slice(storeName.length + 1) : raw;
    if (!name) {
      error(ctx, child, `"${child.keyword}" needs a field, like \`${child.keyword} ${storeName}.day\`.`);
      return null;
    }
    if (name === "created" && wantDate) return name;
    if (fields) {
      const field = fields.find((entry) => entry.name === name);
      if (!field) {
        error(ctx, child, `"${storeName}" has no field called "${name}".`);
        return null;
      }
      if (wantDate && field.type !== "date") {
        error(ctx, child, `"${name}" is a ${field.type} field. \`${child.keyword}\` needs a date field.`);
        return null;
      }
    }
    return name;
  };

  for (const child of node.children) {
    const keyword = child.keyword.toLowerCase();
    switch (keyword) {
      case "title": {
        const raw = child.args[0];
        feed.title =
          raw?.kind === "string"
            ? parseTemplate(raw.value, child.line, ctx.diagnostics)
            : (parseExpr(child.args, child.line, ctx.diagnostics) ?? feed.title);
        titled = true;
        break;
      }
      case "on":
      case "from":
        feed.on = fieldOf(child, true) ?? "";
        break;
      case "until":
      case "to":
        feed.until = fieldOf(child, true);
        break;
      case "at":
        feed.at = fieldOf(child, false);
        break;
      case "kind": {
        const value = text(child.args[0]).toLowerCase().replace(/-/g, "_");
        if ((CALENDAR_FEED_KINDS as readonly string[]).includes(value)) feed.kind = value as CalendarFeedKind;
        else error(ctx, child, `A Tac-On's entries can be: ${CALENDAR_FEED_KINDS.join(", ")}.`);
        break;
      }
      case "color":
      case "colour": {
        const value = text(child.args[0]);
        if (/^#[0-9a-f]{6}$/i.test(value)) feed.color = value;
        else error(ctx, child, 'A colour is a hex code in quotes, like `color "#10b981"`.');
        break;
      }
      case "where":
        // A second `where` line narrows further, like `and`.
        feed.where = joinConditions(feed.where, conditionOf(ctx, child.args, child.line));
        break;
      case "show":
        if (text(child.args[0]).toLowerCase() === "to") feed.showTo = audiences(ctx, child);
        else error(ctx, child, "Use `show to everyone` (or a role) to say who sees these entries.");
        break;
      case "open": {
        if (text(child.args[0]).toLowerCase() !== "record") {
          feed.open = text(child.args[0]) || null;
          break;
        }
        // `open record title, partner, created`: a read-only page for that row.
        if (!fields) {
          error(ctx, child, "`open record` only works for your own store - those are the rows it can open.");
          break;
        }
        const shown = words(child.args.slice(1)).map((name) =>
          name.startsWith(`${storeName}.`) ? name.slice(storeName.length + 1) : name,
        );
        const known = [...fields.map((field) => field.name), ...ROW_FIELDS];
        const unknown = shown.filter((name) => !known.includes(name));
        if (unknown.length > 0) {
          error(ctx, child, `"${storeName}" has no ${unknown.map((name) => `"${name}"`).join(", ")}. Available: ${known.join(", ")}.`);
          break;
        }
        feed.openRecord = shown;
        break;
      }
      default:
        error(ctx, child, `"${child.keyword}" doesn't belong in a calendar. Use title, on, until, at, kind, color, where, show to or open.`);
    }
  }

  if (!feed.on) {
    error(ctx, node, `Say which date each entry is on: \`on ${storeName}.<date field>\`.`);
    return null;
  }
  if (feed.open && feed.openRecord) {
    error(ctx, node, "An entry opens either a page or its record, not both. Keep one `open` line.");
  }
  if (!feed.openRecord) delete feed.openRecord;
  if (!titled && fields) {
    const firstText = fields.find((field) => field.type === "text");
    if (firstText) feed.title = { kind: "path", parts: ["row", firstText.name] };
  }
  return feed;
}

/** The lines that describe a position rather than draw on its holder's desk. */
const POSITION_KEYS = ["title", "about", "description", "duties", "duty", "seats", "term", "elected", "appointed"];

function compilePosition(ctx: Ctx, node: Node): PositionDef | null {
  const name = text(node.args[0]);
  if (!IDENTIFIER.test(name)) {
    error(ctx, node, 'A position needs a one-word name, like `position treasurer { ... }`.');
    return null;
  }

  const position: PositionDef = {
    name,
    title: titleCase(name),
    about: null,
    duties: [],
    seats: 1,
    term: null,
    elected: true,
    widgets: [],
  };

  for (const child of node.children) {
    const keyword = child.keyword.toLowerCase();
    switch (keyword) {
      case "title":
        position.title = joined(child.args) || position.title;
        break;
      case "about":
      case "description":
        position.about = joined(child.args) || null;
        break;
      case "duties":
      case "duty":
        // `duties "Keep the ledger", "Report at Town Hall"` - one quoted line
        // each. Unquoted words are read as a single duty.
        if (child.args.every((token) => token.kind === "string")) {
          position.duties.push(...words(child.args));
        } else if (joined(child.args)) {
          position.duties.push(joined(child.args));
        }
        break;
      case "seats": {
        const seats = Number(text(child.args[0]));
        if (!Number.isInteger(seats) || seats < 1 || seats > 20) {
          error(ctx, child, "Seats is a whole number from 1 to 20, like `seats 2`.");
        } else {
          position.seats = seats;
        }
        break;
      }
      case "term":
        position.term = joined(child.args) || null;
        break;
      case "elected":
        position.elected = flag(child);
        break;
      case "appointed":
        position.elected = !flag(child);
        break;
    }
  }

  // Anything else in the block is the holder's desk.
  position.widgets = compileWidgets(
    ctx,
    node.children.filter((child) => !POSITION_KEYS.includes(child.keyword.toLowerCase())),
  );
  return position;
}

function compileHook(ctx: Ctx, node: Node): HookDef | null {
  const eventName = text(node.args[0]);
  if (!(HOOK_EVENTS as readonly string[]).includes(eventName)) {
    error(
      ctx,
      node,
      `"${eventName}" isn't something that happens in Eagle Bot. Try one of: ${HOOK_EVENTS.join(", ")}.`,
    );
    return null;
  }

  const hook: HookDef = { event: eventName as HookEvent, when: null, does: [] };
  const actionNodes: Node[] = [];

  for (const child of node.children) {
    const keyword = child.keyword.toLowerCase();
    if (keyword === "only" || keyword === "if") {
      const rest = child.args.filter(
        (token) => !["if", "when"].includes(token.value.toLowerCase()),
      );
      hook.when = conditionOf(ctx, rest, child.line);
      continue;
    }
    actionNodes.push(child);
  }

  hook.does = compileActions(ctx, actionNodes);
  if (hook.does.length === 0) {
    error(ctx, node, `Nothing happens when ${eventName}.`);
    return null;
  }
  return hook;
}

/* -------------------------------------------------------------------------- */
/*  The whole file                                                             */
/* -------------------------------------------------------------------------- */

export function compile(source: string): CompileResult {
  const parsed = parse(source);
  const ctx: Ctx = {
    diagnostics: [...parsed.diagnostics],
    stores: new Map(),
    settings: new Set(),
    computes: new Set(),
    uses: new Map(),
    needs: new Set(),
    positions: new Set(),
    studioPositions: new Set(),
    choiceSources: [],
    extensionConfigurations: new Map(),
  };

  const roots = parsed.nodes.filter((node) => node.keyword.toLowerCase() === "tacon");
  if (roots.length === 0) {
    ctx.diagnostics.push({
      line: 1,
      column: 1,
      severity: "error",
      message: 'A Tac-On starts with `tacon my-tac-on { ... }`.',
    });
    return { ok: false, manifest: null, diagnostics: ctx.diagnostics };
  }
  if (roots.length > 1) {
    error(ctx, roots[1], "There can only be one Tac-On in a file.");
  }
  for (const node of parsed.nodes) {
    if (node.keyword.toLowerCase() !== "tacon") {
      error(ctx, node, `"${node.keyword}" is outside the Tac-On. Everything goes inside the braces.`);
    }
  }

  const root = roots[0];
  const slug = text(root.args[0]).toLowerCase();
  if (!SLUG.test(slug)) {
    error(
      ctx,
      root,
      'A Tac-On needs a name like `tacon my-tac-on` - lowercase letters, numbers and hyphens.',
    );
  }

  const manifest: Manifest = {
    slug,
    name: titleCase(slug),
    version: "1.0.0",
    about: "",
    icon: "puzzle",
    category: "general",
    author: null,
    needs: [],
    provides: [],
    uses: [],
    settings: [],
    stores: [],
    pages: [],
    panels: [],
    positions: [],
    hooks: [],
    computes: [],
    calendars: [],
    extensions: {},
  };

  // Two passes: stores and `use` first, so a page written above the store it
  // reads still compiles. People write the interesting part first.
  for (const node of root.children) {
    const keyword = node.keyword.toLowerCase();
    if (keyword === "store") {
      const store = compileStore(ctx, node);
      if (store) manifest.stores.push(store);
    } else if (keyword === "use") {
      const target = text(node.args[0]).toLowerCase();
      const alias = words(node.args).filter((word) => word.toLowerCase() !== "as")[1] ?? target;
      if (!SLUG.test(target)) {
        error(ctx, node, '`use` takes the name of another Tac-On, like `use points-ledger as points`.');
        continue;
      }
      if (target === slug) {
        error(ctx, node, "A Tac-On can't use itself.");
        continue;
      }
      const use: UseDef = { slug: target, alias: alias.replace(/-/g, "_") };
      ctx.uses.set(use.alias, use);
      manifest.uses.push(use);
    } else if (keyword === "setting") {
      const setting = compileSetting(ctx, node);
      if (setting) manifest.settings.push(setting);
    } else if (keyword === "position") {
      // Only the name for now, so a page above the position can `allow` it.
      const name = text(node.args[0]);
      if (!IDENTIFIER.test(name)) continue; // compilePosition reports it.
      if ((AUDIENCES as readonly string[]).includes(name.toLowerCase())) {
        error(ctx, node, `"${name}" is already a role. Give the position its own name.`);
      } else if (ctx.positions.has(name)) {
        error(ctx, node, `There's already a position called "${name}".`);
      } else {
        ctx.positions.add(name);
      }
    }
  }

  // `choice from` can name a store declared further down, so it's checked now.
  for (const { node, store, field } of ctx.choiceSources) {
    const from = field.from!;
    checkPaths(ctx, node, from.where);
    if (from.store.length === 1) {
      const source = ctx.stores.get(from.store[0]);
      if (!source) {
        error(ctx, node, `There's no store called "${from.store[0]}" for "${field.name}" to choose from.`);
      } else if (
        [from.field, ...(from.also ?? [])].some(
          (name) => !source.fields.some((entry) => entry.name === name) && !ROW_FIELDS.includes(name),
        )
      ) {
        const missing = [from.field, ...(from.also ?? [])].find(
          (name) => !source.fields.some((entry) => entry.name === name) && !ROW_FIELDS.includes(name),
        );
        error(ctx, node, `"${source.name}" has no field called "${missing}" to show in the choices.`);
      } else if (source.name === store.name) {
        error(ctx, node, `"${field.name}" can't choose from its own store.`);
      }
    } else if (!ctx.uses.has(from.store[0])) {
      error(ctx, node, `To choose from "${from.store.join(".")}" you first need \`use <tac-on> as ${from.store[0]}\`.`);
    }
  }

  // Extensions own their language constructs. All positions are already known.
  for (const extension of compilerExtensions) {
    const nodes = root.children.filter(node => extension.definitionKeywords.includes(node.keyword.toLowerCase()));
    if (!nodes.length) continue;
    const configuration = extension.compileDefinitions(ctx, nodes);
    ctx.extensionConfigurations.set(extension.id, configuration);
    manifest.extensions![extension.id] = configuration;
  }

  for (const node of root.children) {
    const keyword = node.keyword.toLowerCase();
    const value = joined(node.args);
    // Whatever this line adds is checked for paths that read through a field.
    const before = manifestSizes(manifest);

    switch (keyword) {
      case "engine":
        if (manifest.contract) error(ctx, node, "Declare engine once.");
        manifest.contract = compileContract(node, ctx.diagnostics, child => audiences(ctx, child));
        manifest.formatVersion = 2;
        break;
      case "tags":
        manifest.tags = words(node.args);
        if (manifest.tags.length > 10 || manifest.tags.some(tag => tag.length > 40)) error(ctx, node, "Use up to ten tags of 40 characters each.");
        break;
      case "store":
      case "use":
      case "setting":
        break;
      case "extension":
        if (!compilerExtensions.some(extension => extension.id === value)) {
          error(ctx, node, `The engine doesn't have an extension called "${value}".`);
        }
        break;

      case "name":
        manifest.name = value || manifest.name;
        break;
      case "version":
        if (!VERSION.test(value)) {
          error(ctx, node, 'A version looks like `version 1.0.0`.');
        } else {
          manifest.version = value;
        }
        break;
      case "about":
      case "description":
        manifest.about = value;
        break;
      case "icon":
        manifest.icon = text(node.args[0]) || manifest.icon;
        break;
      case "category":
        manifest.category = text(node.args[0]).toLowerCase() || manifest.category;
        break;
      case "author":
        manifest.author = value || null;
        break;

      case "needs":
      case "need":
        for (const permission of words(node.args)) ctx.needs.add(permission);
        break;

      case "provides":
      case "provide":
        manifest.provides.push(...words(node.args));
        break;

      case "page": {
        const page = compilePage(ctx, node);
        if (page) {
          if (manifest.pages.some((entry) => entry.name === page.name)) {
            error(ctx, node, `There's already a page called "${page.name}".`);
          } else {
            manifest.pages.push(page);
          }
        }
        break;
      }

      case "panel": {
        const panel = compilePanel(ctx, node);
        if (panel) manifest.panels.push(panel);
        break;
      }

      case "position": {
        const position = compilePosition(ctx, node);
        // A duplicate or a role's name was reported in the first pass.
        if (position && ctx.positions.has(position.name) && !manifest.positions.some((entry) => entry.name === position.name)) {
          manifest.positions.push(position);
        }
        break;
      }

      case "calendar": {
        const feed = compileCalendar(ctx, node);
        if (feed) manifest.calendars!.push(feed);
        break;
      }

      case "when": {
        const hook = compileHook(ctx, node);
        if (hook) manifest.hooks.push(hook);
        break;
      }

      case "ask": {
        const name = text(node.args[0]);
        if (!IDENTIFIER.test(name)) {
          error(ctx, node, 'A value needs a one-word name, like `ask balance sum of entry.amount`.');
          break;
        }
        if (ctx.computes.has(name)) {
          error(ctx, node, `There's already a value called "${name}".`);
          break;
        }
        const expr = expressionOf(ctx, node, 1);
        if (expr) {
          ctx.computes.add(name);
          manifest.computes.push({ name, expr } satisfies ComputeDef);
        }
        break;
      }

      default:
        if (compilerExtensions.some(extension => extension.definitionKeywords.includes(keyword))) break;
        error(
          ctx,
          node,
          `"${node.keyword}" isn't part of a Tac-On. Use name, version, about, store, setting, extension, page, panel, position, calendar, when, ask, needs, provides, use or a registered extension definition.`,
        );
    }
    checkPathsAfter(ctx, node, manifest, before);
  }

  manifest.needs = [...ctx.needs].sort();
  if (ctx.studioPositions.size > 0) {
    manifest.studioPositions = [...new Map([...ctx.studioPositions].map((title) => [title.toLowerCase(), title])).values()];
    // Knowing who holds a studio's positions is reading its positions.
    if (!manifest.needs.includes("positions.read")) manifest.needs = [...manifest.needs, "positions.read"].sort();
  }

  for (const feed of manifest.calendars ?? []) {
    if (feed.open && !manifest.pages.some((page) => page.name === feed.open)) {
      error(ctx, root, `A calendar opens "${feed.open}", but there's no page by that name.`);
    }
  }

  // `provides` has to name something that exists, or another Tac-On will break
  // in a way its author can do nothing about.
  for (const name of manifest.provides) {
    const known = ctx.stores.has(name) || ctx.computes.has(name);
    if (!known) {
      error(ctx, root, `"${name}" is listed under provides, but there's no store or value by that name.`);
    }
  }

  if (!manifest.about) {
    warn(ctx, root, "Add an `about` line - it's what admins read before installing.");
  }
  if (
    manifest.pages.length === 0 &&
    manifest.panels.length === 0 &&
    manifest.positions.length === 0 &&
    manifest.hooks.length === 0 &&
    (manifest.calendars ?? []).length === 0
  ) {
    error(ctx, root, "This Tac-On doesn't add anything: give it a page, a panel, a position, a calendar or a `when`.");
  }

  const failed = ctx.diagnostics.some((entry) => entry.severity === "error");
  if (failed) return { ok: false, manifest: null, diagnostics: sorted(ctx.diagnostics) };
  return { ok: true, manifest, diagnostics: sorted(ctx.diagnostics) };
}

/* -------------------------------------------------------------------------- */
/*  Reading through a `choice from` field                                      */
/* -------------------------------------------------------------------------- */

type ManifestSizes = Record<"pages" | "panels" | "positions" | "hooks" | "computes" | "calendars", number>;

function manifestSizes(manifest: Manifest): ManifestSizes {
  return {
    pages: manifest.pages.length,
    panels: manifest.panels.length,
    positions: manifest.positions.length,
    hooks: manifest.hooks.length,
    computes: manifest.computes.length,
    calendars: manifest.calendars?.length ?? 0,
  };
}

/** Walks what one top-level line added and checks every three-part path in it. */
function checkPathsAfter(ctx: Ctx, node: Node, manifest: Manifest, before: ManifestSizes): void {
  const added: unknown[] = [
    ...manifest.pages.slice(before.pages),
    ...manifest.panels.slice(before.panels),
    ...manifest.positions.slice(before.positions),
    ...manifest.hooks.slice(before.hooks),
    ...manifest.computes.slice(before.computes),
    ...(manifest.calendars ?? []).slice(before.calendars),
  ];
  checkPaths(ctx, node, added);
}

/** Reports every path in `value` that reads through a field that can't be read through. */
function checkPaths(ctx: Ctx, node: Node, value: unknown): void {
  const seen = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record.kind === "path" && Array.isArray(record.parts)) {
      const parts = record.parts as string[];
      const key = parts.join(".");
      if (parts.length >= 3 && !seen.has(key)) {
        seen.add(key);
        const problem = throughProblem(ctx, parts);
        if (problem) error(ctx, node, problem);
      }
      return;
    }
    Object.values(record).forEach(walk);
  };
  walk(value);
}

/**
 * `finished.assignment.block`: `finished` is a store, `assignment` a `choice
 * from` field in it, `block` a field of the row it picked. Anything else of
 * that shape would quietly read as empty, so it is an error. Paths that don't
 * start with one of our own stores are left alone.
 */
function throughProblem(ctx: Ctx, parts: string[]): string | null {
  let store = ctx.stores.get(parts[0]);
  if (!store) return null;
  const path = parts.join(".");
  for (let index = 1; index < parts.length - 1; index += 1) {
    const field = store.fields.find((entry) => entry.name === parts[index]);
    if (!field) return `\`${path}\`: "${store.name}" has no field called "${parts[index]}".`;
    if (!field.from) {
      return `\`${path}\`: "${field.name}" isn't a \`choice from\` field, so there's no row to read "${parts[index + 1]}" from.`;
    }
    if (field.from.store.length > 1) return null; // Another Tac-On's store; checked when it runs.
    const next = ctx.stores.get(field.from.store[0]);
    if (!next) return null; // Reported where the field is declared.
    const wanted = parts[index + 1];
    if (!next.fields.some((entry) => entry.name === wanted) && !ROW_FIELDS.includes(wanted)) {
      return `\`${path}\`: "${next.name}" has no field called "${wanted}".`;
    }
    store = next;
  }
  return null;
}

/** A list column that reads through a `choice from` field: `assignment.block`. */
function throughColumn(ctx: Ctx, storeName: string, column: string): boolean {
  const parts = column.split(".");
  if (parts.length < 2) return false;
  return throughProblem(ctx, [storeName, ...parts]) === null && ctx.stores.get(storeName)?.fields.some(
    (field) => field.name === parts[0] && field.from,
  ) === true;
}

function sorted(diagnostics: Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((a, b) => a.line - b.line || a.column - b.column);
}
