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
