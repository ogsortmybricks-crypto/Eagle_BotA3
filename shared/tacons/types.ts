/**
 * The compiled shape of a Tac-On.
 *
 * A Tac-On is written in TacScript (see `parse.ts` and `compile.ts`) and stored
 * twice: the source a learner typed, and this manifest, which is what the app
 * actually runs. Keeping the compiled form in the database means a page render
 * never re-parses, and means a Tac-On that compiled yesterday keeps working
 * even if the compiler grows stricter tomorrow.
 *
 * Nothing in here is executable. A manifest describes *what* to show and *what*
 * to record - never how - so running a Tac-On is rendering data, not running
 * someone else's code. That is the whole safety story, and it is why the
 * language is deliberately small.
 */

/* -------------------------------------------------------------------------- */
/*  Expressions                                                                */
/* -------------------------------------------------------------------------- */

/** `entry.amount`, `me.id`, `event.actor`, `setting.rate`, `bucks.balance`. */
export type PathExpr = { kind: "path"; parts: string[] };
export type LiteralExpr = { kind: "literal"; value: string | number | boolean };

export const AGGREGATES = ["sum", "count", "average", "highest", "lowest"] as const;
export type Aggregate = (typeof AGGREGATES)[number];

/** `sum of entry.amount where entry.kind is "earn"`. */
export type AggregateExpr = {
  kind: "aggregate";
  fn: Aggregate;
  /** The store being counted over - may be `alias.store` for another Tac-On. */
  source: string[];
  /** The field being summed. Absent for `count of`. */
  field: string | null;
  where: Condition | null;
};

export const BINARY_OPS = ["plus", "minus", "times", "divided"] as const;
export type BinaryOp = (typeof BINARY_OPS)[number];

export type BinaryExpr = { kind: "binary"; op: BinaryOp; left: Expr; right: Expr };

/** `"You have {my.balance} bucks"` - literal chunks and embedded expressions. */
export type TemplateExpr = { kind: "template"; parts: (string | Expr)[] };

export type Expr = PathExpr | LiteralExpr | AggregateExpr | BinaryExpr | TemplateExpr;

export const COMPARATORS = ["is", "is not", "above", "below", "contains"] as const;
export type Comparator = (typeof COMPARATORS)[number];

export type Comparison = { left: Expr; op: Comparator; right: Expr };

/** Comparisons joined by `and`. There is no `or` - nobody has needed one yet. */
export type Condition = { all: Comparison[] };

/* -------------------------------------------------------------------------- */
/*  Stores                                                                     */
/* -------------------------------------------------------------------------- */

