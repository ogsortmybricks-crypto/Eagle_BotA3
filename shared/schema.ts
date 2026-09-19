import {
  pgTable,
  serial,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/* -------------------------------------------------------------------------- */
/*  Enum-ish string unions. Kept as text columns so a studio can add its own   */
/*  vocabulary later without a migration - Acton studios rename things.        */
/* -------------------------------------------------------------------------- */

export const ROLES = ["admin", "guide", "secretary", "learner"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Suggestions offered during setup, not a fixed list. Studios are rows in the
 * `studios` table because an academy might run two Middle Studios, might call
 * them after animals, and will certainly add one eventually.
 */
export const STUDIO_PRESETS = [
  {
    name: "Spark",
    ageRange: "4-7",
    color: "#f59e0b",
    description:
      "The youngest studio. Learners are finding their feet with self-governance, so rules stay short and concrete.",
  },
  {
    name: "Discovery",
    ageRange: "7-11",
    color: "#10b981",
    description:
      "Elementary studio. Learners take on real Town Halls and start holding each other accountable in earnest.",
  },
  {
    name: "Middle Studio",
    ageRange: "11-14",
    color: "#3b82f6",
    description:
      "Quests, Exhibitions and apprenticeships. Governance gets serious and the Contract gets long.",
  },
  {
    name: "Launchpad",
    ageRange: "14-18",
    color: "#8b5cf6",
    description:
      "The final studio. Academics finish early so learners can build toward a Next Great Adventure.",
  },
  {
    name: "Staff",
    ageRange: "Adults",
    color: "#64748b",
    description: "Guides and staff. Not a governing body - a place to keep adult-facing records.",
  },
] as const;

export const RULE_STATUSES = ["active", "proposed", "repealed"] as const;
export const FINDING_TYPES = ["contradiction", "gap", "ambiguity", "election_needed"] as const;
export const FINDING_STATUSES = ["open", "resolved", "dismissed"] as const;
export const MEETING_STATUSES = ["draft", "in_progress", "processing", "processed", "archived"] as const;
export const ELECTION_STATUSES = ["draft", "open", "closed", "certified", "cancelled"] as const;
export const JOB_STATUSES = ["queued", "running", "awaiting_input", "succeeded", "failed"] as const;

/* -------------------------------------------------------------------------- */
/*  Academy                                                                    */
/* -------------------------------------------------------------------------- */

export const academies = pgTable("academies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  /** e.g. "randomacton.com" - stored without the leading @. */
  emailDomain: text("email_domain").notNull(),
  logoUrl: text("logo_url"),
  /** { primary, accent, surface } as hex strings. */
  palette: jsonb("palette").$type<{ primary: string; accent: string; surface: string }>().notNull(),
  /** Guides deliberately do not vote by default - governance belongs to the heroes. */
  guidesCanVote: boolean("guides_can_vote").notNull().default(false),
  /** What this academy calls its learners: "Hero", "Eagle", "Explorer"... */
  learnerNoun: text("learner_noun").notNull().default("Hero"),
  /** Everything tunable. Shape lives in shared/settings.ts. */
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* -------------------------------------------------------------------------- */
/*  Studios                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A studio is the unit of self-governance at an Acton. Spark and Launchpad do
 * not share a Contract, do not elect the same people, and do not hold the same
 * Town Hall - so nearly everything else in this schema hangs off a studio.
 *
 * A null `studioId` on any of those tables means "academy-wide": visible in
 * every studio, which is how shared standards and staff-level positions are
 * recorded without duplicating them five times.
 */
export const studios = pgTable(
  "studios",
  {
    id: serial("id").primaryKey(),
    academyId: integer("academy_id").notNull().references(() => academies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /** What this studio is for, in the academy's own words. Shown in the switcher. */
    description: text("description"),
    /** Free text: "7-11", "Adults", "Ages 11 and up". */
    ageRange: text("age_range"),
    /** Hex, used to tint the studio throughout the app. */
    color: text("color").notNull().default("#3b82f6"),
    /** Overrides the academy's learner noun, if this studio says something else. */
    learnerNoun: text("learner_noun"),
    /**
     * Strips the app back for a studio of six-year-olds: big type, three places
     * to go, no provenance trail or editing chrome. Applies to the learners in
     * the studio - adults keep the full tool because they need it.
     */
    simpleMode: boolean("simple_mode").notNull().default(false),
    orderIndex: integer("order_index").notNull().default(0),
    archived: boolean("archived").notNull().default(false),
    /** Per-studio overrides. Shape lives in shared/settings.ts. */
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    academyIdx: index("studios_academy_idx").on(t.academyId),
    slugIdx: uniqueIndex("studios_slug_idx").on(t.academyId, t.slug),
  }),
);

/* -------------------------------------------------------------------------- */
/*  People                                                                     */
/* -------------------------------------------------------------------------- */

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    academyId: integer("academy_id").notNull().references(() => academies.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash"),
    role: text("role").$type<Role>().notNull().default("learner"),
    /** Which studio this person belongs to. Null means they have not been placed. */
    studioId: integer("studio_id").references(() => studios.id, { onDelete: "set null" }),
    bio: text("bio"),
    avatarUrl: text("avatar_url"),
    /** Free text, shown on the profile: "what I'm working toward". */
    nga: text("nga"),
    /**
     * Dev status, granted by an admin. It opens the dev menu - writing,
     * publishing and updating Tac-Ons - and creates the learner's global dev
     * profile, which is the part that travels beyond their own academy.
     */
    devStatus: boolean("dev_status").notNull().default(false),
    /** The handle their public dev profile lives at. Set when dev is granted. */
    devHandle: text("dev_handle"),
    devSince: timestamp("dev_since"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at"),
  },
  (t) => ({
    emailIdx: uniqueIndex("users_email_idx").on(t.email),
    academyIdx: index("users_academy_idx").on(t.academyId),
    studioIdx: index("users_studio_idx").on(t.studioId),
    handleIdx: uniqueIndex("users_dev_handle_idx").on(t.devHandle),
  }),
);

export const invites = pgTable(
  "invites",
  {
    id: serial("id").primaryKey(),
    academyId: integer("academy_id").notNull().references(() => academies.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    role: text("role").$type<Role>().notNull().default("learner"),
    studioId: integer("studio_id").references(() => studios.id, { onDelete: "set null" }),
    token: varchar("token", { length: 64 }).notNull(),
    invitedBy: integer("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    /** Null until an email actually goes out; holds the failure reason otherwise. */
    emailError: text("email_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    tokenIdx: uniqueIndex("invites_token_idx").on(t.token),
    emailIdx: index("invites_email_idx").on(t.email),
  }),
);

/* -------------------------------------------------------------------------- */
/*  Source documents                                                           */
/* -------------------------------------------------------------------------- */

export const documents = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    academyId: integer("academy_id").notNull().references(() => academies.id, { onDelete: "cascade" }),
    /** Null means the document describes the whole academy, not one studio. */
    studioId: integer("studio_id").references(() => studios.id, { onDelete: "set null" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    /** Extracted plain text. This is what the AI reads. */
    content: text("content").notNull(),
    uploadedBy: integer("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    /** pending | included | failed - "included" means it fed a wiki build. */
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    academyIdx: index("documents_academy_idx").on(t.academyId),
    studioIdx: index("documents_studio_idx").on(t.studioId),
  }),
);

/* -------------------------------------------------------------------------- */
/*  The wiki: sections hold rules, rules carry a full revision trail           */
/* -------------------------------------------------------------------------- */

export const wikiSections = pgTable(
  "wiki_sections",
  {
    id: serial("id").primaryKey(),
    academyId: integer("academy_id").notNull().references(() => academies.id, { onDelete: "cascade" }),
    /**
     * The studio whose Contract this section belongs to. Null is an academy-wide
     * section every studio sees. Rules inherit their studio from the section
     * they live in, so there is exactly one place a rule's studio is decided.
     */
    studioId: integer("studio_id").references(() => studios.id, { onDelete: "set null" }),
    /**
     * Other studios this section is shared into - a space two studios keep in
     * common without handing it to the whole academy. Middle and Launchpad
     * often share a Hero Bucks system Spark has nothing to do with. Ownership
     * stays with `studioId`; the studios listed here can read it.
     */
    sharedStudioIds: jsonb("shared_studio_ids").$type<number[]>().notNull().default([]),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    summary: text("summary"),
    orderIndex: integer("order_index").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    academyIdx: index("wiki_sections_academy_idx").on(t.academyId),
    studioIdx: index("wiki_sections_studio_idx").on(t.studioId),
    slugIdx: uniqueIndex("wiki_sections_slug_idx").on(t.academyId, t.slug),
  }),
);

export const wikiRules = pgTable(
  "wiki_rules",
  {
    id: serial("id").primaryKey(),
    academyId: integer("academy_id").notNull().references(() => academies.id, { onDelete: "cascade" }),
    sectionId: integer("section_id").notNull().references(() => wikiSections.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Markdown. */
    body: text("body").notNull(),
    status: text("status").notNull().default("active"),
    orderIndex: integer("order_index").notNull().default(0),
    /** document | town_hall | election | manual */
    sourceType: text("source_type").notNull().default("manual"),
    sourceRef: text("source_ref"),
    /** Where this came from, in the studio's own words. Shown as provenance. */
    citation: text("citation"),
    effectiveFrom: timestamp("effective_from"),
    repealedAt: timestamp("repealed_at"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    academyIdx: index("wiki_rules_academy_idx").on(t.academyId),
    sectionIdx: index("wiki_rules_section_idx").on(t.sectionId),
  }),
);

/**
 * Every change to a rule, human or AI, lands here with a rationale.
 * This is the answer to "what is current, and why?" - the whole reason the
 * tool exists instead of a Google Doc.
 */
export const wikiRevisions = pgTable(
  "wiki_revisions",
  {
    id: serial("id").primaryKey(),
    academyId: integer("academy_id").notNull().references(() => academies.id, { onDelete: "cascade" }),
    ruleId: integer("rule_id").references(() => wikiRules.id, { onDelete: "cascade" }),
    /** created | amended | repealed | moved | restored */
    changeType: text("change_type").notNull(),
    titleBefore: text("title_before"),
    titleAfter: text("title_after"),
    bodyBefore: text("body_before"),
    bodyAfter: text("body_after"),
    rationale: text("rationale"),
    actorUserId: integer("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    /** user | ai */
    actorType: text("actor_type").notNull().default("user"),
    sourceType: text("source_type"),
    sourceRef: text("source_ref"),
    jobId: integer("job_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    academyIdx: index("wiki_revisions_academy_idx").on(t.academyId),
    ruleIdx: index("wiki_revisions_rule_idx").on(t.ruleId),
    jobIdx: index("wiki_revisions_job_idx").on(t.jobId),
  }),
);

/**
 * Gaps, contradictions and "this needs a vote" notes the AI raises.
 * Nothing here is auto-applied: a human decides, which is the point.
 */
export const aiFindings = pgTable(
  "ai_findings",
  {
    id: serial("id").primaryKey(),
    academyId: integer("academy_id").notNull().references(() => academies.id, { onDelete: "cascade" }),
    studioId: integer("studio_id").references(() => studios.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    severity: text("severity").notNull().default("medium"),
    title: text("title").notNull(),
    description: text("description").notNull(),
    /** Options the AI thinks the studio could pick between. */
    options: jsonb("options").$type<string[]>().default([]),
    relatedRuleIds: jsonb("related_rule_ids").$type<number[]>().default([]),
    status: text("status").notNull().default("open"),
    resolutionNote: text("resolution_note"),
    resolvedBy: integer("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at"),
    sourceType: text("source_type"),
    sourceRef: text("source_ref"),
    jobId: integer("job_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    academyIdx: index("ai_findings_academy_idx").on(t.academyId),
    studioIdx: index("ai_findings_studio_idx").on(t.studioId),
    statusIdx: index("ai_findings_status_idx").on(t.status),
  }),
);

/* -------------------------------------------------------------------------- */
/*  Positions                                                                  */
/* -------------------------------------------------------------------------- */

export const positions = pgTable(
  "positions",
  {
    id: serial("id").primaryKey(),
    academyId: integer("academy_id").notNull().references(() => academies.id, { onDelete: "cascade" }),
    /** Which studio elects this role. Null is an academy-wide position. */
    studioId: integer("studio_id").references(() => studios.id, { onDelete: "set null" }),
    /** Studios that share this role - a joint committee across two studios. */
    sharedStudioIds: jsonb("shared_studio_ids").$type<number[]>().notNull().default([]),
    title: text("title").notNull(),
    description: text("description"),
    responsibilities: jsonb("responsibilities").$type<string[]>().default([]),
    /** How many people hold this at once (e.g. a 3-seat Hero Buck Committee). */
    seats: integer("seats").notNull().default(1),
    termLength: text("term_length"),
    elected: boolean("elected").notNull().default(true),
    archived: boolean("archived").notNull().default(false),
    sourceType: text("source_type").notNull().default("manual"),
    sourceRef: text("source_ref"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    academyIdx: index("positions_academy_idx").on(t.academyId),
    studioIdx: index("positions_studio_idx").on(t.studioId),
  }),
);

export const positionHolders = pgTable(
  "position_holders",
  {
    id: serial("id").primaryKey(),
    academyId: integer("academy_id").notNull().references(() => academies.id, { onDelete: "cascade" }),
    positionId: integer("position_id").notNull().references(() => positions.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    electionId: integer("election_id"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    endedAt: timestamp("ended_at"),
    note: text("note"),
  },
  (t) => ({
    positionIdx: index("position_holders_position_idx").on(t.positionId),
    userIdx: index("position_holders_user_idx").on(t.userId),
  }),
);

/* -------------------------------------------------------------------------- */
/*  Town Hall                                                                  */
/* -------------------------------------------------------------------------- */

export const meetings = pgTable(
  "meetings",
  {
    id: serial("id").primaryKey(),
    academyId: integer("academy_id").notNull().references(() => academies.id, { onDelete: "cascade" }),
    /** A Town Hall belongs to the studio that held it. */
    studioId: integer("studio_id").references(() => studios.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    meetingDate: timestamp("meeting_date").notNull().defaultNow(),
    status: text("status").notNull().default("draft"),
    secretaryId: integer("secretary_id").references(() => users.id, { onDelete: "set null" }),
    /** Freeform running notes (markdown) alongside the structured items. */
    notes: text("notes").notNull().default(""),
    /** userIds present. */
    attendance: jsonb("attendance").$type<number[]>().default([]),
    quorumNote: text("quorum_note"),
    startedAt: timestamp("started_at"),
    endedAt: timestamp("ended_at"),
    processedAt: timestamp("processed_at"),
    lastJobId: integer("last_job_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    academyIdx: index("meetings_academy_idx").on(t.academyId),
    studioIdx: index("meetings_studio_idx").on(t.studioId),
  }),
);

/**
 * The secretary's workspace is a list of typed items rather than a wall of
 * prose. Typing them is what lets the AI act precisely, and it's what makes
 * the notes readable a year later.
 */
export const meetingItems = pgTable(
  "meeting_items",
  {
    id: serial("id").primaryKey(),
    academyId: integer("academy_id").notNull().references(() => academies.id, { onDelete: "cascade" }),
    meetingId: integer("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
    /** agenda | discussion | motion | decision | action_item | appeal | announcement */
    type: text("type").notNull().default("discussion"),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    orderIndex: integer("order_index").notNull().default(0),
    /** passed | failed | tabled | withdrawn | null */
    outcome: text("outcome"),
    votesFor: integer("votes_for"),
    votesAgainst: integer("votes_against"),
    votesAbstain: integer("votes_abstain"),
    raisedBy: integer("raised_by").references(() => users.id, { onDelete: "set null" }),
    assignedTo: integer("assigned_to").references(() => users.id, { onDelete: "set null" }),
    dueDate: timestamp("due_date"),
    /** Action items carry over between meetings until closed. */
    completed: boolean("completed").notNull().default(false),
    /** Timestamp offset in seconds from meeting start, for the running clock. */
    timeOffsetSec: integer("time_offset_sec"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    meetingIdx: index("meeting_items_meeting_idx").on(t.meetingId),
  }),
);

/* -------------------------------------------------------------------------- */
/*  Elections                                                                  */
/* -------------------------------------------------------------------------- */

export const elections = pgTable(
  "elections",
  {
    id: serial("id").primaryKey(),
    academyId: integer("academy_id").notNull().references(() => academies.id, { onDelete: "cascade" }),
    /** Who votes. Null opens the ballot to the whole academy. */
    studioId: integer("studio_id").references(() => studios.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    /** position | rule */
    type: text("type").notNull().default("position"),
    positionId: integer("position_id").references(() => positions.id, { onDelete: "set null" }),
    /** For rule elections: the exact text being voted on. */
    proposalBody: text("proposal_body"),
    status: text("status").notNull().default("draft"),
    /** How many winners (defaults to the position's seat count). */
    seats: integer("seats").notNull().default(1),
    /** Learners may nominate themselves while the election is in draft. */
    selfNomination: boolean("self_nomination").notNull().default(true),
    anonymous: boolean("anonymous").notNull().default(true),
    opensAt: timestamp("opens_at"),
    closesAt: timestamp("closes_at"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    /** user | ai */
    createdByType: text("created_by_type").notNull().default("user"),
    sourceMeetingId: integer("source_meeting_id").references(() => meetings.id, { onDelete: "set null" }),
    results: jsonb("results").$type<Record<string, unknown>>(),
    certifiedAt: timestamp("certified_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    academyIdx: index("elections_academy_idx").on(t.academyId),
    studioIdx: index("elections_studio_idx").on(t.studioId),
  }),
);

export const candidates = pgTable(
  "candidates",
  {
    id: serial("id").primaryKey(),
    academyId: integer("academy_id").notNull().references(() => academies.id, { onDelete: "cascade" }),
    electionId: integer("election_id").notNull().references(() => elections.id, { onDelete: "cascade" }),
    /** Null for rule elections, where the "candidate" is an option like "Yes". */
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    statement: text("statement"),
    orderIndex: integer("order_index").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({ electionIdx: index("candidates_election_idx").on(t.electionId) }),
);

export const votes = pgTable(
  "votes",
  {
    id: serial("id").primaryKey(),
    academyId: integer("academy_id").notNull().references(() => academies.id, { onDelete: "cascade" }),
    electionId: integer("election_id").notNull().references(() => elections.id, { onDelete: "cascade" }),
    voterId: integer("voter_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    candidateId: integer("candidate_id").notNull().references(() => candidates.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    // One ballot line per voter per candidate. Multi-seat elections let a voter
    // pick up to `seats` candidates, so the uniqueness is on the pair.
    ballotIdx: uniqueIndex("votes_ballot_idx").on(t.electionId, t.voterId, t.candidateId),
    electionIdx: index("votes_election_idx").on(t.electionId),
  }),
);

/* -------------------------------------------------------------------------- */
/*  Observability: activity log + AI job queue                                 */
/* -------------------------------------------------------------------------- */

export const activityLog = pgTable(
  "activity_log",
  {
    id: serial("id").primaryKey(),
    academyId: integer("academy_id").notNull().references(() => academies.id, { onDelete: "cascade" }),
    /** Lets the log be read one studio at a time. Null means academy-level. */
    studioId: integer("studio_id").references(() => studios.id, { onDelete: "set null" }),
    actorUserId: integer("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    /** user | ai | system */
    actorType: text("actor_type").notNull().default("user"),
    actorLabel: text("actor_label"),
    /** Dotted verb, e.g. "wiki.rule.amended", "election.vote.cast". */
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: integer("entity_id"),
    summary: text("summary").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    academyIdx: index("activity_log_academy_idx").on(t.academyId),
    studioIdx: index("activity_log_studio_idx").on(t.studioId),
    createdIdx: index("activity_log_created_idx").on(t.createdAt),
  }),
);

export const aiJobs = pgTable(
  "ai_jobs",
  {
    id: serial("id").primaryKey(),
    academyId: integer("academy_id").notNull().references(() => academies.id, { onDelete: "cascade" }),
    /** Which studio's wiki this run touches. */
    studioId: integer("studio_id").references(() => studios.id, { onDelete: "set null" }),
    /** build_wiki | process_meeting | apply_election */
    kind: text("kind").notNull(),
    status: text("status").notNull().default("queued"),
    /** Human-readable "what the AI is doing right now". */
    message: text("message"),
    progress: integer("progress").notNull().default(0),
    requestedBy: integer("requested_by").references(() => users.id, { onDelete: "set null" }),
    meetingId: integer("meeting_id").references(() => meetings.id, { onDelete: "set null" }),
    electionId: integer("election_id").references(() => elections.id, { onDelete: "set null" }),
    input: jsonb("input").$type<Record<string, unknown>>(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),
    /** Set when the job produced questions only a human can answer. */
    awaitingReason: text("awaiting_reason"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    academyIdx: index("ai_jobs_academy_idx").on(t.academyId),
    statusIdx: index("ai_jobs_status_idx").on(t.status),
  }),
);

/* -------------------------------------------------------------------------- */
/*  Tac-Ons: the extension system                                              */
/* -------------------------------------------------------------------------- */

export const TACON_VISIBILITIES = ["draft", "unlisted", "public"] as const;
export type TaconVisibility = (typeof TACON_VISIBILITIES)[number];

export const TACON_CATEGORIES = [
  "general",
  "governance",
  "quests",
  "community",
  "tracking",
  "fun",
] as const;

/**
 * One Tac-On in the market.
 *
 * A Tac-On is to Eagle Bot what an extension is to a browser: a small, declared
 * addition an academy chooses to install. The row here is the listing - name,
 * blurb, who wrote it, how many academies run it. The thing that actually does
 * something is a version, below.
 *
 * `academyId` is the academy whose learner wrote it. Official Tac-Ons come from
 * the dev portal instead and carry a null academy, which is also what makes
 * them visible everywhere rather than only at home.
 */
export const tacons = pgTable(
  "tacons",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    tagline: text("tagline"),
    /** Markdown, shown on the details page. */
    description: text("description").notNull().default(""),
    icon: text("icon").notNull().default("puzzle"),
    category: text("category").notNull().default("general"),
    /** The academy whose dev wrote it. Null for official Tac-Ons. */
    academyId: integer("academy_id").references(() => academies.id, { onDelete: "cascade" }),
    authorUserId: integer("author_user_id").references(() => users.id, { onDelete: "set null" }),
    authorPortalId: integer("author_portal_id"),
    /** Denormalised so a listing survives the author leaving the academy. */
    authorName: text("author_name").notNull().default("Unknown"),
    /** Published through the dev portal by the Eagle Bot team. */
    official: boolean("official").notNull().default(false),
    /** draft (only the author) | unlisted (link only) | public (in the market) */
    visibility: text("visibility").$type<TaconVisibility>().notNull().default("draft"),
    /** Lifetime installs, never decremented - the number on the tile. */
    installCount: integer("install_count").notNull().default(0),
    /** Installs that are currently in place. */
    activeInstalls: integer("active_installs").notNull().default(0),
    latestVersionId: integer("latest_version_id"),
    /** Set by a portal dev when a Tac-On has to be pulled. Blocks new installs. */
    suspendedReason: text("suspended_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    slugIdx: uniqueIndex("tacons_slug_idx").on(t.slug),
    academyIdx: index("tacons_academy_idx").on(t.academyId),
    authorIdx: index("tacons_author_idx").on(t.authorUserId),
  }),
);

/**
 * A published version. Source and compiled manifest are both kept: the source
 * so the next dev can read and fork it, the manifest so rendering a page never
 * re-parses and an old install keeps running exactly what it installed.
 */
export const taconVersions = pgTable(
  "tacon_versions",
  {
    id: serial("id").primaryKey(),
    taconId: integer("tacon_id").notNull().references(() => tacons.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    /** The TacScript a person actually wrote. */
    source: text("source").notNull(),
    /** The compiled manifest. Shape lives in shared/tacons/types.ts. */
    manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull(),
    changelog: text("changelog"),
    /** published | yanked */
    status: text("status").notNull().default("published"),
    publishedByUserId: integer("published_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    publishedByPortalId: integer("published_by_portal_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    taconIdx: index("tacon_versions_tacon_idx").on(t.taconId),
    versionIdx: uniqueIndex("tacon_versions_version_idx").on(t.taconId, t.version),
  }),
);

/**
 * One academy (or one studio) running one Tac-On.
 *
 * Installs pin a version. A dev pushing an update does not silently change what
 * a Town Hall sees mid-session - the admin is shown that an update is waiting
 * and chooses when to take it.
 */
export const taconInstalls = pgTable(
  "tacon_installs",
  {
    id: serial("id").primaryKey(),
    academyId: integer("academy_id").notNull().references(() => academies.id, { onDelete: "cascade" }),
    /** Null installs it academy-wide; a studio id keeps it to that studio. */
    studioId: integer("studio_id").references(() => studios.id, { onDelete: "cascade" }),
    taconId: integer("tacon_id").notNull().references(() => tacons.id, { onDelete: "cascade" }),
    versionId: integer("version_id").notNull().references(() => taconVersions.id),
    enabled: boolean("enabled").notNull().default(true),
    /** What the installing admin filled in for the Tac-On's settings. */
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    installedBy: integer("installed_by").references(() => users.id, { onDelete: "set null" }),
    installedAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    academyIdx: index("tacon_installs_academy_idx").on(t.academyId),
    uniqueIdx: uniqueIndex("tacon_installs_unique_idx").on(t.academyId, t.studioId, t.taconId),
  }),
);

/**
 * Every row a Tac-On has ever recorded.
 *
 * One table for all of them, keyed by install and store name, with the row
 * itself as JSONB. A Tac-On can only ever read rows belonging to its own
 * install (or to an install that published the store through `provides`), so
 * the isolation is a where-clause rather than a promise.
 */
export const taconRecords = pgTable(
  "tacon_records",
  {
    id: serial("id").primaryKey(),
    academyId: integer("academy_id").notNull().references(() => academies.id, { onDelete: "cascade" }),
    installId: integer("install_id").notNull().references(() => taconInstalls.id, { onDelete: "cascade" }),
    /** The store this row belongs to, as named in the Tac-On. */
    store: text("store").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    /** user | tacon - a row written by a `when` hook has no person behind it. */
    createdByType: text("created_by_type").notNull().default("user"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    installIdx: index("tacon_records_install_idx").on(t.installId, t.store),
    createdIdx: index("tacon_records_created_idx").on(t.createdAt),
  }),
);

/* -------------------------------------------------------------------------- */
/*  The dev portal                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Accounts for the people who maintain Eagle Bot itself.
 *
 * Deliberately a separate table from `users`: a portal dev is not a member of
 * any academy, holds no studio, votes in nothing, and signs in through a door
 * most people never see (Ctrl+D). Keeping the two apart means no academy admin
 * can ever grant portal access by editing a role.
 */
export const portalDevs = pgTable(
  "portal_devs",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    /** The head dev can invite others and suspend a Tac-On. */
    head: boolean("head").notNull().default(false),
    active: boolean("active").notNull().default(true),
    bio: text("bio"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at"),
  },
  (t) => ({ emailIdx: uniqueIndex("portal_devs_email_idx").on(t.email) }),
);

export const portalInvites = pgTable(
  "portal_invites",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name"),
    token: varchar("token", { length: 64 }).notNull(),
    invitedBy: integer("invited_by").references(() => portalDevs.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({ tokenIdx: uniqueIndex("portal_invites_token_idx").on(t.token) }),
);

/**
 * A notice from the portal, shown to every academy running this deployment.
 * The channel exists so "the market is down for an hour" doesn't have to
 * travel by word of mouth between academies.
 */
export const portalNotices = pgTable("portal_notices", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  /** info | warning | release */
  tone: text("tone").notNull().default("info"),
  /** everyone | admins | devs */
  audience: text("audience").notNull().default("admins"),
  active: boolean("active").notNull().default(true),
  publishedBy: integer("published_by").references(() => portalDevs.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* -------------------------------------------------------------------------- */
/*  Relations                                                                  */
/* -------------------------------------------------------------------------- */

export const academiesRelations = relations(academies, ({ many }) => ({
  users: many(users),
  sections: many(wikiSections),
  studios: many(studios),
}));

export const studiosRelations = relations(studios, ({ one, many }) => ({
  academy: one(academies, { fields: [studios.academyId], references: [academies.id] }),
  members: many(users),
  sections: many(wikiSections),
  positions: many(positions),
  meetings: many(meetings),
  elections: many(elections),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  academy: one(academies, { fields: [users.academyId], references: [academies.id] }),
  studio: one(studios, { fields: [users.studioId], references: [studios.id] }),
  heldPositions: many(positionHolders),
}));

export const wikiSectionsRelations = relations(wikiSections, ({ one, many }) => ({
  academy: one(academies, { fields: [wikiSections.academyId], references: [academies.id] }),
  studio: one(studios, { fields: [wikiSections.studioId], references: [studios.id] }),
  rules: many(wikiRules),
}));

export const wikiRulesRelations = relations(wikiRules, ({ one, many }) => ({
  section: one(wikiSections, { fields: [wikiRules.sectionId], references: [wikiSections.id] }),
  revisions: many(wikiRevisions),
}));

export const meetingsRelations = relations(meetings, ({ one, many }) => ({
  secretary: one(users, { fields: [meetings.secretaryId], references: [users.id] }),
  studio: one(studios, { fields: [meetings.studioId], references: [studios.id] }),
  items: many(meetingItems),
}));

export const meetingItemsRelations = relations(meetingItems, ({ one }) => ({
  meeting: one(meetings, { fields: [meetingItems.meetingId], references: [meetings.id] }),
}));

export const electionsRelations = relations(elections, ({ one, many }) => ({
  position: one(positions, { fields: [elections.positionId], references: [positions.id] }),
  studio: one(studios, { fields: [elections.studioId], references: [studios.id] }),
  candidates: many(candidates),
  votes: many(votes),
}));

export const candidatesRelations = relations(candidates, ({ one, many }) => ({
  election: one(elections, { fields: [candidates.electionId], references: [elections.id] }),
  user: one(users, { fields: [candidates.userId], references: [users.id] }),
  votes: many(votes),
}));

export const positionsRelations = relations(positions, ({ one, many }) => ({
  academy: one(academies, { fields: [positions.academyId], references: [academies.id] }),
  studio: one(studios, { fields: [positions.studioId], references: [studios.id] }),
  holders: many(positionHolders),
}));

export const taconsRelations = relations(tacons, ({ one, many }) => ({
  author: one(users, { fields: [tacons.authorUserId], references: [users.id] }),
  versions: many(taconVersions),
  installs: many(taconInstalls),
}));

export const taconVersionsRelations = relations(taconVersions, ({ one }) => ({
  tacon: one(tacons, { fields: [taconVersions.taconId], references: [tacons.id] }),
}));

export const taconInstallsRelations = relations(taconInstalls, ({ one, many }) => ({
  tacon: one(tacons, { fields: [taconInstalls.taconId], references: [tacons.id] }),
  version: one(taconVersions, { fields: [taconInstalls.versionId], references: [taconVersions.id] }),
  studio: one(studios, { fields: [taconInstalls.studioId], references: [studios.id] }),
  records: many(taconRecords),
}));

export const taconRecordsRelations = relations(taconRecords, ({ one }) => ({
  install: one(taconInstalls, { fields: [taconRecords.installId], references: [taconInstalls.id] }),
}));

export const positionHoldersRelations = relations(positionHolders, ({ one }) => ({
  position: one(positions, { fields: [positionHolders.positionId], references: [positions.id] }),
  user: one(users, { fields: [positionHolders.userId], references: [users.id] }),
}));

/* -------------------------------------------------------------------------- */
/*  Inferred types                                                             */
/* -------------------------------------------------------------------------- */

export type Academy = typeof academies.$inferSelect;
export type Studio = typeof studios.$inferSelect;
export type User = typeof users.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type WikiSection = typeof wikiSections.$inferSelect;
export type WikiRule = typeof wikiRules.$inferSelect;
export type WikiRevision = typeof wikiRevisions.$inferSelect;
export type AiFinding = typeof aiFindings.$inferSelect;
export type Position = typeof positions.$inferSelect;
export type PositionHolder = typeof positionHolders.$inferSelect;
export type Meeting = typeof meetings.$inferSelect;
export type MeetingItem = typeof meetingItems.$inferSelect;
export type Election = typeof elections.$inferSelect;
export type Candidate = typeof candidates.$inferSelect;
export type Vote = typeof votes.$inferSelect;
export type ActivityEntry = typeof activityLog.$inferSelect;
export type AiJob = typeof aiJobs.$inferSelect;
export type Tacon = typeof tacons.$inferSelect;
export type TaconVersion = typeof taconVersions.$inferSelect;
export type TaconInstall = typeof taconInstalls.$inferSelect;
export type TaconRecord = typeof taconRecords.$inferSelect;
export type PortalDev = typeof portalDevs.$inferSelect;
export type PortalInvite = typeof portalInvites.$inferSelect;
export type PortalNotice = typeof portalNotices.$inferSelect;
