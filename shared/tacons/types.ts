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

export const AGGREGATES = ["sum", "count", "average", "highest", "lowest", "any"] as const;
export type Aggregate = (typeof AGGREGATES)[number];

/** Aggregates that count rows rather than read a field: `count of entry`, `any of entry`. */
export const ROW_AGGREGATES: readonly Aggregate[] = ["count", "any"];

/** `sum of entry.amount where entry.kind is "earn"`. */
export type AggregateExpr = {
  kind: "aggregate";
  fn: Aggregate;
  /** The store being counted over - may be `alias.store` for another Tac-On. */
  source: string[];
  /** The field being summed. Absent for `count of` and `any of`. */
  field: string | null;
  where: Condition | null;
};

export const BINARY_OPS = ["plus", "minus", "times", "divided"] as const;
export type BinaryOp = (typeof BINARY_OPS)[number];

export type BinaryExpr = { kind: "binary"; op: BinaryOp; left: Expr; right: Expr };

/** `"You have {my.balance} bucks"` - literal chunks and embedded expressions. */
export type TemplateExpr = { kind: "template"; parts: (string | Expr)[] };

/** `max of 0 and setting.goal minus my.done` - the larger (or smaller) of two values. */
export type PickExpr = { kind: "pick"; fn: "min" | "max"; left: Expr; right: Expr };

/** `if my.done above 2 then "Yes" else "Not yet"`. */
export type IfExpr = { kind: "if"; when: Condition; then: Expr; otherwise: Expr };

/** `name of ap_call.partner` - a person id, as the person's name. */
export type NameExpr = { kind: "name"; of: Expr };

export type Expr =
  | PathExpr
  | LiteralExpr
  | AggregateExpr
  | BinaryExpr
  | TemplateExpr
  | PickExpr
  | IfExpr
  | NameExpr;

/**
 * Words that read the clock rather than a store, worked out in the academy's
 * time zone: `today` and `this_week_start` are days ("2026-10-12"),
 * `session_start` is the first day of the session running now (or empty), and
 * `weekday` is today's name ("Monday").
 */
export const CLOCK_WORDS = ["today", "this_week_start", "session_start", "weekday"] as const;
export type ClockWord = (typeof CLOCK_WORDS)[number];

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
  /**
   * A `choice from` field: its options are rows of a store, shown by one of
   * their fields and saved as the row's `id`. Absent on fixed choices.
   */
  from?: ChoiceSource;
};

/** `field assignment choice from assignment.title where assignment.week is my.week`. */
export type ChoiceSource = {
  /** `["assignment"]`, or `["alias", "store"]` for a `use`d Tac-On's store. */
  store: string[];
  /** The field each option is shown as. */
  field: string;
  where: Condition | null;
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
  "calendar",
  "calendar.sessions",
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
  calendar: ["title", "kind", "starts", "ends", "time", "location", "quest", "description", "studio"],
  "calendar.sessions": ["title", "quest", "starts", "ends", "weeks", "status", "studio"],
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
  calendar: "calendar.read",
  "calendar.sessions": "calendar.read",
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
  /** Set when the label has `{...}` in it; `label` is then the raw text. */
  labelTemplate?: Expr;
  value: Expr;
  hint: Expr | null;
};

/**
 * `link` in a list's columns: an "Open" link to a read-only page for that one
 * row. Not a field, so it never clashes with one.
 */
export const LINK_COLUMN = "link";

/** Ways a list can fold its rows into folders, by a date field or `created`. */
export const DATE_PARTS = ["year", "month", "week", "day"] as const;
export type DatePart = (typeof DATE_PARTS)[number];

/** One level of a `group by`: a field, optionally cut down to part of a date. */
export type GroupLevel = { field: string; part: DatePart | null };

export type ListWidget = {
  kind: "list";
  title: string | null;
  /** Set when the title has `{...}` in it. */
  titleTemplate?: Expr;
  source: ListSource;
  columns: string[];
  where: Condition | null;
  sort: "newest" | "oldest" | "az";
  limit: number;
  empty: string;
  /** Roles that may delete any row this list shows. Empty means nobody, through this list. */
  allowRemove: string[];
  /** `allow remove own`: anyone who can see the list may delete rows they saved. */
  removeOwn?: boolean;
  /** `group by ...`: nested, collapsible folders. Absent or empty means a flat table. */
  groupBy?: GroupLevel[];
  /**
   * `link anyone`: a row's link opens for anyone signed in to this academy,
   * not only for people who can see this list.
   */
  linkAnyone?: boolean;
};

/** `set day weekday` inside a form: a value worked out on the server, never asked. */
export type FormSet = { field: string; value: Expr };

export type FormField = { field: string; label: string | null };

