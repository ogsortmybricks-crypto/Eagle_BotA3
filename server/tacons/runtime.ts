/**
 * Running a Tac-On.
 *
 * The rule this file exists to keep: a Tac-On can never show a person anything
 * they could not already see. Every read of the base app goes through the same
 * permission check and the same studio scope as the page it came from, using
 * the *viewer's* role - not the author's, and not the installing admin's. A
 * Tac-On that lists `people` in a studio you can't open returns nothing, and
 * says so.
 *
 * The second rule: nothing here executes anything. Widgets are evaluated by
 * walking the expression tree in `shared/tacons/expr.ts`, and the client is
 * handed finished strings.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  activityLog,
  elections,
  meetingItems,
  meetings,
  positionHolders,
  positions,
  studios,
  taconInstalls,
  taconRecords,
  users,
  votes,
  wikiRules,
  wikiSections,
  type Academy,
  type User,
} from "@shared/schema";
import { can } from "@shared/permissions";
import type { AcademySettings } from "@shared/settings";
import {
  display,
  evaluate,
  matches,
  type Action,
  type BaseSource,
  type Condition,
  type EvalContext,
  type Expr,
  type FieldType,
  type ListWidget,
  type Manifest,
  type PageDef,
  type PanelDef,
  type Row,
  type StoreDef,
  type Widget,
} from "@shared/tacons";
import { SOURCE_PERMISSIONS } from "@shared/tacons";
import type {
  TaconPanelView,
  TaconView,
  ViewColumn,
  ViewPerson,
  ViewRow,
  ViewWidget,
} from "@shared/tacons/view";
import { logActivity } from "../activity";
import { scoped, studioFilter, type StudioScope } from "../studio";
import type { LoadedInstall } from "./registry";
import { resolveUses } from "./registry";

/**
 * How many rows one store contributes to a `sum` or a filtered list.
 *
 * Aggregates are evaluated in memory so the same expression code can run on
 * both sides of the wire. A ledger for one studio does not come close to this;
 * a Tac-On that does needs a different design, and should say so out loud
 * rather than quietly reporting a wrong total.
 */
export const MAX_ROWS = 2000;

export type Runtime = {
  academyId: number;
  /** The person looking. Null inside a hook, which has no viewer. */
  user: User | null;
  scope: StudioScope | undefined;
  settings: AcademySettings;
  install: LoadedInstall;
  uses: Map<string, LoadedInstall>;
  rows: Map<string, Row[]>;
  computed: Map<string, unknown>;
  resolving: Set<string>;
  people: Map<number, string>;
};

export async function buildRuntime(options: {
  academy: Academy;
  settings: AcademySettings;
  user: User | null;
  scope: StudioScope | undefined;
  install: LoadedInstall;
}): Promise<Runtime> {
  const uses = await resolveUses(options.academy.id, options.install.manifest);
  const people = new Map<number, string>();
  const roster = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.academyId, options.academy.id), eq(users.active, true)));
  for (const person of roster) people.set(person.id, person.name);

  return {
    academyId: options.academy.id,
    user: options.user,
    scope: options.scope,
    settings: options.settings,
    install: options.install,
    uses,
    rows: new Map(),
    computed: new Map(),
    resolving: new Set(),
    people,
  };
}

/* -------------------------------------------------------------------------- */
/*  Audiences                                                                  */
/* -------------------------------------------------------------------------- */

/** An empty list means everyone who can already open the page. */
export function audienceAllows(audience: string[], user: User | null): boolean {
  if (audience.length === 0) return true;
  if (!user) return false;
  return audience.some((entry) =>
    entry === "dev" ? user.devStatus : entry === user.role,
  );
}

const AUDIENCE_PLURALS: Record<string, string> = {
  admin: "admins",
  guide: "guides",
  secretary: "secretaries",
  learner: "learners",
  dev: "devs",
};

