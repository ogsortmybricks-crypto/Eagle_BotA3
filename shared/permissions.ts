import type { Role } from "./schema";

/**
 * Who can do what.
 *
 * The shape of this table is a deliberate reading of the Acton model: the
 * studio governs itself, so Guides are observers in the governance flow rather
 * than deciders. A Guide can see everything and can be given the admin role by
 * an academy that wants that, but the default is that adults do not edit the
 * Contract, do not certify elections, and do not vote.
 */
export const PERMISSIONS = {
  admin: [
    "academy.manage",
    "users.manage",
    "invites.send",
    "documents.upload",
    "wiki.read",
    "wiki.edit",
    "wiki.ai_build",
    "findings.resolve",
    "positions.manage",
    "positions.read",
    "meetings.read",
    "meetings.write",
    "meetings.process",
    "elections.read",
    "elections.manage",
    "elections.vote",
    "activity.read",
    "status.read",
  ],
  secretary: [
    "documents.upload",
    "wiki.read",
    "wiki.edit",
    "findings.resolve",
    "positions.read",
    "meetings.read",
    "meetings.write",
    "meetings.process",
    "elections.read",
    "elections.manage",
    "elections.vote",
    "status.read",
  ],
  guide: [
    "wiki.read",
    "positions.read",
    "meetings.read",
    "elections.read",
    "activity.read",
    "status.read",
  ],
  learner: ["wiki.read", "positions.read", "meetings.read", "elections.read", "elections.vote"],
} as const satisfies Record<Role, readonly string[]>;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS][number];

export function can(role: Role | undefined | null, permission: string): boolean {
  if (!role) return false;
  return (PERMISSIONS[role] as readonly string[]).includes(permission);
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  secretary: "Secretary",
  guide: "Guide",
  learner: "Learner",
};

export const ROLE_BLURBS: Record<Role, string> = {
  admin: "Runs the academy setup, invites people, resolves what the AI flags.",
  secretary: "Takes Town Hall notes and runs them through the AI into the wiki.",
  guide: "Reads everything, decides nothing. Governance belongs to the studio.",
  learner: "Reads the wiki, runs for positions, votes.",
};
