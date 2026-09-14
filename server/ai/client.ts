import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
// Structured outputs go through the SDK's Zod v4 helper, so the AI schemas are
// v4 even though the request-validation schemas elsewhere are still v3.
import type { z } from "zod/v4";
import { env, aiConfigured } from "../env";

let client: Anthropic | null = null;

export function getClient(): Anthropic {
  if (!aiConfigured) {
    throw new AiNotConfiguredError();
  }
  if (!client) {
    client = new Anthropic({
      apiKey: env.anthropicApiKey,
      // Wiki builds read every uploaded document at once; give them room.
      timeout: 15 * 60 * 1000,
      maxRetries: 2,
    });
  }
  return client;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not set, so the AI features are switched off.");
    this.name = "AiNotConfiguredError";
  }
}

export class AiRefusalError extends Error {
  constructor(public category: string | null | undefined, explanation?: string | null) {
    super(explanation || "Claude declined to process this request.");
    this.name = "AiRefusalError";
  }
}

export type AiUsage = { inputTokens: number; outputTokens: number };

/**
 * One structured call to Claude.
 *
 * Streams because these prompts read whole rule sets and write whole wikis -
 * a non-streaming request at this size runs into HTTP timeouts. The response
 * is constrained to `schema` server-side, then validated again here so a
 * malformed payload fails loudly instead of half-writing the wiki.
 */
export async function askClaude<T extends z.ZodType>(opts: {
  system: string;
  prompt: string;
  schema: T;
  /** Large stable prefix (the current wiki, uploaded docs) - cached across calls. */
  cachedContext?: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  onProgress?: (tokens: number) => void;
}): Promise<{ data: z.infer<T>; usage: AiUsage }> {
  const anthropic = getClient();

  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: opts.system }];
  if (opts.cachedContext) {
    system.push({
      type: "text",
      text: opts.cachedContext,
      cache_control: { type: "ephemeral" },
    });
  }

  const stream = anthropic.messages.stream({
    model: env.anthropicModel,
    max_tokens: opts.maxTokens ?? 32000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: opts.effort ?? "high",
      format: zodOutputFormat(opts.schema),
    },
    system,
    messages: [{ role: "user", content: opts.prompt }],
  });

  if (opts.onProgress) {
    let emitted = 0;
    stream.on("text", (delta) => {
      emitted += delta.length;
      opts.onProgress?.(emitted);
    });
  }

  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new AiRefusalError(message.stop_details?.category, message.stop_details?.explanation);
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error(
      "Claude ran out of room before finishing. Try processing fewer documents at once.",
    );
  }

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  if (!text.trim()) {
    throw new Error("Claude returned an empty response.");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Claude returned something that wasn't valid JSON.");
  }

  const parsed = opts.schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Claude's response didn't match the expected shape: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }

  return {
    data: parsed.data,
    usage: {
      inputTokens: message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0),
      outputTokens: message.usage.output_tokens,
    },
  };
}

export function describeAiError(error: unknown): string {
  if (error instanceof AiNotConfiguredError) return error.message;
  if (error instanceof AiRefusalError) return `Claude declined this request (${error.category ?? "unspecified"}). ${error.message}`;
  if (error instanceof Anthropic.AuthenticationError) return "The Claude API key was rejected. Check ANTHROPIC_API_KEY.";
  if (error instanceof Anthropic.RateLimitError) return "Claude is rate limiting us right now. Try again in a minute.";
  if (error instanceof Anthropic.BadRequestError) return `Claude rejected the request: ${error.message}`;
  if (error instanceof Anthropic.APIConnectionError) return "Couldn't reach the Claude API. Check the network and try again.";
  if (error instanceof Anthropic.APIError) return `Claude API error ${error.status}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}
