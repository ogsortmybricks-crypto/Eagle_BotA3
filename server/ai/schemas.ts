import { z } from "zod/v4";

/**
 * The AI never writes to the database directly. It emits a list of operations
 * in this vocabulary, and `apply.ts` executes them inside a transaction while
 * recording a revision for each one. That separation is what makes every AI
 * edit reviewable and reversible.
 */

export const sectionSpec = z.object({
  key: z.string().describe("Short kebab-case identifier, unique within this response, e.g. 'hero-bucks'"),
  title: z.string(),
  summary: z.string().describe("One or two sentences on what this section covers"),
  orderIndex: z.number().int().describe("Display order, 0 first"),
});

export const findingSpec = z.object({
  type: z.enum(["contradiction", "gap", "ambiguity", "election_needed"]),
  severity: z.enum(["low", "medium", "high"]),
  title: z.string().describe("Short headline, e.g. 'Two different quorum numbers'"),
  description: z
    .string()
    .describe("Plain-language explanation of the problem, quoting the conflicting text where useful"),
  options: z
    .array(z.string())
    .describe("Two to four concrete ways the studio could resolve this. Empty array if none apply."),
  relatedRuleKeys: z
    .array(z.string())
    .describe("Keys of rules in this response that this finding refers to. Empty array if none."),
  relatedRuleIds: z
    .array(z.number().int())
    .describe("Database ids of existing rules this finding refers to. Empty array if none."),
});

export const positionSpec = z.object({
  title: z.string(),
  description: z.string(),
  responsibilities: z.array(z.string()),
  seats: z.number().int().min(1).describe("How many people hold this at once"),
  termLength: z.string().describe("e.g. 'One session', 'One year', or 'Unspecified'"),
  elected: z.boolean().describe("True if filled by a vote, false if appointed"),
  evidence: z.string().describe("Where in the documents this position was mentioned"),
});

/* ------------------------------- build wiki ------------------------------- */

export const buildWikiResult = z.object({
  sections: z.array(sectionSpec),
  rules: z.array(
    z.object({
      key: z.string().describe("Short kebab-case identifier, unique within this response"),
      sectionKey: z.string().describe("Must match a section key above"),
      title: z.string(),
      body: z.string().describe("The rule in Markdown. Preserve the studio's own wording where it is clear."),
      citation: z.string().describe("Which uploaded document and roughly where this came from"),
      orderIndex: z.number().int(),
    }),
  ),
  positions: z.array(positionSpec),
  findings: z.array(findingSpec),
  overview: z
    .string()
    .describe("A short Markdown orientation page for someone reading this studio's rules for the first time"),
});

export type BuildWikiResult = z.infer<typeof buildWikiResult>;

/* ----------------------------- process meeting ---------------------------- */

export const wikiOperation = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create_section"),
    key: z.string(),
    title: z.string(),
    summary: z.string(),
    rationale: z.string(),
  }),
  z.object({
    op: z.literal("create_rule"),
    sectionKey: z.string().describe("An existing section slug, or the key of a create_section op in this same list"),
    title: z.string(),
    body: z.string(),
    rationale: z.string().describe("Why this is being added, referencing the meeting"),
  }),
  z.object({
    op: z.literal("amend_rule"),
    ruleId: z.number().int().describe("Id of the existing rule, exactly as given in the current wiki"),
    title: z.string(),
    body: z.string().describe("The complete new text of the rule, not a diff"),
    rationale: z.string(),
  }),
  z.object({
    op: z.literal("repeal_rule"),
    ruleId: z.number().int(),
    rationale: z.string().describe("Which decision repealed or contradicted this rule"),
  }),
  z.object({
    op: z.literal("move_rule"),
    ruleId: z.number().int(),
    sectionKey: z.string(),
    rationale: z.string(),
  }),
]);

export const electionProposal = z.object({
  title: z.string(),
  description: z.string(),
  type: z.enum(["position", "rule"]),
  positionTitle: z
    .string()
    .describe("For position elections, the exact position title. Empty string for rule elections."),
  proposalBody: z
    .string()
    .describe("For rule elections, the exact text being voted on. Empty string for position elections."),
  seats: z.number().int().min(1),
  rationale: z.string().describe("What in the notes indicates this needs a vote"),
});

export const processMeetingResult = z.object({
  summary: z.string().describe("A short Markdown recap of what the meeting decided"),
  operations: z.array(wikiOperation),
  findings: z.array(findingSpec),
  proposedElections: z.array(electionProposal),
  newPositions: z.array(positionSpec).describe("Positions mentioned in the notes that don't exist yet"),
  unresolvedQuestions: z
    .array(z.string())
    .describe("Things in the notes too ambiguous to act on. The secretary will be asked about these."),
});

export type ProcessMeetingResult = z.infer<typeof processMeetingResult>;

/* ----------------------------- apply election ----------------------------- */

export const applyElectionResult = z.object({
  summary: z.string(),
  operations: z.array(wikiOperation),
  findings: z.array(findingSpec),
});

export type ApplyElectionResult = z.infer<typeof applyElectionResult>;
export type WikiOperation = z.infer<typeof wikiOperation>;
export type FindingSpec = z.infer<typeof findingSpec>;
export type PositionSpec = z.infer<typeof positionSpec>;
export type ElectionProposal = z.infer<typeof electionProposal>;
