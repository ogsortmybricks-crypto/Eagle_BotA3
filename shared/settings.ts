import { z } from "zod";
import { ROLES } from "./schema";

/**
 * Everything an academy can tune about how Eagle Bot behaves.
 *
 * These live in a single JSONB column rather than thirty columns because the
 * list will keep growing and an academy changing its quorum rule should not
 * need a migration. Every field here is read somewhere that actually changes
 * behaviour - there are no decorative toggles.
 *
 * A studio can override a handful of these (see `studioOverridesSchema`); the
 * rest are academy-wide because they describe the tool, not the studio.
 */

export const QUORUM_MODES = ["none", "majority", "two_thirds", "fixed"] as const;
export type QuorumMode = (typeof QUORUM_MODES)[number];

export const governanceSchema = z.object({
  /** Adults are observers by default. Acton studios govern themselves. */
  guidesCanVote: z.boolean().default(false),
  /** An admin in the Staff studio voting in a Middle Studio election. */
  adminsVoteInAllStudios: z.boolean().default(false),
  guidesSeeAllStudios: z.boolean().default(true),
  learnersSeeAllStudios: z.boolean().default(false),
  /** Turns on wiki.edit for learners. Off means only admins and secretaries edit. */
  learnersCanEditWiki: z.boolean().default(false),
  secretariesCanManageElections: z.boolean().default(true),
  /** Every wiki edit must say why. The history is the product here. */
  requireRationaleOnEdits: z.boolean().default(true),
  /** Only members of a studio can hold or run for that studio's positions. */
  restrictCandidatesToStudio: z.boolean().default(true),
});

export const electionsSchema = z.object({
  defaultDurationDays: z.number().int().min(1).max(60).default(7),
  /** How many options a ballot needs before it can open. */
  minOptions: z.number().int().min(2).max(10).default(2),
  selfNominationDefault: z.boolean().default(true),
  anonymousDefault: z.boolean().default(true),
  allowVoteChanges: z.boolean().default(true),
  /** Off keeps the tally hidden until voting closes, which is the honest default. */
  showLiveTallies: z.boolean().default(false),
  /** Share of eligible voters who must vote before a result can be certified. 0 = no rule. */
  quorumPercent: z.number().int().min(0).max(100).default(0),
  autoCloseOnDeadline: z.boolean().default(true),
});

export const townHallSchema = z.object({
  carryOverActionItems: z.boolean().default(true),
  quorumMode: z.enum(QUORUM_MODES).default("two_thirds"),
  quorumFixed: z.number().int().min(1).max(500).default(10),
  guidesCountTowardQuorum: z.boolean().default(false),
  requireQuorumToProcess: z.boolean().default(false),
  /** {date} and {studio} are substituted when a meeting is created. */
  titleTemplate: z.string().max(120).default("Town Hall \u2014 {date}"),
  /** Once the AI has folded a meeting into the wiki, freeze the notes. */
  lockAfterProcessing: z.boolean().default(false),
});

export const aiSchema = z.object({
  enabled: z.boolean().default(true),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).default("high"),
  maxOutputTokens: z.number().int().min(4000).max(64000).default(32000),
  /** The AI striking out rules a decision contradicts - the whole point of the tool. */
  autoRepealContradictions: z.boolean().default(true),
  proposeElections: z.boolean().default(true),
  detectPositions: z.boolean().default(true),
  /** Appended to every system prompt. House style, local vocabulary, gotchas. */
  extraGuidance: z.string().max(4000).default(""),
});

export const notificationsSchema = z.object({
  emailOnElectionOpen: z.boolean().default(true),
  emailOnElectionCertified: z.boolean().default(false),
  emailOnMeetingProcessed: z.boolean().default(false),
  inviteExpiryDays: z.number().int().min(1).max(90).default(14),
});

export const accessSchema = z.object({
  minPasswordLength: z.number().int().min(8).max(64).default(8),
  defaultInviteRole: z.enum(ROLES).default("learner"),
  /** Off means only admins edit profiles - useful in a Spark studio. */
  allowProfileEditing: z.boolean().default(true),
  showEmailsInDirectory: z.boolean().default(false),
});

