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

export const STUDIOS = ["spark", "elementary", "middle", "launchpad", "staff"] as const;
export type Studio = (typeof STUDIOS)[number];

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
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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
    studio: text("studio").$type<Studio>(),
    bio: text("bio"),
    avatarUrl: text("avatar_url"),
    /** Free text, shown on the profile: "what I'm working toward". */
    nga: text("nga"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at"),
  },
  (t) => ({
    emailIdx: uniqueIndex("users_email_idx").on(t.email),
    academyIdx: index("users_academy_idx").on(t.academyId),
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
    studio: text("studio").$type<Studio>(),
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
  (t) => ({ academyIdx: index("documents_academy_idx").on(t.academyId) }),
);

/* -------------------------------------------------------------------------- */
/*  The wiki: sections hold rules, rules carry a full revision trail           */
/* -------------------------------------------------------------------------- */

export const wikiSections = pgTable(
  "wiki_sections",
  {
    id: serial("id").primaryKey(),
    academyId: integer("academy_id").notNull().references(() => academies.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    summary: text("summary"),
    orderIndex: integer("order_index").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    academyIdx: index("wiki_sections_academy_idx").on(t.academyId),
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
  (t) => ({ academyIdx: index("positions_academy_idx").on(t.academyId) }),
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
  (t) => ({ academyIdx: index("meetings_academy_idx").on(t.academyId) }),
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
  (t) => ({ academyIdx: index("elections_academy_idx").on(t.academyId) }),
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
    createdIdx: index("activity_log_created_idx").on(t.createdAt),
  }),
);

export const aiJobs = pgTable(
  "ai_jobs",
  {
    id: serial("id").primaryKey(),
    academyId: integer("academy_id").notNull().references(() => academies.id, { onDelete: "cascade" }),
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
/*  Relations                                                                  */
/* -------------------------------------------------------------------------- */

export const academiesRelations = relations(academies, ({ many }) => ({
  users: many(users),
  sections: many(wikiSections),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  academy: one(academies, { fields: [users.academyId], references: [academies.id] }),
  heldPositions: many(positionHolders),
}));

export const wikiSectionsRelations = relations(wikiSections, ({ one, many }) => ({
  academy: one(academies, { fields: [wikiSections.academyId], references: [academies.id] }),
  rules: many(wikiRules),
}));

export const wikiRulesRelations = relations(wikiRules, ({ one, many }) => ({
  section: one(wikiSections, { fields: [wikiRules.sectionId], references: [wikiSections.id] }),
  revisions: many(wikiRevisions),
}));

export const meetingsRelations = relations(meetings, ({ one, many }) => ({
  secretary: one(users, { fields: [meetings.secretaryId], references: [users.id] }),
  items: many(meetingItems),
}));

export const meetingItemsRelations = relations(meetingItems, ({ one }) => ({
  meeting: one(meetings, { fields: [meetingItems.meetingId], references: [meetings.id] }),
}));

export const electionsRelations = relations(elections, ({ one, many }) => ({
  position: one(positions, { fields: [elections.positionId], references: [positions.id] }),
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
  holders: many(positionHolders),
}));

export const positionHoldersRelations = relations(positionHolders, ({ one }) => ({
  position: one(positions, { fields: [positionHolders.positionId], references: [positions.id] }),
  user: one(users, { fields: [positionHolders.userId], references: [users.id] }),
}));

/* -------------------------------------------------------------------------- */
/*  Inferred types                                                             */
/* -------------------------------------------------------------------------- */

export type Academy = typeof academies.$inferSelect;
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
