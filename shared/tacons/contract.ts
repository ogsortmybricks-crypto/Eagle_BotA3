import { z } from "zod";
import type { Node } from "./parse";
import { words, joined, text } from "./parse";
import type { Diagnostic, Manifest } from "./types";

export const CAPABILITIES = [
  "storage.read", "storage.write", "host.read", "host.hooks",
  "sharing.read", "sharing.provide", "extensions.discover", "events.send", "events.receive",
] as const;
export const OPERATIONS = ["view", "configure", "read", "write"] as const;
export type Operation = typeof OPERATIONS[number];
export const topicSchema = z.string().regex(/^[a-z][a-z0-9_.-]{0,79}$/);
export const policySchema = z.object({
  view: z.array(z.string().max(150)).max(30),
  configure: z.array(z.string().max(150)).max(30),
  read: z.array(z.string().max(150)).max(30),
  write: z.array(z.string().max(150)).max(30),
});
export type AccessPolicy = z.infer<typeof policySchema>;
export const contractSchema = z.object({
  sdk: z.literal(1),
  access: policySchema,
  capabilities: z.array(z.enum(CAPABILITIES)).max(9),
  emits: z.array(topicSchema).max(30),
  listens: z.array(topicSchema).max(30),
  setup: z.array(z.object({ id: z.literal("positions"), optional: z.boolean(), purpose: z.string().min(1).max(300) })).max(1),
});
export type ExtensionContract = z.infer<typeof contractSchema>;
export type SetupResult = { id: string; status: "completed" | "skipped" | "failed"; message: string };
export type InstallControls = {
  grants: string[];
  policy: Partial<AccessPolicy>;
  selectedSetup: string[];
  setupResults: SetupResult[];
};
export const DEFAULT_ACCESS: AccessPolicy = { view: [], configure: ["admin"], read: [], write: [] };

export function compileContract(node: Node, diagnostics: Diagnostic[], audience: (node: Node) => string[]): ExtensionContract {
  const result: ExtensionContract = {
    sdk: 1, access: structuredClone(DEFAULT_ACCESS), capabilities: [], emits: [], listens: [], setup: [],
  };
  const fail = (at: Node, message: string) => diagnostics.push({ line: at.line, column: at.column, severity: "error", message });
  if (text(node.args[0]) !== "1" || node.args.length !== 1) fail(node, "Use engine 1 { ... }. SDK version 1 is supported.");
  const seen = new Set<string>();
  for (const child of node.children) {
    const key = child.keyword.toLowerCase();
    if ((OPERATIONS as readonly string[]).includes(key)) {
      if (!child.args.length || seen.has(key)) fail(child, `Declare ${key} once with an audience (everyone, none, roles or positions).`);
      seen.add(key);
      result.access[key as Operation] = joined(child.args).toLowerCase() === "none" ? ["none"] : audience(child);
    } else if (key === "capability") {
      for (const name of words(child.args)) {
        if (!(CAPABILITIES as readonly string[]).includes(name)) fail(child, `Unknown capability "${name}". Use ${CAPABILITIES.join(", ")}.`);
        else if (!result.capabilities.includes(name as typeof CAPABILITIES[number])) result.capabilities.push(name as typeof CAPABILITIES[number]);
      }
    } else if (key === "emit" || key === "listen") {
      for (const topic of words(child.args)) {
        if (!topicSchema.safeParse(topic).success) fail(child, "Event topics use lowercase letters, numbers, dots, hyphens and underscores, up to 80 characters.");
        else result[key === "emit" ? "emits" : "listens"].push(topic);
      }
    } else if (key === "setup" && text(child.args[0]) === "positions" && result.setup.length === 0 &&
      ["optional", "required"].includes(text(child.args[1])) && text(child.args[2]).trim()) {
      result.setup.push({ id: "positions", optional: text(child.args[1]) === "optional", purpose: text(child.args[2]) });
    } else fail(child, 'Use view/configure/read/write, capability, emit/listen, or setup positions optional|required "purpose".');
  }
  const checked = contractSchema.safeParse(result);
  if (!checked.success) fail(node, "The engine contract exceeds its limits. Use at most 30 topics and a setup purpose under 300 characters.");
  if (result.emits.length && !result.capabilities.includes("events.send")) fail(node, "Emitted topics require capability events.send.");
  if (result.listens.length && !result.capabilities.includes("events.receive")) fail(node, "Listened topics require capability events.receive.");
  return result;
}

export function setupPlan(manifest: Manifest) {
  return manifest.contract?.setup ?? (manifest.positions.length
    ? [{ id: "positions" as const, optional: false, purpose: "Create or synchronize the ordinary studio positions declared by this package." }]
    : []);
}

export function granted(manifest: Manifest, controls: InstallControls, capability: string): boolean {
  // Old packages keep their existing native behavior, but gain no interop APIs.
  if (!manifest.contract) return !["extensions.discover", "events.send", "events.receive"].includes(capability);
  return (manifest.contract.capabilities as string[]).includes(capability) && controls.grants.includes(capability);
}

export function accessRules(manifest: Manifest, controls: InstallControls, operation: Operation) {
  return controls.policy[operation] ?? manifest.contract?.access[operation] ?? DEFAULT_ACCESS[operation];
}
