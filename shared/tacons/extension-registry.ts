import type { Manifest } from "./types";
import type { TaconCompilerExtension } from "./extensions";
import { extensions } from "../../built-tacons/extensions.compiler.generated";

export const compilerExtensions: readonly TaconCompilerExtension[] = extensions;
export function describeExtensions(manifest: Manifest) {
  return compilerExtensions.flatMap(extension =>
    extension.describe(manifest).map(description => ({ ...description, extension: extension.id })));
}
