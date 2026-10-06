/**
 * Build-time extension contracts. Implementations belong to Tac-On packages,
 * not to the engine. Uploaded TacScript cannot supply executable extensions.
 */
import type { Node } from "./parse";
import type { Diagnostic, Manifest } from "./types";

export type ExtensionCompileContext = {
  diagnostics: Diagnostic[];
  positions: Set<string>;
};
export type TaconCompilerExtension = {
  id: string;
  definitionKeywords: readonly string[];
  widgetKeywords: readonly string[];
  compileDefinitions(context: ExtensionCompileContext, nodes: Node[]): unknown;
  compileWidget(context: ExtensionCompileContext, node: Node, configuration: unknown): Record<string, unknown> | null;
  /** Package-owned descriptions for the install review, including legacy manifests. */
  describe(manifest: Manifest): { title: string; description: string }[];
};
export type ExtensionWidget = {
  kind: "extension";
  extension: string;
  config: Record<string, unknown>;
};
export type ViewExtension = {
  kind: "extension";
  extension: string;
  index: number;
  data: unknown;
};
