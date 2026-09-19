/**
 * TacScript, the language Tac-Ons are written in.
 *
 * The whole compiler lives in `shared/` rather than on the server because the
 * dev menu validates as you type: the same parser that decides whether a
 * Tac-On may be published is the one underlining the mistake in the editor, so
 * the two can never disagree about what is legal.
 */

export * from "./types";
export { parse, tokenize, type Node, type Token } from "./parse";
export { compile } from "./compile";
export {
  display,
  evaluate,
  matches,
  toNumber,
  type EvalContext,
  type Row,
} from "./expr";

import type { Manifest } from "./types";

/** Re-reads a manifest that came out of the database. */
export function isManifest(value: unknown): value is Manifest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Manifest>;
  return typeof candidate.slug === "string" && Array.isArray(candidate.pages);
}