export const displaySchema = z.object({
  dateFormat: z.enum(["local", "iso", "us", "uk"]).default("local"),
  startPage: z.enum(["wiki", "town-hall", "elections", "positions", "people"]).default("wiki"),
  density: z.enum(["comfortable", "compact"]).default("comfortable"),
});

/** Every section, keyed the way the settings page and the PATCH route address them. */
export const SETTINGS_SECTIONS = {
  governance: governanceSchema,
  elections: electionsSchema,
  townHall: townHallSchema,
  ai: aiSchema,
  notifications: notificationsSchema,
  access: accessSchema,
  display: displaySchema,
} as const;

export type SettingsSection = keyof typeof SETTINGS_SECTIONS;

export const academySettingsSchema = z.object({
  governance: governanceSchema.default({}),
  elections: electionsSchema.default({}),
  townHall: townHallSchema.default({}),
  ai: aiSchema.default({}),
  notifications: notificationsSchema.default({}),
  access: accessSchema.default({}),
  display: displaySchema.default({}),
});

export type AcademySettings = z.infer<typeof academySettingsSchema>;

export const DEFAULT_SETTINGS: AcademySettings = academySettingsSchema.parse({});

/** Merges stored settings over the defaults, tolerating anything stale or missing. */
export function resolveSettings(stored: unknown): AcademySettings {
  const parsed = academySettingsSchema.safeParse(stored ?? {});
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

/* -------------------------------------------------------------------------- */
/*  Studio-level overrides                                                     */
/* -------------------------------------------------------------------------- */

/** "inherit" defers to the academy. Tri-state so a studio can also turn a thing off. */
const tri = z.enum(["inherit", "yes", "no"]).default("inherit");

export const studioOverridesSchema = z.object({
  guidesCanVote: tri,
  selfNomination: tri,
  quorumMode: z.enum(["inherit", ...QUORUM_MODES]).default("inherit"),
  quorumFixed: z.number().int().min(1).max(500).default(10),
  /** 0 means inherit the academy's default election length. */
  electionDurationDays: z.number().int().min(0).max(60).default(0),
  /** Extra prompt guidance for this studio only - a Spark studio reads differently. */
  aiGuidance: z.string().max(2000).default(""),
});

export type StudioOverrides = z.infer<typeof studioOverridesSchema>;

export const DEFAULT_STUDIO_OVERRIDES: StudioOverrides = studioOverridesSchema.parse({});

export function resolveOverrides(stored: unknown): StudioOverrides {
  const parsed = studioOverridesSchema.safeParse(stored ?? {});
  return parsed.success ? parsed.data : DEFAULT_STUDIO_OVERRIDES;
}

/** The settings that actually apply inside one studio. */
export type EffectiveSettings = {
  guidesCanVote: boolean;
  selfNomination: boolean;
  quorumMode: QuorumMode;
  quorumFixed: number;
  electionDurationDays: number;
  aiGuidance: string;
};

export function effectiveFor(
  settings: AcademySettings,
  overrides: StudioOverrides | null,
): EffectiveSettings {
  const o = overrides ?? DEFAULT_STUDIO_OVERRIDES;
  const pick = (value: "inherit" | "yes" | "no", fallback: boolean) =>
    value === "inherit" ? fallback : value === "yes";

  return {
    guidesCanVote: pick(o.guidesCanVote, settings.governance.guidesCanVote),
    selfNomination: pick(o.selfNomination, settings.elections.selfNominationDefault),
    quorumMode: o.quorumMode === "inherit" ? settings.townHall.quorumMode : o.quorumMode,
    quorumFixed: o.quorumMode === "inherit" ? settings.townHall.quorumFixed : o.quorumFixed,
    electionDurationDays:
      o.electionDurationDays > 0 ? o.electionDurationDays : settings.elections.defaultDurationDays,
    aiGuidance: [settings.ai.extraGuidance, o.aiGuidance].filter((part) => part.trim()).join("\n\n"),
  };
}

/** How many people have to be in the room for the meeting to count. */
export function quorumThreshold(mode: QuorumMode, fixed: number, eligible: number): number {
  switch (mode) {
    case "none":
      return 0;
    case "majority":
      return Math.floor(eligible / 2) + 1;
    case "two_thirds":
      return Math.ceil(eligible * (2 / 3));
    case "fixed":
      return Math.min(fixed, eligible);
  }
}
