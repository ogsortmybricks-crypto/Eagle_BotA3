/**
 * Compile, never execute, uploaded JS/TS. Resolution is confined to the package
 * map: no filesystem, Node built-ins, network imports or npm install hooks.
 */
import { build } from "esbuild";
import path from "node:path";
import { z } from "zod";
import { compile, type CompileResult } from "@shared/tacons";
import { codeFilesError, type CodeFiles, type ProgramWidget } from "@shared/tacons/programs";

export const codeFilesSchema = z.record(z.string().max(200_000)).default({})
  .refine(files => codeFilesError(files) === null, files => ({ message: codeFilesError(files)! }));

export async function compilePackage(source: string, files: CodeFiles = {}): Promise<CompileResult> {
  const result = compile(source);
  if (!result.ok || !result.manifest) return result;
  const manifest = result.manifest;
  const fail = (message: string): CompileResult => ({
    ok: false, manifest: null,
    diagnostics: [...result.diagnostics, { line: 1, column: 1, severity: "error", message }],
  });
  const invalid = codeFilesError(files);
  if (invalid) return fail(invalid);
  const programs = [...manifest.pages, ...manifest.panels, ...manifest.positions]
    .flatMap(owner => owner.widgets).filter((widget): widget is ProgramWidget => widget.kind === "program");
  for (const owner of [...manifest.pages, ...manifest.panels, ...manifest.positions]) {
    for (const widget of owner.widgets) {
      if (widget.kind === "program" && widget.submits.some(index => owner.widgets[index]?.kind !== "form")) {
        return fail(`Program "${widget.entry}" must submit only existing form widget indexes in its own page, panel or position desk. Indexes start at zero.`);
      }
    }
  }
  const bundles: Record<string, string> = {};
  let compiledBytes = 0;
  for (const entry of new Set(programs.map(program => program.entry))) {
    if (!Object.hasOwn(files, entry)) return fail(`Missing program entry "${entry}". Upload its package folder or add that file in the code editor.`);
    try {
      const built = await build({
        entryPoints: [entry], bundle: true, write: false, platform: "browser",
        format: "iife", globalName: "TaconProgram", target: "es2020", logLevel: "silent",
        jsxFactory: "eagle.h", jsxFragment: "eagle.Fragment",
        jsx: "transform", tsconfigRaw: {},
        plugins: [{
          name: "tacon-package-only",
          setup(plugin) {
            plugin.onResolve({ filter: /.*/ }, args => {
              if (args.kind !== "entry-point" && !args.path.startsWith(".")) {
                return { errors: [{ text: `Only local relative imports are allowed, not "${args.path}". Prebundle browser-compatible libraries into your package.` }] };
              }
              const base = args.importer ? path.posix.dirname(args.importer) : "";
              const candidate = path.posix.normalize(path.posix.join(base, args.path));
              const resolved = [candidate, ...[".ts", ".js", ".tsx", ".jsx", "/index.ts", "/index.js"].map(ext => candidate + ext)]
                .find(file => Object.hasOwn(files, file));
              return resolved ? { path: resolved, namespace: "tacon" } : { errors: [{ text: `Package file "${candidate}" was not found.` }] };
            });
            plugin.onLoad({ filter: /.*/, namespace: "tacon" }, args => {
              const extension = args.path.split(".").pop()!;
              return extension === "css"
                ? { contents: `export default ${JSON.stringify(files[args.path])};`, loader: "js" }
                : { contents: files[args.path], loader: extension === "tsx" ? "tsx" : extension === "jsx" ? "jsx" : extension.endsWith("ts") ? "ts" : "js" };
            });
          },
        }],
      });
      if (built.outputFiles[0].contents.length > 1_000_000) return fail(`Program "${entry}" exceeds the 1 MB compiled limit.`);
      compiledBytes += built.outputFiles[0].contents.length;
      if (compiledBytes > 2_000_000) return fail("Combined compiled programs exceed the 2 MB package limit.");
      bundles[entry] = built.outputFiles[0].text;
    } catch (error) {
      const errors = (error as { errors?: { text: string; location?: { file: string; line: number } }[] }).errors;
      return fail(`Program "${entry}": ${errors?.map(item => `${item.location ? `${item.location.file}:${item.location.line}: ` : ""}${item.text}`).join("; ") ?? "Compilation failed."}`);
    }
  }
  manifest.codeFiles = { ...files };
  manifest.programBundles = bundles;
  return result;
}
