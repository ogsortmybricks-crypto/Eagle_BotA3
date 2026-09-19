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
import {
  AUDIENCES,
  BASE_COLUMNS,
  BASE_SOURCES,
  FIELD_TYPES,
  HOOK_EVENTS,
  PANEL_HOSTS,
  SOURCE_PERMISSIONS,
  type Action,
  type Audience,
  type BaseSource,
  type CompileResult,
  type ComputeDef,
  type Condition,
  type Diagnostic,
  type Expr,
  type FieldType,
  type HookDef,
  type HookEvent,
  type Manifest,
  type PageDef,
  type PanelDef,
  type PanelHost,
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
};

function error(ctx: Ctx, node: { line: number; column: number }, message: string) {
  ctx.diagnostics.push({ line: node.line, column: node.column, severity: "error", message });
}

function warn(ctx: Ctx, node: { line: number; column: number }, message: string) {
  ctx.diagnostics.push({ line: node.line, column: node.column, severity: "warning", message });
}

/** `show to admin, secretary` / `allow learner` / `show to everyone`. */
function audiences(ctx: Ctx, node: Node): string[] {
  const list = words(node.args).filter((word) => word.toLowerCase() !== "to");
  const roles: string[] = [];
  for (const entry of list) {
    const lower = entry.toLowerCase();
    if (!(AUDIENCES as readonly string[]).includes(lower)) {
      error(
        ctx,
        node,
        `"${entry}" isn't an audience. Use ${AUDIENCES.join(", ")}.`,
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

    const rest = words(child.args.slice(2));
    const required = rest.some((word) => word.toLowerCase() === "required");
    const options = rest.filter((word) => word.toLowerCase() !== "required");

    if (typeWord === "choice" && options.length < 2) {
      error(ctx, child, `A choice field needs its options: \`field ${fieldName} choice earn, spend\`.`);
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

function compileWidget(ctx: Ctx, node: Node): Widget | null {
  const keyword = node.keyword.toLowerCase();

  switch (keyword) {
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

    case "stat": {
      const label = text(node.args[0]) || "Total";
      const value = expressionOf(ctx, node, 1);
      if (!value) return null;
      const hintLine = node.children.find((child) => child.keyword.toLowerCase() === "hint");
      return {
        kind: "stat",
        label,
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
      error(
        ctx,
        node,
        `"${node.keyword}" isn't something a page can show. Use note, heading, stat, list, form, button or divider.`,
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
    source,
    columns: [] as string[],
    where: null as Condition | null,
    sort: "newest" as "newest" | "oldest" | "az",
    limit: 25,
    empty: "Nothing here yet.",
    allowRemove: [] as string[],
  };

  for (const child of node.children) {
    const keyword = child.keyword.toLowerCase();
    switch (keyword) {
      case "title":
        widget.title = joined(child.args);
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
          widget.where = conditionOf(ctx, child.args.slice(split + 1), child.line);
        }
        break;
      }
      case "where":
        widget.where = conditionOf(ctx, child.args, child.line);
        break;
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
      case "allow":
        // `allow remove admin` - the only per-row action a list offers.
        widget.allowRemove = audiences(ctx, {
          ...child,
          args: child.args.filter((token) => token.value.toLowerCase() !== "remove"),
        });
        break;
      default:
        error(ctx, child, `"${child.keyword}" doesn't belong in a list.`);
    }
  }

  if (widget.columns.length === 0) {
    widget.columns = known.slice(0, 5);
    if (widget.columns.length === 0) {
      error(ctx, node, "This list needs a `columns` line saying what to show.");
      return null;
    }
  } else if (known.length > 0) {
    for (const column of widget.columns) {
      // `created` and `by` are added to every store row by the runtime.
      if (known.includes(column) || column === "created" || column === "by") continue;
      error(ctx, node, `There's no "${column}" to show here. Available: ${known.join(", ")}.`);
    }
  }

  return widget;
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
    allow: [] as string[],
    submitLabel: "Save",
    then: [] as Action[],
  };

  for (const child of node.children) {
    const keyword = child.keyword.toLowerCase();
    switch (keyword) {
      case "into":
        break;
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

  if (widget.fields.length === 0) {
    // A form with no questions is almost always a half-finished one.
    widget.fields = store.fields.map((field) => ({ field: field.name, label: null }));
    warn(ctx, node, `This form doesn't ask anything, so it asks for every field in "${storeName}".`);
  }

  return widget;
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
      'A Tac-On needs a name like `tacon hero-bucks` - lowercase letters, numbers and hyphens.',
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
    hooks: [],
    computes: [],
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
        error(ctx, node, '`use` takes the name of another Tac-On, like `use hero-bucks as bucks`.');
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
    }
  }

  for (const node of root.children) {
    const keyword = node.keyword.toLowerCase();
    const value = joined(node.args);

    switch (keyword) {
      case "store":
      case "use":
      case "setting":
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
        error(
          ctx,
          node,
          `"${node.keyword}" isn't part of a Tac-On. Use name, version, about, store, setting, page, panel, when, ask, needs, provides or use.`,
        );
    }
  }

  manifest.needs = [...ctx.needs].sort();

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
    manifest.hooks.length === 0
  ) {
    error(ctx, root, "This Tac-On doesn't add anything: give it a page, a panel or a `when`.");
  }

  const failed = ctx.diagnostics.some((entry) => entry.severity === "error");
  if (failed) return { ok: false, manifest: null, diagnostics: sorted(ctx.diagnostics) };
  return { ok: true, manifest, diagnostics: sorted(ctx.diagnostics) };
}

function sorted(diagnostics: Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((a, b) => a.line - b.line || a.column - b.column);
}
