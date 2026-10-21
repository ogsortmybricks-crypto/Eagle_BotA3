/**
 * What a rendered Tac-On page looks like on the wire.
 *
 * The server evaluates every expression and hands the client a finished view:
 * strings to print, rows to lay out, fields to ask for. The browser never sees
 * a manifest and never evaluates anything, which is what keeps "installing a
 * Tac-On" from meaning "running a stranger's code in my browser".
 */

import type { FieldType } from "./types";
import type { ViewExtension } from "./extensions";

/**
 * `link` is the "Open" column, pointing at a read-only page for the row;
 * `progress` draws `row.progress` as a bar.
 */
export type ViewColumn = { key: string; label: string; type: FieldType | "text" | "link" | "progress" };

export type ViewRow = {
  id: number | string;
  cells: Record<string, string>;
  /** Only true when the list said this person may remove this row. */
  canRemove: boolean;
  /** The app path of the row's own page, for a `link` column. */
  link?: string | null;
  /** The folder names this row sits in, outermost first, for a grouped list. */
  groups?: string[];
  /** For a `progress` column: how far along this row is. */
  progress?: { value: number; goal: number };
  /** The numbers behind the `total` columns, so a folder can add up its own rows. */
  numbers?: Record<string, number>;
};

export type ViewNote = { kind: "note"; text: string; tone: "plain" | "info" | "warning" };
export type ViewHeading = { kind: "heading"; text: string };
export type ViewDivider = { kind: "divider" };
export type ViewStat = { kind: "stat"; label: string; value: string; hint: string | null };

export type ViewList = {
  kind: "list";
  title: string | null;
  columns: ViewColumn[];
  rows: ViewRow[];
  empty: string;
  /** Present for the Tac-On's own stores, absent for base-app lists. */
  store: string | null;
  /** Set when a list couldn't be read, e.g. the Tac-On lost a permission. */
  problem: string | null;
  /** How many levels of folders `rows[].groups` holds. Absent for a flat list. */
  groupDepth?: number;
  /** Columns added up on each folder's header and under the table. */
  totals?: string[];
};

/** One option of a `choice from` field: the row's id, shown as one of its fields. */
export type ViewChoice = { value: string; label: string };

export type ViewFormField = {
  name: string;
  label: string;
  type: FieldType;
  options: string[];
  required: boolean;
  /** Present for a `choice from` field: the rows to pick from, worked out for this viewer. */
  choices?: ViewChoice[];
};

export type ViewForm = {
  kind: "form";
  /** Where this widget sits on the page - how a submission finds it again. */
  index: number;
  title: string;
  submitLabel: string;
  fields: ViewFormField[];
  allowed: boolean;
  /** Why the form is read-only, in words worth showing. */
  deniedReason: string | null;
  /** Asked before saving, when set. */
  confirm?: string | null;
  /** The person types their six-digit confirmation code to save. */
  confirmCode?: boolean;
};

/** Confetti and a message. `key` is what "already celebrated" is remembered by. */
export type ViewCelebrate = { kind: "celebrate"; key: string; text: string };

export type ViewProgress = {
  kind: "progress";
  label: string;
  value: number;
  goal: number;
  /** "2 of 3", ready to print. */
  text: string;
  hint: string | null;
};

export type ViewButton = {
  kind: "button";
  index: number;
  label: string;
  confirm: string | null;
  allowed: boolean;
};

export type ViewWidget =
  | ViewNote
  | ViewHeading
  | ViewDivider
  | ViewStat
  | ViewList
  | ViewForm
  | ViewButton
  | ViewCelebrate
  | ViewProgress
  | ViewExtension
  | import("./programs").ViewProgram;

export type ViewPerson = { id: number; name: string };

export type TaconView = {
  canConfigure?: boolean;
  install: {
    id: number;
    slug: string;
    name: string;
    icon: string;
    version: string;
    studioName: string | null;
    official: boolean;
    authorName: string;
  };
  page: { name: string; title: string; subtitle: string | null; icon: string };
  /**
   * The Tac-On's sidebar pages this viewer may open, in the order the source
   * declares them - the tabs across the top. Includes this page when it is
   * one of them. Absent on views from before tabs existed.
   */
  pages?: { name: string; title: string }[];
  widgets: ViewWidget[];
  /** Everyone a `person` field can point at. Sent once, used by every field. */
  people: ViewPerson[];
};

export type TaconPanelView = {
  canConfigure?: boolean;
  installId: number;
  taconName: string;
  title: string;
  icon: string;
  widgets: ViewWidget[];
  people: ViewPerson[];
};

/** What a Tac-On shows the holder of one of its positions, on the Positions page. */
export type TaconDeskView = {
  canConfigure?: boolean;
  installId: number;
  taconName: string;
  /** The position's name in the Tac-On's source - how a submission finds it. */
  position: string;
  /** The row on the Positions page this desk belongs to. */
  positionId: number;
  title: string;
  widgets: ViewWidget[];
  people: ViewPerson[];
};

/**
 * One record on its own read-only page - what a list's `link` column and a
 * calendar's `open record` open. Only the fields the author chose are sent.
 */
export type TaconRecordView = {
  install: TaconView["install"];
  title: string;
  fields: { key: string; label: string; type: FieldType | "text"; value: string }[];
  /** Where it was opened from, for the "Back" link. Null when that isn't a page. */
  back: { label: string; href: string } | null;
};

/** The sidebar entry an installed Tac-On contributes. */
export type TaconNavEntry = {
  installId: number;
  page: string;
  label: string;
  icon: string;
  taconName: string;
  studioName: string | null;
};
