/**
 * What a rendered Tac-On page looks like on the wire.
 *
 * The server evaluates every expression and hands the client a finished view:
 * strings to print, rows to lay out, fields to ask for. The browser never sees
 * a manifest and never evaluates anything, which is what keeps "installing a
 * Tac-On" from meaning "running a stranger's code in my browser".
 */

import type { FieldType } from "./types";

export type ViewColumn = { key: string; label: string; type: FieldType | "text" };

export type ViewRow = {
  id: number | string;
  cells: Record<string, string>;
  /** Only true when the list said this person may remove rows. */
  canRemove: boolean;
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
};

export type ViewFormField = {
  name: string;
  label: string;
  type: FieldType;
  options: string[];
  required: boolean;
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
  | ViewButton;

export type ViewPerson = { id: number; name: string };

export type TaconView = {
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
  widgets: ViewWidget[];
  /** Everyone a `person` field can point at. Sent once, used by every field. */
  people: ViewPerson[];
};

export type TaconPanelView = {
  installId: number;
  taconName: string;
  title: string;
  icon: string;
  widgets: ViewWidget[];
  people: ViewPerson[];
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
