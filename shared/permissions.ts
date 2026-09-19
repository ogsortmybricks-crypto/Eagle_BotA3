import type { Role } from "./schema";
import type { AcademySettings } from "./settings";

/**
 * Who can do what.
 *
 * The shape of this table is a deliberate reading of the Acton model: the
 * studio governs itself, so Guides are observers in the governance flow rather
 * than deciders. A Guide can see everything and can be given the admin role by
 * an academy that wants that, but the default is that adults do not edit the
 * Contract, do not certify elections, and do not vote.
 *
 * The table is the baseline. A couple of entries move under academy settings -
 * see `effectivePermissions`, which is what every check actually runs against.
 */
export const PERMISSIONS = {
  admin: [
    "academy.manage",
    "settings.manage",
    "studios.manage",
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
    // The market is an admin's shelf: they decide what this academy runs.
    "tacons.use",
    "tacons.market",
    "tacons.install",
    "tacons.grant_dev",
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
    "tacons.use",
  ],
  guide: [
    "wiki.read",
    "positions.read",
    "meetings.read",
    "elections.read",
    "activity.read",
    "status.read",
    "tacons.use",
  ],
  learner: [
    "wiki.read",
    "positions.read",
    "meetings.read",
    "elections.read",
    "elections.vote",
    "tacons.use",
  ],
} as const satisfies Record<Role, readonly string[]>;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS][number];

/**
 * Things that follow the person rather than their role.
 *
 * Dev status is the only one so far: an admin grants it to a learner who is
 * ready to build Tac-Ons, and it has nothing to do with governance. A Hero with
 * dev status still votes like every other Hero and still cannot touch the
 * Contract - they can just write software.
 */
export type PermissionTraits = { devStatus?: boolean | null };

/**
 * The permissions a role actually has in this academy.
 *
 * Two of the role boundaries are genuinely contested between Actons - whether
 * learners edit the wiki directly, and whether a secretary can run elections -
 * so they are settings rather than something baked into the table above.
 */
export function effectivePermissions(
  role: Role | undefined | null,
  settings?: AcademySettings | null,
  traits?: PermissionTraits | null,
): string[] {
  if (!role) return [];
  const list = new Set<string>(PERMISSIONS[role] as readonly string[]);

  if (traits?.devStatus) {
    // A dev can write and publish Tac-Ons, and needs the market to see how
    // their own listing looks next to everyone else's.
    list.add("tacons.develop");
    list.add("tacons.market");
  }

  if (!settings) return [...list];

  if (role === "learner" && settings.governance.learnersCanEditWiki) {
    list.add("wiki.edit");
  }
  if (role === "secretary" && !settings.governance.secretariesCanManageElections) {
    list.delete("elections.manage");
  }
  return [...list];
}

export function can(
  role: Role | undefined | null,
  permission: string,
  settings?: AcademySettings | null,
  traits?: PermissionTraits | null,
): boolean {
  if (!role) return false;
  return effectivePermissions(role, settings, traits).includes(permission);
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
