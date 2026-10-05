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

export type MarketProduct = {
  id: number;
  name: string;
  description: string;
  pricePoints: number;
  active: boolean;
};
export type MarketEntry = {
  id: number;
  learnerId: number;
  learnerName: string;
  points: number;
  reason: string;
  kind: "earn" | "purchase";
  createdAt: string;
  actorName: string;
};
export type MarketPurchase = {
  id: number;
  learnerId: number;
  learnerName: string;
  productName: string;
  pricePoints: number;
  status: "pending" | "fulfilled";
  createdAt: string;
  fulfilledAt: string | null;
};
export type ViewMarket = {
  kind: "market";
  index: number;
  market: string;
  title: string;
  rate: number;
  cap: number;
  balancePoints: number;
  overdraft: boolean;
  canPurchase: boolean;
  canLogPoints: boolean;
  canAwardPoints: boolean;
  canManage: boolean;
  canViewLogs: boolean;
  products: MarketProduct[];
  entries: MarketEntry[];
  purchases: MarketPurchase[];
  /** Personal history is windowed independently from the management logs. */
  ownEntries: MarketEntry[];
  ownPurchases: MarketPurchase[];
  learners: { id: number; name: string; balancePoints: number }[];
};

export type PartnerPerson = { id: number; name: string };
export type PartnerCandidate = PartnerPerson & { role: string };
export type PartnerGroup = {
  id: number;
  members: PartnerPerson[];
  active: boolean;
  startedAt: string;
  endedAt: string | null;
};
export type PartnerCoreEntry = { subject: string; goal: string; progress: string; percent: number | null };
export type PartnerEvidenceEntry = { subject: string; notes: string; shots: number[] };
export type PartnerCheckin = {
  id: number;
  groupId: number;
  /** The day it happened, on the checker's calendar. */
  date: string;
  checkerId: number;
  checkerName: string;
  targetId: number;
  targetName: string;
  core: PartnerCoreEntry[];
  evidence: PartnerEvidenceEntry[];
  onTrack: "on-track" | "slightly-behind" | "off-track";
  notes: string;
  updatedAt: string;
};
export type PartnerGoals = { personId: number; week: string; goals: Record<string, string>; updatedAt: string };
/** One thing to do this week in one category. */
export type PartnerAssignment = { id: number; week: string; category: string; title: string; details: string };
/**
 * One person's work on one assignment. They submit it; their AP looks at it
 * and either confirms it (signing with their six-digit code) or sends it back.
 */
export type PartnerCompletion = {
  id: number;
  assignmentId: number;
  personId: number;
  personName: string;
  groupId: number;
  status: "submitted" | "returned" | "confirmed";
  /** The person's own note on what they did. */
  notes: string;
  shots: number[];
  submittedAt: string;
  /** Why the AP sent it back, when they did. */
  returnNote: string;
  confirmerId: number | null;
  confirmerName: string | null;
  confirmedAt: string | null;
  excellence: boolean;
  /** The AP's notes, added once it's confirmed. */
  apNotes: string;
  /** The public verification path, for Excellence only. Null once revoked. */
  link: string | null;
  /** What the assignment said when it was submitted, in case it's edited later. */
  title: string;
  category: string;
  week: string;
};
export type PartnerMilestone = { id: number; personId: number; title: string; achievedOn: string | null; createdAt: string };
export type PartnerAttendance = { userId: number; days: number[]; absences: { day: string; kind: "sick" | "other"; note: string | null }[] };

export type ViewPartners = {
  kind: "partners";
  index: number;
  partners: string;
  title: string;
  core: string[];
  evidence: string[];
  required: number;
  due: number | null;
  trios: boolean;
  /** The viewer, if they can take part at all. */
  me: PartnerPerson | null;
  /** The viewer's current group. */
  group: PartnerGroup | null;
  /** Recent check-ins the viewer may read: their own group's, or everyone's for a manager. */
  checkins: PartnerCheckin[];
  goals: PartnerGoals[];
  /** Evidence subjects plus the admin's own categories, in order. */
  categories: string[];
  /** Categories an admin added, which can be removed again. */
  customCategories: { id: number; name: string }[];
  assignments: PartnerAssignment[];
  /** The viewer's group's, or everyone's for a manager. */
  completions: PartnerCompletion[];
  milestones: PartnerMilestone[];
  /** For the viewer and their partners (everyone paired, for a manager). */
  attendance: PartnerAttendance[];
  /** Whether the viewer has set their six-digit code yet. */
  codeSet: boolean;
  /** Present only for people who may set the pairings. */
  manage: null | {
    /** Learners, secretaries and learner admins. Guides and staff admins never. */
    candidates: PartnerCandidate[];
    groups: PartnerGroup[];
  };
};

export type ViewWidget =
  | ViewNote
  | ViewHeading
  | ViewDivider
  | ViewStat
  | ViewList
  | ViewForm
  | ViewButton
  | ViewMarket
  | ViewPartners;

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

/** What a Tac-On shows the holder of one of its positions, on the Positions page. */
export type TaconDeskView = {
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

/** The sidebar entry an installed Tac-On contributes. */
export type TaconNavEntry = {
  installId: number;
  page: string;
  label: string;
  icon: string;
  taconName: string;
  studioName: string | null;
};
