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
  toNumber,
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
import {
  LINK_COLUMN,
  PROGRESS_COLUMN,
  SOURCE_PERMISSIONS,
  audiencePosition,
  audienceStudioPosition,
  type CalendarFeedDef,
  type ClockWord,
  type FormWidget,
  type GroupLevel,
  type PositionDef,
  type StoreField,
} from "@shared/tacons";
import type {
  TaconDeskView,
  TaconPanelView,
  TaconRecordView,
  TaconView,
  ViewChoice,
  ViewColumn,
  ViewFormField,
  ViewPerson,
  ViewRow,
  ViewWidget,
} from "@shared/tacons/view";
import { logActivity } from "../activity";
import { scoped, studioFilter, type StudioScope } from "../studio";
import { eventsInRange, expand, resolveLens } from "../calendar";
import {
  addDays,
  dayInZone,
  daysBetween,
  isTimeZone,
  KIND_LABELS,
  startOfWeek,
  weekdayName,
} from "@shared/calendar";
import type { LoadedInstall } from "./registry";
import { resolveUses } from "./registry";
import { heldNames, positionFacts, type PositionFacts } from "./positions";
import { renderExtensionWidget } from "./extensions";

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
  /** The Tac-On's positions the viewer holds right now, by name. */
  held: Set<string>;
  /** What `position.<name>` reads. */
  positions: PositionFacts;
  /** The academy's time zone, or null for the server's own clock. */
  timeZone: string | null;
  /** `today`, `this_week_start`, `session_start`, `weekday`. */
  clock: Record<ClockWord, string>;
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

  const installId = options.install.install.id;
  const held = options.user ? await heldNames(options.user.id, installId) : new Set<string>();
  const positions = await positionFacts(installId, options.install.manifest);

  const zone = options.settings.display?.timeZone;
  const timeZone = isTimeZone(zone) ? zone : null;
  const today = dayInZone(new Date(), timeZone);

  const runtime: Runtime = {
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
    held,
    positions,
    timeZone,
    clock: {
      today,
      this_week_start: startOfWeek(today, 0),
      session_start: "",
      weekday: weekdayName(today),
    },
  };

  // Finding the running session reads the calendar, so only Tac-Ons that ask
  // for it pay for it. Every name a manifest uses is in its JSON as a string.
  if (JSON.stringify(options.install.manifest).includes('"session_start"')) {
    runtime.clock.session_start = (await runningSession(runtime))?.starts ?? "";
  }
  return runtime;
}

/** The calendar lens a Tac-On reads with: the studio being looked at, or everything. */
async function calendarLens(runtime: Runtime) {
  const scope = runtime.scope;
  return resolveLens(
    runtime.academyId,
    scope ?? ({ studioId: null, canSeeAll: true, readableIds: [] } as unknown as StudioScope),
    scope?.studioId != null ? "studio" : "academy",
    null,
  );
}

/** Sessions from a year back to a year ahead, in order. */
async function sessionsAround(runtime: Runtime) {
  const lens = await calendarLens(runtime);
  const today = runtime.clock.today;
  const from = addDays(today, -366);
  const to = addDays(today, 366);
  const sessions = (await eventsInRange(runtime.academyId, lens, from, to)).filter((event) => event.kind === "session");
  return expand(sessions, lens, from, to);
}

/** The session on the calendar today, if there is one. */
async function runningSession(runtime: Runtime): Promise<{ starts: string; ends: string } | null> {
  const today = runtime.clock.today;
  const running = (await sessionsAround(runtime)).find(
    (item) => item.occurrenceStart <= today && item.occurrenceEnd >= today,
  );
  return running ? { starts: running.occurrenceStart, ends: running.occurrenceEnd } : null;
}

/* -------------------------------------------------------------------------- */
/*  Audiences                                                                  */
/* -------------------------------------------------------------------------- */

const NOTHING_HELD: ReadonlySet<string> = new Set();

/**
 * An empty list means everyone who can already open the page. `held` is the
 * Tac-On's positions this person holds, for audiences that name one.
 */
export function audienceAllows(
  audience: string[],
  user: User | null,
  held: ReadonlySet<string> = NOTHING_HELD,
): boolean {
  if (audience.length === 0) return true;
  if (!user) return false;
  return audience.some((entry) => {
    const position = audiencePosition(entry);
    if (position !== null) return held.has(position);
    // A studio's own seat: `held` carries those under the same audience key.
    if (audienceStudioPosition(entry) !== null) return held.has(entry);
    return entry === "dev" ? user.devStatus : entry === user.role;
  });
}

const AUDIENCE_PLURALS: Record<string, string> = {
  admin: "admins",
  guide: "guides",
  secretary: "secretaries",
  learner: "learners",
  dev: "devs",
};