function audienceWords(audience: string[]): string {
  if (audience.length === 0) return "anyone";
  const words = audience.map((role) => AUDIENCE_PLURALS[role] ?? `${role}s`);
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/* -------------------------------------------------------------------------- */
/*  The Tac-On's own storage                                                   */
/* -------------------------------------------------------------------------- */

function storeDef(manifest: Manifest, name: string): StoreDef | undefined {
  return manifest.stores.find((store) => store.name === name);
}

function rowFrom(record: { id: number; data: Record<string, unknown>; createdAt: Date; createdBy: number | null }, runtime: Runtime): Row {
  return {
    ...record.data,
    id: record.id,
    created: record.createdAt.toISOString(),
    by: record.createdBy ? (runtime.people.get(record.createdBy) ?? "Someone") : "Tac-On",
    byId: record.createdBy,
  };
}

/**
 * Rows for a store path. `["entry"]` is our own; `["bucks", "entry"]` belongs to
 * another Tac-On, and only works if that Tac-On listed the store under
 * `provides` and is installed in this academy.
 */
export async function loadRows(runtime: Runtime, source: string[]): Promise<Row[]> {
  const key = source.join(".");
  const cached = runtime.rows.get(key);
  if (cached) return cached;

  let install: LoadedInstall | undefined = runtime.install;
  let storeName = source[0];

  if (source.length > 1) {
    install = runtime.uses.get(source[0]);
    storeName = source[1];
    if (!install) {
      runtime.rows.set(key, []);
      return [];
    }
    if (!install.manifest.provides.includes(storeName)) {
      runtime.rows.set(key, []);
      return [];
    }
  }

  if (!storeDef(install.manifest, storeName)) {
    runtime.rows.set(key, []);
    return [];
  }

  const records = await db
    .select()
    .from(taconRecords)
    .where(and(eq(taconRecords.installId, install.install.id), eq(taconRecords.store, storeName)))
    .orderBy(desc(taconRecords.createdAt))
    .limit(MAX_ROWS);

  const rows = records.map((record) => rowFrom(record, runtime));
  runtime.rows.set(key, rows);
  return rows;
}

/** Preloads every store an expression or widget could touch. */
async function preload(runtime: Runtime, sources: string[][]): Promise<void> {
  for (const source of sources) await loadRows(runtime, source);
}

/* -------------------------------------------------------------------------- */
/*  Named values (`ask`)                                                       */
/* -------------------------------------------------------------------------- */

export async function computeValue(runtime: Runtime, path: string[]): Promise<unknown> {
  const key = path.join(".");
  // A value that asks for itself would spin forever. Report nothing instead.
  if (runtime.resolving.has(key)) return undefined;

  let install: LoadedInstall | undefined = runtime.install;
  let name = path[0];
  if (path.length > 1) {
    install = runtime.uses.get(path[0]);
    name = path[1];
    if (!install) return undefined;
  }

  const compute = install.manifest.computes.find((entry) => entry.name === name);
  if (!compute) return undefined;

  runtime.resolving.add(key);
  try {
    // Another Tac-On's value is computed against its own storage, so its store
    // names resolve through its alias rather than ours.
    const prefix = path.length > 1 ? [path[0]] : [];
    await preloadForExpr(runtime, compute.expr, prefix);
    const value = evaluate(compute.expr, contextFor(runtime, { prefix }));
    runtime.computed.set(key, value);
    return value;
  } finally {
    runtime.resolving.delete(key);
  }
}

/**
 * Works out every named value before anything renders.
 *
 * Two passes, because a value is allowed to be written in terms of another one
 * declared below it - people write `ask spendable` above the `ask balance` it
 * leans on often enough that failing would just be rude.
 *
 * Another Tac-On's private values are computed too (its own values may depend
 * on them) and then dropped, so only what it listed under `provides` survives
 * into the map our expressions can read.
 */
async function resolveComputes(runtime: Runtime): Promise<void> {
  for (let pass = 0; pass < 2; pass += 1) {
    for (const compute of runtime.install.manifest.computes) {
      await computeValue(runtime, [compute.name]);
    }
    for (const use of runtime.install.manifest.uses) {
      const other = runtime.uses.get(use.alias);
      if (!other) continue;
      for (const compute of other.manifest.computes) {
        await computeValue(runtime, [use.alias, compute.name]);
      }
    }
  }

  for (const use of runtime.install.manifest.uses) {
    const other = runtime.uses.get(use.alias);
    if (!other) continue;
    for (const compute of other.manifest.computes) {
      if (!other.manifest.provides.includes(compute.name)) {
        runtime.computed.delete(`${use.alias}.${compute.name}`);
      }
    }
  }
}

/** Walks an expression and loads every store it mentions. */
async function preloadForExpr(runtime: Runtime, expr: Expr | null, prefix: string[]): Promise<void> {
  if (!expr) return;
  switch (expr.kind) {
    case "aggregate": {
      const source = expr.source.length === 1 ? [...prefix, ...expr.source] : expr.source;
      await loadRows(runtime, source);
      if (expr.where) await preloadForCondition(runtime, expr.where, prefix);
      break;
    }
    case "binary":
      await preloadForExpr(runtime, expr.left, prefix);
      await preloadForExpr(runtime, expr.right, prefix);
      break;
    case "template":
      for (const part of expr.parts) {
        if (typeof part !== "string") await preloadForExpr(runtime, part, prefix);
      }
      break;
    case "path":
      // `my.balance` and `bucks.balance` are values, resolved on demand.
      break;
    default:
      break;
  }
}

async function preloadForCondition(runtime: Runtime, condition: Condition, prefix: string[]) {
  for (const comparison of condition.all) {
    await preloadForExpr(runtime, comparison.left, prefix);
    await preloadForExpr(runtime, comparison.right, prefix);
  }
}

/* -------------------------------------------------------------------------- */
/*  Evaluation context                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Computed values are resolved eagerly before rendering and handed to the
 * evaluator as a plain map, because the evaluator is synchronous by design -
 * an expression language that can await is an expression language that can
 * hang a page.
 */
export function contextFor(
  runtime: Runtime,
  options: { event?: Row; row?: Row | null; prefix?: string[] } = {},
): EvalContext {
  const prefix = options.prefix ?? [];
  return {
    me: runtime.user
      ? {
          id: runtime.user.id,
          name: runtime.user.name,
          role: runtime.user.role,
          studioId: runtime.user.studioId,
          email: runtime.user.email,
        }
      : {},
    event: options.event ?? {},
    setting: settingValues(runtime),
    row: options.row ?? null,
    rowAliases: [],
    records: (source) => {
      const key = (source.length === 1 ? [...prefix, ...source] : source).join(".");
      return runtime.rows.get(key) ?? [];
    },
    compute: (path) => {
      const key = [...prefix, ...path].join(".");
      if (runtime.computed.has(key)) return runtime.computed.get(key);

      // A value borrowed from a Tac-On this academy hasn't installed reads as
      // zero rather than as a blank. "You have  bucks" looks like a bug; "You
      // have 0 bucks" is what is actually true here.
      const alias = path.length > 1 ? path[0] : null;
      const declared = runtime.install.manifest.uses.some((use) => use.alias === alias);
      if (alias && declared && !runtime.uses.has(alias)) return 0;

      return undefined;
    },
  };
}

function settingValues(runtime: Runtime): Row {
  const stored = runtime.install.install.settings ?? {};
  const values: Row = {};
  for (const setting of runtime.install.manifest.settings) {
    values[setting.name] = stored[setting.name] ?? setting.default;
  }
  return values;
}

/* -------------------------------------------------------------------------- */
/*  Reading the base app                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Base-app rows for a `list from ...`.
 *
 * Checked against the viewer's permissions every single time. The Tac-On's
 * declared `needs` are shown to the admin at install time; they are not what
 * grants access here.
 */
async function baseRows(runtime: Runtime, source: BaseSource, limit: number): Promise<{ rows: Row[]; problem: string | null }> {
  const user = runtime.user;
  if (!user) return { rows: [], problem: null };

  const permission = SOURCE_PERMISSIONS[source];
  if (!can(user.role, permission, runtime.settings, { devStatus: user.devStatus })) {
    return { rows: [], problem: `This needs ${permission}, which your role doesn't have.` };
  }

  const scope = runtime.scope;
  const academyId = runtime.academyId;
  const studioRows = await db.select().from(studios).where(eq(studios.academyId, academyId));
  const studioName = (id: number | null) =>
    id === null ? "Academy-wide" : (studioRows.find((entry) => entry.id === id)?.name ?? "");

  const narrow = (base: ReturnType<typeof eq>, column: Parameters<typeof studioFilter>[0]) =>
    scope ? scoped(base, column, scope) : base;

  switch (source) {
    case "wiki.rules": {
      const rows = await db
        .select({ rule: wikiRules, sectionTitle: wikiSections.title, studioId: wikiSections.studioId })
        .from(wikiRules)
        .innerJoin(wikiSections, eq(wikiSections.id, wikiRules.sectionId))
        .where(narrow(eq(wikiRules.academyId, academyId), wikiSections.studioId))
        .orderBy(desc(wikiRules.updatedAt))
        .limit(limit);
      return {
        rows: rows.map((row) => ({
          id: row.rule.id,
          title: row.rule.title,
          body: row.rule.body,
          status: row.rule.status,
          section: row.sectionTitle,
          studio: studioName(row.studioId),
          updated: row.rule.updatedAt.toISOString(),
        })),
        problem: null,
      };
    }

    case "wiki.sections": {
      const rows = await db
        .select({
          section: wikiSections,
          ruleCount: sql<number>`count(${wikiRules.id})`,
        })
        .from(wikiSections)
        .leftJoin(wikiRules, eq(wikiRules.sectionId, wikiSections.id))
        .where(narrow(eq(wikiSections.academyId, academyId), wikiSections.studioId))
        .groupBy(wikiSections.id)
        .limit(limit);
      return {
        rows: rows.map((row) => ({
          id: row.section.id,
          title: row.section.title,
          summary: row.section.summary ?? "",
          rules: Number(row.ruleCount ?? 0),
          studio: studioName(row.section.studioId),
          updated: row.section.updatedAt.toISOString(),
        })),
        problem: null,
      };
    }

    case "positions": {
      const rows = await db
        .select()
        .from(positions)
        .where(narrow(eq(positions.academyId, academyId), positions.studioId))
        .limit(limit);
      const holders = await db
        .select({ positionId: positionHolders.positionId, name: users.name, ended: positionHolders.endedAt })
        .from(positionHolders)
        .innerJoin(users, eq(users.id, positionHolders.userId))
        .where(eq(positionHolders.academyId, academyId));
      return {
        rows: rows.map((position) => ({
          id: position.id,
          title: position.title,
          seats: position.seats,
          elected: position.elected,
          holders: holders
            .filter((holder) => holder.positionId === position.id && holder.ended === null)
            .map((holder) => holder.name)
            .join(", "),
          studio: studioName(position.studioId),
        })),
        problem: null,
      };
    }

    case "elections": {
      const rows = await db
        .select()
        .from(elections)
        .where(narrow(eq(elections.academyId, academyId), elections.studioId))
        .orderBy(desc(elections.createdAt))
        .limit(limit);
      const tallies = await db
        .select({ electionId: votes.electionId, total: sql<number>`count(*)` })
        .from(votes)
        .where(eq(votes.academyId, academyId))
        .groupBy(votes.electionId);
      return {
        rows: rows.map((election) => ({
          id: election.id,
          title: election.title,
          status: election.status,
          type: election.type,
          votes: Number(tallies.find((tally) => tally.electionId === election.id)?.total ?? 0),
          opens: election.opensAt?.toISOString() ?? "",
          closes: election.closesAt?.toISOString() ?? "",
          studio: studioName(election.studioId),
        })),
        problem: null,
      };
    }

    case "meetings": {
      const rows = await db
        .select({ meeting: meetings, secretary: users.name })
        .from(meetings)
        .leftJoin(users, eq(users.id, meetings.secretaryId))
        .where(narrow(eq(meetings.academyId, academyId), meetings.studioId))
        .orderBy(desc(meetings.meetingDate))
        .limit(limit);
      const counts = await db
        .select({ meetingId: meetingItems.meetingId, total: sql<number>`count(*)` })
        .from(meetingItems)
        .where(eq(meetingItems.academyId, academyId))
        .groupBy(meetingItems.meetingId);
      return {
        rows: rows.map((row) => ({
          id: row.meeting.id,
          title: row.meeting.title,
          date: row.meeting.meetingDate.toISOString(),
          status: row.meeting.status,
          items: Number(counts.find((count) => count.meetingId === row.meeting.id)?.total ?? 0),
          secretary: row.secretary ?? "",
          studio: studioName(row.meeting.studioId),
        })),
        problem: null,
      };
    }

    case "people": {
      const rows = await db
        .select()
        .from(users)
        .where(narrow(eq(users.academyId, academyId), users.studioId))
        .limit(limit);
      const held = await db
        .select({ userId: positionHolders.userId, title: positions.title, ended: positionHolders.endedAt })
        .from(positionHolders)
        .innerJoin(positions, eq(positions.id, positionHolders.positionId))
        .where(eq(positionHolders.academyId, academyId));
      return {
        rows: rows
          .filter((person) => person.active)
          .map((person) => ({
            id: person.id,
            name: person.name,
            role: person.role,
            studio: studioName(person.studioId),
            nga: person.nga ?? "",
            positions: held
              .filter((entry) => entry.userId === person.id && entry.ended === null)
              .map((entry) => entry.title)
              .join(", "),
          })),
        problem: null,
      };
    }

    case "activity": {
      const rows = await db
        .select({ entry: activityLog, actor: users.name })
        .from(activityLog)
        .leftJoin(users, eq(users.id, activityLog.actorUserId))
        .where(narrow(eq(activityLog.academyId, academyId), activityLog.studioId))
        .orderBy(desc(activityLog.createdAt))
        .limit(limit);
      return {
        rows: rows.map((row) => ({
          id: row.entry.id,
          action: row.entry.action,
          summary: row.entry.summary,
          actor: row.actor ?? row.entry.actorLabel ?? "Eagle Bot",
          when: row.entry.createdAt.toISOString(),
          studio: studioName(row.entry.studioId),
        })),
        problem: null,
      };
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Rendering                                                                  */
/* -------------------------------------------------------------------------- */

function columnLabel(store: StoreDef | undefined, key: string): { label: string; type: FieldType | "text" } {
  if (key === "created") return { label: "When", type: "date" };
  if (key === "by") return { label: "By", type: "text" };
  const field = store?.fields.find((entry) => entry.name === key);
  if (field) return { label: field.label, type: field.type };
  return { label: key.replace(/[_-]/g, " ").replace(/^./, (letter) => letter.toUpperCase()), type: "text" };
}

function cellText(value: unknown, type: FieldType | "text", runtime: Runtime): string {
  if (type === "person") {
    const id = Number(value);
    if (Number.isFinite(id) && runtime.people.has(id)) return runtime.people.get(id)!;
    return display(value);
  }
  return display(value);
}

async function renderList(runtime: Runtime, widget: ListWidget): Promise<ViewWidget> {
  let rows: Row[] = [];
  let problem: string | null = null;
  let store: StoreDef | undefined;
  let storeName: string | null = null;

  if (widget.source.kind === "base") {
    // Base lists are filtered in SQL down to the limit, then again by `where`.
    const result = await baseRows(runtime, widget.source.source, Math.max(widget.limit, 50));
    rows = result.rows;
    problem = result.problem;
  } else {
    const source = widget.source.store;
    rows = await loadRows(runtime, source);
    storeName = source.length > 1 ? source.join(".") : source[0];
    const owner = source.length > 1 ? runtime.uses.get(source[0]) : runtime.install;
    store = owner ? storeDef(owner.manifest, source[source.length - 1]) : undefined;
    if (source.length > 1 && !owner) {
      problem = `"${source[0]}" isn't installed in this academy, so there's nothing to show.`;
    }
  }

  const aliases = [storeName?.split(".").pop() ?? "row", "row", "it"];
  const filtered = widget.where
    ? rows.filter((row) => matches(widget.where, { ...contextFor(runtime), row, rowAliases: aliases }))
    : rows;

  const sorted = [...filtered];
  if (widget.sort === "oldest") sorted.reverse();
  if (widget.sort === "az") {
    const first = widget.columns[0];
    sorted.sort((a, b) => display(a[first]).localeCompare(display(b[first])));
  }

  const columns: ViewColumn[] = widget.columns.map((key) => ({ key, ...columnLabel(store, key) }));
  const canRemove = storeName !== null && !storeName.includes(".") && audienceAllows(widget.allowRemove, runtime.user) && widget.allowRemove.length > 0;

  const viewRows: ViewRow[] = sorted.slice(0, widget.limit).map((row) => ({
    id: (row.id as number | string) ?? "",
    cells: Object.fromEntries(
      columns.map((column) => [column.key, cellText(row[column.key], column.type, runtime)]),
    ),
    canRemove,
  }));

  return {
    kind: "list",
    title: widget.title,
    columns,
    rows: viewRows,
    empty: widget.empty,
    store: storeName,
    problem,
  };
}

async function renderWidget(runtime: Runtime, widget: Widget, index: number): Promise<ViewWidget | null> {
  switch (widget.kind) {
    case "divider":
      return { kind: "divider" };

    case "note":
      return {
        kind: "note",
        text: display(evaluate(widget.text, contextFor(runtime))),
        tone: widget.tone,
      };

    case "heading":
      return { kind: "heading", text: display(evaluate(widget.text, contextFor(runtime))) };

    case "stat":
      return {
        kind: "stat",
        label: widget.label,
        value: display(evaluate(widget.value, contextFor(runtime))),
        hint: widget.hint ? display(evaluate(widget.hint, contextFor(runtime))) : null,
      };

    case "list":
      return renderList(runtime, widget);

    case "form": {
      const store = storeDef(runtime.install.manifest, widget.into);
      if (!store) return null;
      const allowed = audienceAllows(widget.allow, runtime.user);
      return {
        kind: "form",
        index,
        title: widget.title,
        submitLabel: widget.submitLabel,
        allowed,
        deniedReason: allowed ? null : `Only ${audienceWords(widget.allow)} can add to this.`,
        fields: widget.fields.flatMap((entry) => {
          const field = store.fields.find((candidate) => candidate.name === entry.field);
          if (!field) return [];
          return [
            {
              name: field.name,
              label: entry.label ?? field.label,
              type: field.type,
              options: field.options,
              required: field.required,
            },
          ];
        }),
      };
    }

    case "button":
      return {
        kind: "button",
        index,
        label: widget.label,
        confirm: widget.confirm,
        allowed: audienceAllows(widget.allow, runtime.user),
      };
  }
}

/** Loads every store the page's widgets and values will need, once. */
async function preloadForWidgets(runtime: Runtime, widgets: Widget[]): Promise<void> {
  const sources: string[][] = [];
  for (const widget of widgets) {
    if (widget.kind === "list" && widget.source.kind === "store") sources.push(widget.source.store);
    if (widget.kind === "stat") {
      await preloadForExpr(runtime, widget.value, []);
      if (widget.hint) await preloadForExpr(runtime, widget.hint, []);
    }
    if (widget.kind === "note") await preloadForExpr(runtime, widget.text, []);
    if (widget.kind === "heading") await preloadForExpr(runtime, widget.text, []);
  }
  await preload(runtime, sources);

  // Named values are resolved up front so a template like "You have
  // {my.balance} bucks" can be evaluated synchronously when it renders.
  await resolveComputes(runtime);
}

export async function renderPage(runtime: Runtime, page: PageDef): Promise<TaconView> {
  await preloadForWidgets(runtime, page.widgets);

  const widgets: ViewWidget[] = [];
  for (const [index, widget] of page.widgets.entries()) {
    const rendered = await renderWidget(runtime, widget, index);
    if (rendered) widgets.push(rendered);
  }

  return {
    install: {
      id: runtime.install.install.id,
      slug: runtime.install.tacon.slug,
      name: runtime.install.tacon.name,
      icon: runtime.install.manifest.icon,
      version: runtime.install.version.version,
      studioName: runtime.install.studioName,
      official: runtime.install.tacon.official,
      authorName: runtime.install.tacon.authorName,
    },
    page: { name: page.name, title: page.title, subtitle: page.subtitle, icon: page.icon },
    widgets,
    people: peopleList(runtime),
  };
}

export async function renderPanel(runtime: Runtime, panel: PanelDef): Promise<TaconPanelView> {
  await preloadForWidgets(runtime, panel.widgets);

  const widgets: ViewWidget[] = [];
  for (const [index, widget] of panel.widgets.entries()) {
    const rendered = await renderWidget(runtime, widget, index);
    if (rendered) widgets.push(rendered);
  }

  return {
    installId: runtime.install.install.id,
    taconName: runtime.install.tacon.name,
    title: panel.title,
    icon: runtime.install.manifest.icon,
    widgets,
    people: peopleList(runtime),
  };
}

function peopleList(runtime: Runtime): ViewPerson[] {
  return [...runtime.people.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* -------------------------------------------------------------------------- */
/*  Writing                                                                    */
/* -------------------------------------------------------------------------- */

/** Coerces whatever arrived into the shape the field promised. */
export function coerce(value: unknown, type: FieldType): unknown {
  switch (type) {
    case "number": {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    case "boolean":
      return value === true || value === "true" || value === "yes" || value === 1;
    case "person": {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    case "date": {
      const text = String(value ?? "").trim();
      if (!text) return "";
      const date = new Date(text);
      return Number.isNaN(date.getTime()) ? text : date.toISOString().slice(0, 10);
    }
    default:
      return String(value ?? "").slice(0, 4000);
  }
}

export type WriteResult = { ok: true; id: number } | { ok: false; error: string };

export async function addRecord(
  runtime: Runtime,
  storeName: string,
  values: Record<string, unknown>,
  actor: { type: "user" | "tacon"; userId: number | null },
): Promise<WriteResult> {
  const store = storeDef(runtime.install.manifest, storeName);
  if (!store) return { ok: false, error: `This Tac-On has no store called "${storeName}".` };

  const data: Record<string, unknown> = {};
  for (const field of store.fields) {
    const raw = values[field.name];
    const clean = coerce(raw, field.type);
    if (field.required && (clean === null || clean === "" || clean === undefined)) {
      return { ok: false, error: `"${field.label}" is needed.` };
    }
    if (field.type === "choice" && clean !== "" && !field.options.includes(String(clean))) {
      return { ok: false, error: `"${field.label}" has to be one of: ${field.options.join(", ")}.` };
    }
    if (field.type === "person" && clean !== null && !runtime.people.has(Number(clean))) {
      return { ok: false, error: `"${field.label}" has to be someone in this academy.` };
    }
    data[field.name] = clean;
  }

  const [record] = await db
    .insert(taconRecords)
    .values({
      academyId: runtime.academyId,
      installId: runtime.install.install.id,
      store: storeName,
      data,
      createdByType: actor.type,
      createdBy: actor.userId,
    })
    .returning();

  // The cache is now a version behind, and the next read in this request
  // (a `then` action, say) should see the row it just wrote.
  runtime.rows.delete(storeName);
  runtime.computed.clear();

  return { ok: true, id: record.id };
}

/**
 * Runs a Tac-On's actions - the `then` of a form, the body of a button, or
 * what a `when` hook does. Failures are logged and skipped: one broken action
 * must not take down the election that triggered it.
 */
export async function runActions(
  runtime: Runtime,
  actions: Action[],
  options: { event?: Row; actorUserId: number | null; studioId: number | null; reason: string },
): Promise<{ added: number; notices: string[] }> {
  let added = 0;
  const notices: string[] = [];

  for (const action of actions) {
    try {
      if (action.kind === "add") {
        await preloadForExprList(runtime, action.values.map((entry) => entry.value));
        const context = contextFor(runtime, { event: options.event });
        const values: Record<string, unknown> = {};
        for (const entry of action.values) values[entry.field] = evaluate(entry.value, context);
        const result = await addRecord(runtime, action.store, values, {
          type: options.actorUserId ? "user" : "tacon",
          userId: options.actorUserId,
        });
        if (result.ok) added += 1;
        else notices.push(result.error);
        continue;
      }

      const text = display(evaluate(action.text, contextFor(runtime, { event: options.event })));
      notices.push(text);
      await logActivity({
        academyId: runtime.academyId,
        studioId: options.studioId,
        actorUserId: options.actorUserId,
        actorType: options.actorUserId ? "user" : "system",
        actorLabel: runtime.install.tacon.name,
        action: "tacon.notice",
        entityType: "tacon",
        entityId: runtime.install.install.id,
        summary: `${runtime.install.tacon.name}: ${text}`,
        metadata: { slug: runtime.install.tacon.slug, reason: options.reason },
      });
    } catch (error) {
      console.error(`[tacon] ${runtime.install.tacon.slug} failed an action`, error);
    }
  }

  return { added, notices };
}

async function preloadForExprList(runtime: Runtime, exprs: Expr[]): Promise<void> {
  for (const expr of exprs) await preloadForExpr(runtime, expr, []);
  await resolveComputes(runtime);
}