export const FIELD_TYPES = [
  "text",
  "longtext",
  "number",
  "boolean",
  "choice",
  "person",
  "date",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export type StoreField = {
  name: string;
  type: FieldType;
  label: string;
  /** Options for a `choice` field. */
  options: string[];
  required: boolean;
};

/**
 * A table of rows the Tac-On owns. Rows live in `tacon_records`, scoped to one
 * install, so uninstalling a Tac-On takes its data with it and no Tac-On can
 * ever read another academy's rows.
 */
export type StoreDef = {
  name: string;
  label: string;
  fields: StoreField[];
};

/* -------------------------------------------------------------------------- */
/*  Settings the installing admin fills in                                     */
/* -------------------------------------------------------------------------- */

export type SettingDef = {
  name: string;
  label: string;
  type: "text" | "number" | "boolean" | "choice";
  options: string[];
  default: string | number | boolean;
  hint: string | null;
};

/* -------------------------------------------------------------------------- */
/*  Widgets                                                                    */
/* -------------------------------------------------------------------------- */

/** Where a list reads its rows from: the Tac-On's own store, or the base app. */
export const BASE_SOURCES = [
  "wiki.rules",
  "wiki.sections",
  "positions",
  "elections",
  "meetings",
  "people",
  "activity",
] as const;
export type BaseSource = (typeof BASE_SOURCES)[number];

/**
 * The columns each base source hands back. A Tac-On lists them by name, so
 * this doubles as the vocabulary the compiler checks a `columns` line against
 * and the set of keys the server promises to fill in.
 */
export const BASE_COLUMNS: Record<BaseSource, string[]> = {
  "wiki.rules": ["title", "body", "status", "section", "studio", "updated"],
  "wiki.sections": ["title", "summary", "rules", "studio", "updated"],
  positions: ["title", "seats", "elected", "holders", "studio"],
  elections: ["title", "status", "type", "votes", "opens", "closes", "studio"],
  meetings: ["title", "date", "status", "items", "secretary", "studio"],
  people: ["name", "role", "studio", "nga", "positions"],
  activity: ["action", "summary", "actor", "when", "studio"],
};

/** Which base permission a source needs before a Tac-On may read it. */
export const SOURCE_PERMISSIONS: Record<BaseSource, string> = {
  "wiki.rules": "wiki.read",
  "wiki.sections": "wiki.read",
  positions: "positions.read",
  elections: "elections.read",
  meetings: "meetings.read",
  people: "wiki.read",
  activity: "activity.read",
};

export type ListSource =
  | { kind: "store"; store: string[] }
  | { kind: "base"; source: BaseSource };

export type NoteWidget = { kind: "note"; text: Expr; tone: "plain" | "info" | "warning" };
export type HeadingWidget = { kind: "heading"; text: Expr };
export type DividerWidget = { kind: "divider" };

export type StatWidget = {
  kind: "stat";
  label: string;
  value: Expr;
  hint: Expr | null;
};

export type ListWidget = {
  kind: "list";
  title: string | null;
  source: ListSource;
  columns: string[];
  where: Condition | null;
  sort: "newest" | "oldest" | "az";
  limit: number;
  empty: string;
  /** Roles that may delete a row. Empty means nobody, through this list. */
  allowRemove: string[];
};

export type FormField = { field: string; label: string | null };

export type FormWidget = {
  kind: "form";
  title: string;
  /** The store rows land in. */
  into: string;
  fields: FormField[];
  /** Roles allowed to submit. Empty means everyone who can see the page. */
  allow: string[];
  submitLabel: string;
  /** Extra actions to run after the row is written. */
  then: Action[];
};

export type ButtonWidget = {
  kind: "button";
  label: string;
  allow: string[];
  confirm: string | null;
  does: Action[];
};

export type Widget =
  | NoteWidget
  | HeadingWidget
  | DividerWidget
  | StatWidget
  | ListWidget
  | FormWidget
  | ButtonWidget;

/* -------------------------------------------------------------------------- */
/*  Pages, panels, hooks, computed values                                      */
/* -------------------------------------------------------------------------- */

export type PageDef = {
  name: string;
  title: string;
  icon: string;
  /** Put it in the sidebar. A page that isn't in the nav is still reachable. */
  nav: boolean;
  subtitle: string | null;
  /** Roles that may open it. Empty means everyone in the academy. */
  showTo: string[];
  widgets: Widget[];
};

/** Base pages a Tac-On can attach a small card to. */
export const PANEL_HOSTS = ["wiki", "town-hall", "elections", "positions", "people", "admin"] as const;
export type PanelHost = (typeof PANEL_HOSTS)[number];

export type PanelDef = {
  host: PanelHost;
  title: string;
  showTo: string[];
  widgets: Widget[];
};

/**
 * Events a Tac-On can react to. These are the activity-log verbs the base app
 * already writes, which is why the list reads like a summary of the product:
 * anything the academy considers worth recording, a Tac-On can hear.
 */
export const HOOK_EVENTS = [
  "townhall.created",
  "townhall.processed",
  "election.created",
  "election.nomination",
  "election.vote.cast",
  "election.closed",
  "election.certified",
  "wiki.built",
  "wiki.rule.created",
  "wiki.rule.amended",
  "wiki.rule.repealed",
  "position.created",
  "position.appointed",
  "position.term_ended",
  "document.uploaded",
  "invite.accepted",
  "auth.login",
] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export type AddAction = {
  kind: "add";
  store: string;
  values: { field: string; value: Expr }[];
};
export type NotifyAction = { kind: "notify"; text: Expr };

export type Action = AddAction | NotifyAction;

export type HookDef = {
  event: HookEvent;
  when: Condition | null;
  does: Action[];
};

/** A named value other parts of the Tac-On - or another Tac-On - can read. */
export type ComputeDef = {
  name: string;
  /** Evaluated per viewer, so `me.*` inside it means the person looking. */
  expr: Expr;
};

/* -------------------------------------------------------------------------- */
/*  The manifest                                                               */
/* -------------------------------------------------------------------------- */

export type UseDef = { slug: string; alias: string };

export type Manifest = {
  slug: string;
  name: string;
  version: string;
  about: string;
  icon: string;
  category: string;
  author: string | null;
  /** Base permissions the Tac-On reads with. Disclosure, never elevation. */
  needs: string[];
  /** Names this Tac-On lets other Tac-Ons read: store names and computed values. */
  provides: string[];
  uses: UseDef[];
  settings: SettingDef[];
  stores: StoreDef[];
  pages: PageDef[];
  panels: PanelDef[];
  hooks: HookDef[];
  computes: ComputeDef[];
};

/* -------------------------------------------------------------------------- */
/*  Diagnostics                                                                */
/* -------------------------------------------------------------------------- */

export type Diagnostic = {
  line: number;
  column: number;
  message: string;
  /** Warnings don't stop a Tac-On publishing; errors do. */
  severity: "error" | "warning";
};

export type CompileResult =
  | { ok: true; manifest: Manifest; diagnostics: Diagnostic[] }
  | { ok: false; manifest: null; diagnostics: Diagnostic[] };

/** Roles a `show to` / `allow` clause accepts, plus the two shorthands. */
export const AUDIENCES = ["everyone", "admin", "guide", "secretary", "learner", "dev"] as const;
export type Audience = (typeof AUDIENCES)[number];