export type FormWidget = {
  kind: "form";
  title: string;
  /** The store rows land in. */
  into: string;
  fields: FormField[];
  /** Fields the form fills in itself. Absent on older manifests. */
  sets?: FormSet[];
  /** Roles allowed to submit. Empty means everyone who can see the page. */
  allow: string[];
  submitLabel: string;
  /** "Are you sure?" before saving. */
  confirm?: string | null;
  /** `confirm with code`: the person's own six-digit confirmation code is checked before saving. */
  confirmCode?: boolean;
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

/** `celebrate "You did it!"` - confetti and a message, once per person. */
export type CelebrateWidget = { kind: "celebrate"; text: Expr };

/** `progress "Calls this week" my.days_called of setting.calls_needed`. */
export type ProgressWidget = {
  kind: "progress";
  label: string;
  labelTemplate?: Expr;
  value: Expr;
  goal: Expr;
  hint: Expr | null;
};

/** `show if <condition>` on any widget: it is only drawn while the test passes. */
export type Visibility = { showIf?: Condition | null };

export type Widget = (
  | NoteWidget
  | HeadingWidget
  | DividerWidget
  | StatWidget
  | ListWidget
  | FormWidget
  | ButtonWidget
  | CelebrateWidget
  | ProgressWidget
  | import("./extensions").ExtensionWidget
) &
  Visibility;

/* -------------------------------------------------------------------------- */
/*  Pages, panels, hooks, computed values                                      */
/* -------------------------------------------------------------------------- */

export type PageDef = {
  name: string;
  title: string;
  /** Set when the title has `{...}` in it, worked out for each viewer. */
  titleTemplate?: Expr;
  icon: string;
  /** Put it in the sidebar. A page that isn't in the nav is still reachable. */
  nav: boolean;
  subtitle: string | null;
  /** Roles that may open it. Empty means everyone in the academy. */
  showTo: string[];
  widgets: Widget[];
};

/** Base pages a Tac-On can attach a small card to. */
export const PANEL_HOSTS = ["wiki", "town-hall", "elections", "positions", "people", "admin", "calendar"] as const;
export type PanelHost = (typeof PANEL_HOSTS)[number];

export type PanelDef = {
  host: PanelHost;
  title: string;
  showTo: string[];
  widgets: Widget[];
};

/**
 * A position the Tac-On adds to the academy's Positions page.
 *
 * Installing the Tac-On creates a real position - elected or appointed like any
 * other, with the same seats and history - and the Tac-On gets to decide what
 * whoever holds it sees: the widgets in the block are that person's desk, and
 * the position's name works as an audience anywhere a role does.
 */
export type PositionDef = {
  name: string;
  title: string;
  about: string | null;
  duties: string[];
  seats: number;
  term: string | null;
  elected: boolean;
  /** The holder's desk, shown on the Positions page to whoever holds it now. */
  widgets: Widget[];
};

/**
 * How a position is written inside an audience list. Role names and position
 * names share one vocabulary in TacScript (`allow admin, treasurer`), so the
 * compiled form marks which is which.
 */
export const POSITION_AUDIENCE = "position:";

export function positionAudience(name: string): string {
  return `${POSITION_AUDIENCE}${name}`;
}

/** The position name in an audience entry, or null for a role. */
export function audiencePosition(entry: string): string | null {
  return entry.startsWith(POSITION_AUDIENCE) ? entry.slice(POSITION_AUDIENCE.length) : null;
}

/**
 * A position the studio already has, named by its title: `show to position
 * "Town Hall Leader"`. Matched without regard to case against the positions
 * of the studio the Tac-On is installed in (its group's shared ones, and
 * academy-wide ones), so whoever holds that seat right now is in the audience.
 */
export const STUDIO_POSITION_AUDIENCE = "studio-position:";

export function studioPositionAudience(title: string): string {
  return `${STUDIO_POSITION_AUDIENCE}${title.trim().toLowerCase()}`;
}

/** The lower-cased title in a studio-position audience entry, or null. */
export function audienceStudioPosition(entry: string): string | null {
  return entry.startsWith(STUDIO_POSITION_AUDIENCE) ? entry.slice(STUDIO_POSITION_AUDIENCE.length) : null;
}

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
  "calendar.event.created",
  "calendar.event.updated",
  "calendar.event.removed",
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

/**
 * What kind a Tac-On's calendar entries are drawn as. Sessions and breaks are
 * left out: those pace the whole studio, and only guides set them.
 */
export const CALENDAR_FEED_KINDS = ["event", "field_trip", "exhibition", "launch", "deadline"] as const;
export type CalendarFeedKind = (typeof CALENDAR_FEED_KINDS)[number];

/**
 * A Tac-On putting its own records on the studio calendar.
 *
 *     calendar trip {
 *       title "{trip.place}"
 *       on trip.day
 *       until trip.back
 *       kind field_trip
 *     }
 *
 * Each row with a date becomes an entry. The entries are read-only on the
 * calendar - they belong to the Tac-On - and open the Tac-On's page if it
 * names one with `open`.
 */
export type CalendarFeedDef = {
  /** `["trip"]` for our own store, `["alias", "store"]` for a `use`d one. */
  store: string[];
  title: Expr;
  /** The date field each entry starts on. `created` works too. */
  on: string;
  /** An optional date field it ends on, inclusive. */
  until: string | null;
  /** An optional text field holding a start time, "HH:MM". */
  at: string | null;
  kind: CalendarFeedKind;
  color: string | null;
  where: Condition | null;
  showTo: string[];
  /** A page of this Tac-On to open when the entry is clicked. */
  open: string | null;
  /**
   * `open record`: clicking the entry opens a read-only page for that one row,
   * showing these fields (every field of the store when the line lists none).
   * Takes the place of `open <page>`.
   */
  openRecord?: string[] | null;
};

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
  /** Absent on manifests published before positions existed. */
  positions: PositionDef[];
  hooks: HookDef[];
  computes: ComputeDef[];
  /** Absent on manifests published before the calendar existed. */
  calendars?: CalendarFeedDef[];
  /**
   * Titles of the studio's own positions this Tac-On names as an audience
   * (`show to position "Town Hall Leader"`), shown to the admin at install.
   * Absent on older manifests.
   */
  studioPositions?: string[];
  /** Absent on older manifests. */
  /** Package-owned configuration, compiled by trusted extensions. */
  extensions?: Record<string, unknown>;
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

/**
 * Roles a `show to` / `allow` clause accepts, plus the two shorthands. The
 * Tac-On's own positions are accepted too, by name.
 */
export const AUDIENCES = ["everyone", "admin", "guide", "secretary", "learner", "dev"] as const;
export type Audience = (typeof AUDIENCES)[number];
