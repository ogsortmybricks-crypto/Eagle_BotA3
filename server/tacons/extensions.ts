/** The engine only dispatches trusted, build-time Tac-On implementations. */
import type { Router } from "express";
import type { ExtensionWidget, ViewExtension } from "@shared/tacons/extensions";
import type { ViewNote } from "@shared/tacons/view";
import type { Runtime } from "./runtime";
import { extensions } from "../../built-tacons/extensions.server.generated";

export type TaconServerExtension = {
  id: string;
  /** Compatibility is implemented by the package, never by core feature code. */
  legacyWidgetKinds?: readonly string[];
  render(runtime: Runtime, configuration: unknown, index: number): Promise<unknown | null>;
  routes?: Router;
  publicRoutes?: Router;
};
export function registerExtensionRoutes(router: Router) {
  for (const extension of extensions as TaconServerExtension[]) {
    if (extension.routes) router.use(extension.routes);
  }
}
export function registerPublicExtensionRoutes(router: Router) {
  for (const extension of extensions as TaconServerExtension[]) {
    if (extension.publicRoutes) router.use(extension.publicRoutes);
  }
}
export async function renderExtensionWidget(runtime: Runtime, widget: unknown, index: number): Promise<ViewExtension | ViewNote | null> {
  if (!widget || typeof widget !== "object") return null;
  const value = widget as Record<string, unknown>;
  const extension = (extensions as TaconServerExtension[]).find(entry =>
    value.kind === "extension" ? entry.id === value.extension : entry.legacyWidgetKinds?.includes(String(value.kind)));
  // Packages are optional parts of the build. An install that outlives its
  // package keeps its records and shows why this part is missing, rather than
  // failing the whole page.
  if (!extension) {
    return {
      kind: "note",
      tone: "warning",
      text: `This part of ${runtime.install.tacon.name} needs the "${String(value.extension ?? value.kind)}" engine extension, which this Eagle Bot doesn't include. Its records are kept.`,
    };
  }
  const configuration = value.kind === "extension" ? (value as ExtensionWidget).config : value;
  const data = await extension.render(runtime, configuration, index);
  return data === null ? null : { kind: "extension", extension: extension.id, index, data };
}
