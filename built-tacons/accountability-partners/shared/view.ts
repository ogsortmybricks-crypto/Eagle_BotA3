import type { ApWorkspace } from "./workspace";

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
  workspace: ApWorkspace;
  /** The viewer, if they can take part at all. */
  me: PartnerPerson | null;
  /** The viewer's current group. */
  group: PartnerGroup | null;
  /** All groups this viewer may inspect, including past pairings. */
  historyGroups: PartnerGroup[];
  /** Recent check-ins the viewer may read: their own group's, or everyone's for a manager. */
  checkins: PartnerCheckin[];
  goals: PartnerGoals[];
  /** Present only for people who may set the pairings. */
  manage: null | {
    /** Learners, secretaries and learner admins. Guides and staff admins never. */
    candidates: PartnerCandidate[];
    groups: PartnerGroup[];
    /** Used to reject stale pairing saves instead of silently removing pairs. */
    revision: number[];
  };
};