function audienceWords(audience: string[], manifest: Manifest): string {
  if (audience.length === 0) return "anyone";
  const words = audience.map((role) => {
    const seat = audienceStudioPosition(role);
    if (seat !== null) {
      return `the ${manifest.studioPositions?.find((title) => title.toLowerCase() === seat) ?? seat}`;
    }
    const position = audiencePosition(role);
    if (position === null) return AUDIENCE_PLURALS[role] ?? `${role}s`;
    return `the ${manifest.positions.find((def) => def.name === position)?.title ?? position}`;
  });
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/* -------------------------------------------------------------------------- */
/*  The Tac-On's own storage                                                   */
/* -------------------------------------------------------------------------- */

function storeDef(manifest: Manifest, name: string): StoreDef | undefined {
  return manifest.stores.find((store) => store.name === name);
}

export function rowFrom(record: { id: number; data: Record<string, unknown>; createdAt: Date; createdBy: number | null }, runtime: Runtime): Row {
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

  // `finished.assignment.block` reads the row a `choice from` field picked,
  // and expressions can't wait for a load - so the stores our own rows point
  // into come in with them. The cache above stops this going round in circles.
  if (source.length === 1) {
    for (const field of storeDef(install.manifest, storeName)?.fields ?? []) {
      if (field.from) await loadRows(runtime, field.from.store);
    }
  }
  return rows;
}

/**
 * Reads through a `choice from` field: `assignment` in `finished` holds a row
 * id of `assignment`, and `rest` is read from that row - through another
 * `choice from` field in it, if `rest` goes on. Undefined when `field` isn't
 * a `choice from` field, so the path is read the ordinary way.
 */
function readThrough(
  runtime: Runtime,
  storeName: string,
  fieldName: string,
  id: unknown,
  rest: string[],
): { value: unknown } | undefined {
  const field = storeDef(runtime.install.manifest, storeName)?.fields.find((entry) => entry.name === fieldName);
  if (!field?.from || rest.length === 0) return undefined;
  const picked = (runtime.rows.get(field.from.store.join(".")) ?? []).find(
    (row) => id !== null && id !== undefined && id !== "" && String(row.id) === String(id),
  );
  if (!picked) return { value: undefined };
  if (rest.length >= 2 && field.from.store.length === 1) {
    const deeper = readThrough(runtime, field.from.store[0], rest[0], picked[rest[0]], rest.slice(1));
    if (deeper) return deeper;
  }
  let value: unknown = picked;
  for (const key of rest) value = value && typeof value === "object" ? (value as Row)[key] : undefined;
  return { value };
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
    case "pick":
      await preloadForExpr(runtime, expr.left, prefix);
      await preloadForExpr(runtime, expr.right, prefix);
      break;
    case "if":
      await preloadForCondition(runtime, expr.when, prefix);
      await preloadForExpr(runtime, expr.then, prefix);
      await preloadForExpr(runtime, expr.otherwise, prefix);
      break;
    case "name":
      await preloadForExpr(runtime, expr.of, prefix);
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

async function preloadForCondition(runtime: Runtime, condition: Condition | null | undefined, prefix: string[]) {
  if (!condition) return;
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
    // Another Tac-On's positions are its own business, so a borrowed value
    // reads none of them.
    positions: prefix.length === 0 ? runtime.positions : {},
    clock: runtime.clock,
    timeZone: runtime.timeZone,
    personName: (id) => {
      const number = Number(id);
      return Number.isFinite(number) ? runtime.people.get(number) : undefined;
    },
    // Only our own stores' fields can be read through; a borrowed value's rows aren't ours.
    through: prefix.length === 0 ? (store, field, id, rest) => readThrough(runtime, store, field, id, rest) : undefined,
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

    case "calendar":
    case "calendar.sessions": {
      // The studio being looked at, its group and the academy - or, with no
      // studio selected, everything the viewer can read.
      const lens = await calendarLens(runtime);
      const today = runtime.clock.today;
      if (source === "calendar") {
        // What's coming up: today onwards, soonest first.
        const to = addDays(today, 180);
        const items = expand(await eventsInRange(academyId, lens, today, to), lens, today, to);
        return {
          rows: items.slice(0, limit).map((item) => ({
            id: item.key,
            title: item.title,
            kind: KIND_LABELS[item.kind] ?? item.kind,
            starts: item.occurrenceStart,
            ends: item.occurrenceEnd,
            time: item.startTime ? `${item.startTime}–${item.endTime}` : "All day",
            location: item.location ?? "",
            quest: item.quest ?? "",
            description: item.description,
            studio: item.ownerLabel,
          })),
          problem: null,
        };
      }
      // Sessions across this school year and the next, in order.
      return {
        rows: (await sessionsAround(runtime))
          .slice(0, limit)
          .map((item) => ({
            id: item.key,
            title: item.title,
            quest: item.quest ?? "",
            starts: item.occurrenceStart,
            ends: item.occurrenceEnd,
            weeks: Math.ceil((daysBetween(item.occurrenceStart, item.occurrenceEnd) + 1) / 7),
            status: item.occurrenceEnd < today ? "done" : item.occurrenceStart > today ? "upcoming" : "running",
            studio: item.ownerLabel,
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

/** Where a widget sits: a page, a panel on a base page, or a position's desk. */
export type WidgetLocation = { page?: string; panel?: string; position?: string };

/** A list as it sits on a page, `show if` and all. */
type ListOnPage = Extract<Widget, { kind: "list" }>;

type ColumnType = FieldType | "text" | "link" | "progress";

function columnLabel(store: StoreDef | undefined, key: string, manifest?: Manifest): { label: string; type: ColumnType } {
  if (key === PROGRESS_COLUMN) return { label: "Progress", type: "progress" };
  // `assignment.block`: labelled and shown like the picked row's own field.
  const [first, ...rest] = key.split(".");
  if (rest.length > 0 && manifest) {
    const field = store?.fields.find((entry) => entry.name === first);
    const source = field?.from?.store.length === 1 ? storeDef(manifest, field.from.store[0]) : undefined;
    if (field?.from && source) {
      const inner = columnLabel(source, rest.join("."), manifest);
      return { label: `${field.label}: ${inner.label}`, type: inner.type };
    }
  }
  if (key === "created") return { label: "When", type: "date" };
  if (key === "by") return { label: "By", type: "text" };
  // `byId` is shown as the person it points at; `id` as the number it is.
  if (key === "byId") return { label: "By", type: "person" };
  if (key === "id") return { label: "#", type: "text" };
  if (key === LINK_COLUMN) return { label: "", type: "link" };
  const field = store?.fields.find((entry) => entry.name === key);
  if (field) return { label: field.label, type: field.type };
  return { label: key.replace(/[_-]/g, " ").replace(/^./, (letter) => letter.toUpperCase()), type: "text" };
}

function cellText(value: unknown, type: ColumnType, runtime: Runtime): string {
  if (type === "person") {
    const id = Number(value);
    if (Number.isFinite(id) && runtime.people.has(id)) return runtime.people.get(id)!;
    return display(value);
  }
  return display(value);
}

/** "Draft 2 · Quest": the fields a `choice from` shows, joined. */
function choiceLabel(from: NonNullable<StoreField["from"]>, row: Row): string {
  return [from.field, ...(from.also ?? [])]
    .map((name) => display(row[name]))
    .filter(Boolean)
    .join(" · ");
}

/**
 * What each saved option of a `choice from` field is called: row id -> the
 * field it is shown by. Every row of the source, so an old answer still reads
 * as its title after the row stops matching the `where`.
 */
async function choiceLabels(runtime: Runtime, field: StoreField): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  if (!field.from) return labels;
  for (const row of await loadRows(runtime, field.from.store)) {
    labels.set(String(row.id), choiceLabel(field.from, row));
  }
  return labels;
}

/** The rows a `choice from` field offers this viewer right now. */
export async function choicesFor(runtime: Runtime, field: StoreField): Promise<ViewChoice[]> {
  const from = field.from;
  if (!from) return [];
  const rows = await loadRows(runtime, from.store);
  await preloadForCondition(runtime, from.where, []);
  await resolveComputes(runtime);
  const aliases = [from.store[from.store.length - 1], "row", "it"];
  return rows
    .filter((row) => matches(from.where, { ...contextFor(runtime), row, rowAliases: aliases }))
    .map((row) => ({ value: String(row.id), label: choiceLabel(from, row) || `#${String(row.id)}` }));
}

/** The day a value falls on: a day as it is, a saved moment in the academy's zone. */
function dayOf(runtime: Runtime, value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : dayInZone(date, runtime.timeZone);
}

function formatDay(day: string, options: Intl.DateTimeFormatOptions): string {
  // Days are calendar days, so they're formatted at UTC noon to stay put.
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
}

/** The folder a row goes in at one level of a `group by`. */
function groupLabel(
  runtime: Runtime,
  level: GroupLevel,
  row: Row,
  store: StoreDef | undefined,
  labels: Map<string, Map<string, string>>,
): string {
  const value = row[level.field];
  if (level.part) {
    const day = dayOf(runtime, value);
    if (!day) return "No date";
    switch (level.part) {
      case "year":
        return day.slice(0, 4);
      case "month":
        return formatDay(day, { month: "long", year: "numeric" });
      case "week":
        return `Week of ${formatDay(startOfWeek(day, 0), { month: "short", day: "numeric", year: "numeric" })}`;
      case "day":
        return formatDay(day, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
    }
  }
  const own = labels.get(level.field);
  if (own) return own.get(String(value)) || "None";
  const { type } = columnLabel(store, level.field, runtime.install.manifest);
  return cellText(value, type, runtime) || "None";
}

/** The app path of one row's own page. `query` says which widget it was opened from. */
function recordHref(runtime: Runtime, rowId: unknown, query: Record<string, string | number>): string {
  const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  return `/t/${runtime.install.install.id}/record/${String(rowId)}?${params.toString()}`;
}

function locationQuery(location: WidgetLocation, index: number): Record<string, string | number> {
  if (location.page) return { page: location.page, index };
  if (location.position) return { position: location.position, index };
  return { panel: location.panel ?? "", index };
}

/**
 * Whether this viewer may remove a row through this list: any row it shows,
 * for the roles in `allow remove`; their own rows, with `allow remove own`.
 * The row has to be one the list would show them - same `where`, same
 * `show if` - so a row id typed by hand can't reach past the list.
 */
export async function listOffersRemove(runtime: Runtime, widget: ListOnPage, row: Row): Promise<boolean> {
  const user = runtime.user;
  if (!user) return false;
  const anyRow = widget.allowRemove.length > 0 && audienceAllows(widget.allowRemove, user, runtime.held);
  const ownRow = Boolean(widget.removeOwn) && Number(row.byId) === user.id;
  if (!anyRow && !ownRow) return false;
  return listShowsRow(runtime, widget, row);
}

/** Whether a list, as this viewer sees it, includes this row. */
export async function listShowsRow(runtime: Runtime, widget: ListOnPage, row: Row): Promise<boolean> {
  if (!(await widgetVisible(runtime, widget))) return false;
  if (widget.source.kind !== "store") return false;
  await preloadForCondition(runtime, widget.where, []);
  await resolveComputes(runtime);
  const storeName = widget.source.store[widget.source.store.length - 1];
  return matches(widget.where, { ...contextFor(runtime), row, rowAliases: [storeName, "row", "it"] });
}

async function renderList(
  runtime: Runtime,
  widget: ListOnPage,
  location: WidgetLocation,
  index: number,
): Promise<ViewWidget> {
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

  // A list's `value` lines, worked out for each row: `each` is that row.
  const values = widget.values ?? [];
  const withValues = (row: Row): Row => {
    if (values.length === 0) return row;
    const out: Row = { ...row };
    const context = { ...contextFor(runtime), row, rowAliases: aliases, each: row };
    for (const entry of values) out[entry.name] = evaluate(entry.expr, context);
    return out;
  };

  // Sorting a-z by a value needs every row's value; otherwise only the rows shown.
  const sortsByValue = widget.sort === "az" && values.some((entry) => entry.name === widget.columns[0]);
  let sorted = sortsByValue ? filtered.map(withValues) : [...filtered];
  if (widget.sort === "oldest") sorted.reverse();
  if (widget.sort === "az") {
    const first = widget.columns[0];
    sorted.sort((a, b) => display(a[first]).localeCompare(display(b[first]), undefined, { numeric: true }));
  }
  sorted = sorted.slice(0, widget.limit);
  if (!sortsByValue) sorted = sorted.map(withValues);

  // `choice from` fields hold a row id; they're shown as that row's title.
  const labels = new Map<string, Map<string, string>>();
  const ownStore = storeName !== null && !storeName.includes(".");
  if (ownStore) {
    for (const field of store?.fields ?? []) {
      if (field.from) labels.set(field.name, await choiceLabels(runtime, field));
    }
  }

  const manifest = runtime.install.manifest;
  const columns: ViewColumn[] = widget.columns.map((key) => ({ key, ...columnLabel(store, key, manifest) }));
  const user = runtime.user;
  const removeAny =
    ownStore && widget.allowRemove.length > 0 && audienceAllows(widget.allowRemove, user, runtime.held);
  const removeOwn = ownStore && Boolean(widget.removeOwn) && user !== null;
  const linked = ownStore && widget.columns.includes(LINK_COLUMN);
  const groupBy = widget.groupBy ?? [];
  const totals = widget.totals ?? [];

  // Columns and folders that read through a `choice from` field, `assignment.block`.
  const throughKeys = ownStore
    ? [...widget.columns, ...groupBy.map((level) => level.field)].filter((key) => key.includes("."))
    : [];
  const valueOf = (row: Row, key: string): unknown => {
    if (!throughKeys.includes(key)) return row[key];
    const [field, ...rest] = key.split(".");
    return readThrough(runtime, storeName!, field, row[field], rest)?.value;
  };

  const viewRows: ViewRow[] = sorted.map((row) => {
    const shown: Row = { ...row };
    for (const key of throughKeys) shown[key] = valueOf(row, key);
    const bar = widget.progress
      ? { value: toNumber(shown[widget.progress.value]), goal: toNumber(shown[widget.progress.goal]) }
      : null;

    const view: ViewRow = {
      id: (row.id as number | string) ?? "",
      cells: Object.fromEntries(
        columns.map((column) => {
          if (column.type === "link") return [column.key, "Open"];
          if (column.type === "progress") return [column.key, bar ? `${display(bar.value)} of ${display(bar.goal)}` : ""];
          const own = labels.get(column.key);
          if (own) return [column.key, own.get(String(shown[column.key])) ?? display(shown[column.key])];
          return [column.key, cellText(shown[column.key], column.type, runtime)];
        }),
      ),
      canRemove: removeAny || (removeOwn && Number(row.byId) === user!.id),
    };
    if (linked) view.link = recordHref(runtime, row.id, locationQuery(location, index));
    if (groupBy.length > 0) view.groups = groupBy.map((level) => groupLabel(runtime, level, shown, store, labels));
    if (bar) view.progress = bar;
    if (totals.length > 0) view.numbers = Object.fromEntries(totals.map((key) => [key, toNumber(shown[key])]));
    return view;
  });

  return {
    kind: "list",
    title: widget.titleTemplate ? display(evaluate(widget.titleTemplate, contextFor(runtime))) : widget.title,
    columns,
    rows: viewRows,
    empty: widget.empty,
    store: storeName,
    problem,
    ...(groupBy.length > 0 ? { groupDepth: groupBy.length } : {}),
    ...(totals.length > 0 ? { totals } : {}),
  };
}

/**
 * `show if`: whether a widget is drawn for this viewer right now. Checked when
 * it renders and again when its form or button is used, so a hidden form
 * can't be submitted by hand.
 */
export async function widgetVisible(runtime: Runtime, widget: Widget): Promise<boolean> {
  if (!widget.showIf) return true;
  await preloadForCondition(runtime, widget.showIf, []);
  await resolveComputes(runtime);
  return matches(widget.showIf, contextFor(runtime));
}

function textOf(runtime: Runtime, raw: string, template: Expr | undefined): string {
  return template ? display(evaluate(template, contextFor(runtime))) : raw;
}

async function renderWidget(
  runtime: Runtime,
  widget: Widget,
  index: number,
  location: WidgetLocation,
): Promise<ViewWidget | null> {
  if (widget.showIf && !matches(widget.showIf, contextFor(runtime))) return null;

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
        label: textOf(runtime, widget.label, widget.labelTemplate),
        value: display(evaluate(widget.value, contextFor(runtime))),
        hint: widget.hint ? display(evaluate(widget.hint, contextFor(runtime))) : null,
      };

    case "progress": {
      const value = toNumber(evaluate(widget.value, contextFor(runtime)));
      const goal = toNumber(evaluate(widget.goal, contextFor(runtime)));
      return {
        kind: "progress",
        label: textOf(runtime, widget.label, widget.labelTemplate),
        value,
        goal,
        text: `${display(value)} of ${display(goal)}`,
        hint: widget.hint ? display(evaluate(widget.hint, contextFor(runtime))) : null,
      };
    }

    case "celebrate": {
      const text = display(evaluate(widget.text, contextFor(runtime)));
      const where = location.page ?? location.panel ?? location.position ?? "";
      return { kind: "celebrate", key: `${runtime.install.install.id}:${where}:${index}:${text}`, text };
    }

    case "list":
      return renderList(runtime, widget, location, index);

    case "form": {
      const store = storeDef(runtime.install.manifest, widget.into);
      if (!store) return null;
      const allowed = audienceAllows(widget.allow, runtime.user, runtime.held);
      const fields: ViewFormField[] = [];
      for (const entry of widget.fields) {
        const field = store.fields.find((candidate) => candidate.name === entry.field);
        if (!field) continue;
        fields.push({
          name: field.name,
          label: entry.label ?? field.label,
          type: field.type,
          options: field.options,
          required: field.required,
          ...(field.from ? { choices: await choicesFor(runtime, field) } : {}),
        });
      }
      return {
        kind: "form",
        index,
        title: widget.title,
        submitLabel: widget.submitLabel,
        allowed,
        deniedReason: allowed
          ? null
          : `Only ${audienceWords(widget.allow, runtime.install.manifest)} can add to this.`,
        fields,
        confirm: widget.confirm ?? null,
        confirmCode: Boolean(widget.confirmCode),
      };
    }

    case "button":
      return {
        kind: "button",
        index,
        label: widget.label,
        confirm: widget.confirm,
        allowed: audienceAllows(widget.allow, runtime.user, runtime.held),
      };

    case "program": {
      if (!runtime.user) return { kind: "note", tone: "warning", text: "Sign in to run this Tac-On program." };
      const bundle = runtime.install.manifest.programBundles?.[widget.entry];
      if (!bundle) return { kind: "note", tone: "warning", text: `Program "${widget.entry}" is missing. Its developer must republish the complete package.` };
      const data: Record<string, Row[]> = {};
      for (const store of widget.reads) {
        data[store] = await loadRows(runtime, [store]);
      }
      if (JSON.stringify(data).length > 500_000) return { kind: "note", tone: "warning", text: "This program's declared data exceeds the 500 KB view limit. Reduce the data in its stores." };
      return {
        ...widget, index, bundle, data,
        viewer: { id: runtime.user.id, name: runtime.user.name, role: runtime.user.role },
      };
    }
    case "extension":
      return renderExtensionWidget(runtime, widget, index);
  }
  // Old persisted widgets are interpreted by their owning package.
  return renderExtensionWidget(runtime, widget, index);
}

/** Loads every store the page's widgets and values will need, once. */
async function preloadForWidgets(runtime: Runtime, widgets: Widget[]): Promise<void> {
  const sources: string[][] = [];
  for (const widget of widgets) {
    await preloadForCondition(runtime, widget.showIf, []);
    if (widget.kind === "list") {
      if (widget.source.kind === "store") sources.push(widget.source.store);
      await preloadForCondition(runtime, widget.where, []);
      await preloadForExpr(runtime, widget.titleTemplate ?? null, []);
      for (const entry of widget.values ?? []) await preloadForExpr(runtime, entry.expr, []);
    }
    if (widget.kind === "stat") {
      await preloadForExpr(runtime, widget.value, []);
      await preloadForExpr(runtime, widget.labelTemplate ?? null, []);
      if (widget.hint) await preloadForExpr(runtime, widget.hint, []);
    }
    if (widget.kind === "progress") {
      await preloadForExpr(runtime, widget.value, []);
      await preloadForExpr(runtime, widget.goal, []);
      await preloadForExpr(runtime, widget.labelTemplate ?? null, []);
      if (widget.hint) await preloadForExpr(runtime, widget.hint, []);
    }
    if (widget.kind === "note") await preloadForExpr(runtime, widget.text, []);
    if (widget.kind === "heading") await preloadForExpr(runtime, widget.text, []);
    if (widget.kind === "celebrate") await preloadForExpr(runtime, widget.text, []);
  }
  await preload(runtime, sources);

  // Named values are resolved up front so a template like "You have
  // {my.balance} bucks" can be evaluated synchronously when it renders.
  await resolveComputes(runtime);
}

/** A page's title for this viewer: `{...}` worked out, or the title as written. */
export async function pageTitle(runtime: Runtime, page: PageDef): Promise<string> {
  if (!page.titleTemplate) return page.title;
  await preloadForExpr(runtime, page.titleTemplate, []);
  await resolveComputes(runtime);
  return display(evaluate(page.titleTemplate, contextFor(runtime))).trim() || titleWithoutValues(page.title);
}

/** "Calls with {name of my.ap}" -> "Calls with", for when there's nothing to fill in. */
function titleWithoutValues(title: string): string {
  return title.replace(/\{[^}]*\}/g, "").replace(/\s+/g, " ").trim();
}

async function renderWidgets(runtime: Runtime, widgets: Widget[], location: WidgetLocation): Promise<ViewWidget[]> {
  await preloadForWidgets(runtime, widgets);
  const out: ViewWidget[] = [];
  for (const [index, widget] of widgets.entries()) {
    const rendered = await renderWidget(runtime, widget, index, location);
    if (rendered) out.push(rendered);
  }
  return out;
}

function installSummary(runtime: Runtime): TaconView["install"] {
  return {
    id: runtime.install.install.id,
    slug: runtime.install.tacon.slug,
    name: runtime.install.tacon.name,
    icon: runtime.install.manifest.icon,
    version: runtime.install.version.version,
    studioName: runtime.install.studioName,
    official: runtime.install.tacon.official,
    authorName: runtime.install.tacon.authorName,
  };
}

export async function renderPage(runtime: Runtime, page: PageDef): Promise<TaconView> {
  const widgets = await renderWidgets(runtime, page.widgets, { page: page.name });
  return {
    install: installSummary(runtime),
    page: { name: page.name, title: await pageTitle(runtime, page), subtitle: page.subtitle, icon: page.icon },
    pages: await siblingPages(runtime),
    widgets,
    people: peopleList(runtime),
  };
}

/**
 * The pages of this Tac-On a viewer can move between: the ones in the
 * sidebar (`nav`) that their role and positions open. The same rule the
 * sidebar uses, so a tab never leads to a page that refuses them.
 */
async function siblingPages(runtime: Runtime): Promise<{ name: string; title: string }[]> {
  const pages: { name: string; title: string }[] = [];
  for (const page of runtime.install.manifest.pages) {
    if (!page.nav || !audienceAllows(page.showTo, runtime.user, runtime.held)) continue;
    pages.push({ name: page.name, title: await pageTitle(runtime, page) });
  }
  return pages;
}

/**
 * One row on its own page. The caller has already decided this viewer may
 * see it; this only picks the fields and words them.
 */
export async function renderRecord(
  runtime: Runtime,
  options: {
    store: string;
    row: Row;
    /** The fields to show. Empty means every field, then who saved it and when. */
    fields: string[];
    title: Expr | null;
    back: { label: string; href: string } | null;
    /** Columns to leave out: a list's own `value` names. */
    skip?: string[];
  },
): Promise<TaconRecordView | null> {
  const store = storeDef(runtime.install.manifest, options.store);
  if (!store) return null;
  const row = options.row;

  // A list's `value` and `progress` columns belong to the list, not the record.
  const keys = (options.fields.length > 0 ? options.fields : [...store.fields.map((field) => field.name), "by", "created"])
    .filter((key) => key !== LINK_COLUMN && key !== PROGRESS_COLUMN && !(options.skip ?? []).includes(key));
  await loadRows(runtime, [options.store]); // and the stores its choices point into
  const fields: TaconRecordView["fields"] = [];
  for (const key of keys) {
    const { label, type } = columnLabel(store, key, runtime.install.manifest);
    const [first, ...rest] = key.split(".");
    const raw = rest.length > 0 ? readThrough(runtime, options.store, first, row[first], rest)?.value : row[key];
    const field = store.fields.find((entry) => entry.name === key);
    let value = cellText(raw, type, runtime);
    if (field?.from) value = (await choiceLabels(runtime, field)).get(String(row[key])) ?? value;
    fields.push({ key, label, type: type === "link" || type === "progress" ? "text" : type, value });
  }

  let title = store.label;
  if (options.title) {
    await preloadForExpr(runtime, options.title, []);
    await resolveComputes(runtime);
    const context = { ...contextFor(runtime), row, rowAliases: [options.store, "row", "it"] };
    title = display(evaluate(options.title, context)) || title;
  }

  return { install: installSummary(runtime), title, fields, back: options.back };
}

/** One record of a Tac-On, as an entry on the studio calendar. */
export type TaconCalendarEntry = {
  key: string;
  title: string;
  start: string;
  end: string;
  startTime: string | null;
  kind: string;
  color: string | null;
  installId: number;
  taconName: string;
  /** The Tac-On page (or the record's own page) to open, when its `calendar` block names one. */
  href: string | null;
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Whether a calendar block puts this row on the calendar for this viewer. */
export async function feedShowsRow(runtime: Runtime, feed: CalendarFeedDef, row: Row): Promise<boolean> {
  if (!audienceAllows(feed.showTo, runtime.user, runtime.held)) return false;
  await preloadForCondition(runtime, feed.where, []);
  await resolveComputes(runtime);
  return matches(feed.where, { ...contextFor(runtime), row, rowAliases: [feed.store[feed.store.length - 1], "row", "it"] });
}

/**
 * Everything this install's `calendar` blocks put between `from` and `to`,
 * for the person looking. Same audience rules and same records as its pages,
 * so a calendar can never show what the Tac-On's own page wouldn't.
 */
export async function calendarFeed(runtime: Runtime, from: string, to: string): Promise<TaconCalendarEntry[]> {
  const feeds = runtime.install.manifest.calendars ?? [];
  const out: TaconCalendarEntry[] = [];

  // `my.*` in a title or a `where` needs the named values worked out first,
  // just as a page does before it renders.
  for (const feed of feeds) {
    await preloadForExpr(runtime, feed.title, []);
    await preloadForCondition(runtime, feed.where, []);
  }
  await resolveComputes(runtime);

  for (const [index, feed] of feeds.entries()) {
    if (!audienceAllows(feed.showTo, runtime.user, runtime.held)) continue;
    const rows = await loadRows(runtime, feed.store);
    const aliases = [feed.store[feed.store.length - 1], "row", "it"];
    for (const row of rows) {
      const context = { ...contextFor(runtime), row, rowAliases: aliases };
      if (feed.where && !matches(feed.where, context)) continue;
      // `created` is a moment; it goes on the day it was in the academy's time zone.
      const start = dayOf(runtime, row[feed.on]);
      if (!start) continue;
      let end = feed.until ? (dayOf(runtime, row[feed.until]) ?? start) : start;
      if (end < start) end = start;
      if (end < from || start > to) continue;
      const time = feed.at ? String(row[feed.at] ?? "").trim() : "";
      out.push({
        key: `tacon-${runtime.install.install.id}-${index}-${String(row.id)}`,
        title: display(evaluate(feed.title, context)) || runtime.install.tacon.name,
        start,
        end,
        startTime: TIME.test(time) && start === end ? time : null,
        kind: feed.kind,
        color: feed.color,
        installId: runtime.install.install.id,
        taconName: runtime.install.tacon.name,
        href: feed.openApp
          ? `/t/${runtime.install.install.id}/app?record=${encodeURIComponent(String(row.id))}`
          : feed.openRecord
          ? recordHref(runtime, row.id, { calendar: index })
          : feed.open
            ? `/t/${runtime.install.install.id}/${feed.open}`
            : null,
      });
    }
  }
  return out;
}

export async function renderPanel(runtime: Runtime, panel: PanelDef): Promise<TaconPanelView> {
  const widgets = await renderWidgets(runtime, panel.widgets, { panel: panel.host });
  return {
    installId: runtime.install.install.id,
    taconName: runtime.install.tacon.name,
    title: panel.title,
    icon: runtime.install.manifest.icon,
    widgets,
    people: peopleList(runtime),
  };
}

/** A position holder's desk, for the Positions page. Only called for holders. */
export async function renderDesk(
  runtime: Runtime,
  def: PositionDef,
  positionId: number,
  title: string,
): Promise<TaconDeskView> {
  const widgets = await renderWidgets(runtime, def.widgets, { position: def.name });
  return {
    installId: runtime.install.install.id,
    taconName: runtime.install.tacon.name,
    position: def.name,
    positionId,
    title,
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
  if (storeName.startsWith("__")) {
    return { ok: false, error: "Built-in records can only be changed through their own widget." };
  }
  const store = storeDef(runtime.install.manifest, storeName);
  if (!store) return { ok: false, error: `This Tac-On has no store called "${storeName}".` };

  const data: Record<string, unknown> = {};
  for (const field of store.fields) {
    const raw = values[field.name];

    // A `choice from` field holds the id of a row it offered. Someone filling
    // in a form may only pick what the form showed them; a Tac-On's own
    // `add` may pick any row of that store.
    if (field.from) {
      const picked = raw === null || raw === undefined || String(raw).trim() === "" ? "" : String(raw).trim();
      if (!picked) {
        if (field.required) return { ok: false, error: `"${field.label}" is needed.` };
        data[field.name] = "";
        continue;
      }
      const offered =
        actor.type === "user"
          ? (await choicesFor(runtime, field)).map((choice) => choice.value)
          : (await loadRows(runtime, field.from.store)).map((row) => String(row.id));
      if (!offered.includes(picked)) {
        return { ok: false, error: `"${field.label}" has to be one of the choices offered.` };
      }
      data[field.name] = Number(picked);
      continue;
    }

    const clean = coerce(raw, field.type);
    if (field.required && (clean === null || clean === "" || clean === undefined)) {
      return { ok: false, error: `"${field.label}" is needed.` };
    }
    // A required checkbox is a promise ("I saw the proof"), so it has to be ticked.
    if (field.required && field.type === "boolean" && clean !== true) {
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

      // An earlier `add` clears the named values, and a button starts with
      // none, so they're worked out again before `{my.week}` is filled in.
      await preloadForExprList(runtime, [action.text]);
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

/**
 * What a form submission writes: the fields it asked for, as sent, and the
 * fields it `set`s, worked out here for the person submitting. Anything else
 * the browser sent is dropped - a form is a contract about what gets written.
 */
export async function formValues(
  runtime: Runtime,
  form: FormWidget,
  sent: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const values: Record<string, unknown> = {};
  for (const field of form.fields) values[field.field] = sent[field.field];
  const sets = form.sets ?? [];
  if (sets.length > 0) {
    await preloadForExprList(runtime, sets.map((entry) => entry.value));
    // The answers so far are the row being made, so `set block
    // finished.assignment.block` can read the assignment that was picked.
    // Loading the form's own store also loads the stores its choices point into.
    await loadRows(runtime, [form.into]);
    const answers: Row = { ...values };
    for (const entry of sets) {
      const value = evaluate(entry.value, { ...contextFor(runtime), row: answers, rowAliases: [form.into, "row", "it"] });
      values[entry.field] = value;
      answers[entry.field] = value;
    }
  }
  return values;
}

async function preloadForExprList(runtime: Runtime, exprs: Expr[]): Promise<void> {
  for (const expr of exprs) await preloadForExpr(runtime, expr, []);
  await resolveComputes(runtime);
}
