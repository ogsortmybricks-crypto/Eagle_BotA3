import type { Node } from "./parse";
import type { Diagnostic } from "./types";
import { BASE_SOURCES } from "./types";

export type CodeFiles = Record<string, string>;
export type ProgramWidget = {
  kind: "program";
  entry: string;
  reads: string[];
  submits: number[];
  height: number;
};
export type ViewProgram = ProgramWidget & {
  index: number;
  bundle: string;
  data: Record<string, unknown[]>;
  settings?: Record<string, unknown>;
  viewer: { id: number; name: string; role: string };
};

export const MAX_CODE_BYTES = 500_000;
export const MAX_CODE_FILES = 40;
export function validCodePath(path: string) {
  return path.length <= 150 && /^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*\.(?:[cm]?[jt]s|[jt]sx|css)$/.test(path) &&
    !path.split("/").some(part => !part || part === "." || part === ".." || part === "node_modules");
}
export function codeFilesError(files: CodeFiles): string | null {
  const paths = Object.keys(files);
  if (paths.length > MAX_CODE_FILES) return `A package may contain at most ${MAX_CODE_FILES} code files.`;
  if (paths.some(path => !validCodePath(path))) return "Use relative JavaScript, TypeScript, JSX, TSX or CSS paths without parent-directory traversal.";
  if (paths.reduce((sum, path) => sum + new TextEncoder().encode(files[path]).length, 0) > MAX_CODE_BYTES) {
    return "The combined code files exceed the 500 KB package limit.";
  }
  return null;
}

export function compileProgram(node: Node, stores: Set<string>, diagnostics: Diagnostic[]): ProgramWidget {
  const fail = (at: Node, message: string) => diagnostics.push({ line: at.line, column: at.column, severity: "error", message });
  const entry = node.args[0]?.value ?? "";
  if (node.args.length !== 1 || !validCodePath(entry) || entry.endsWith(".css")) fail(node, 'Use program "src/main.ts" with a JavaScript or TypeScript entry file.');
  const program: ProgramWidget = { kind: "program", entry, reads: [], submits: [], height: 400 };
  for (const child of node.children) {
    const value = child.args[0]?.value ?? "";
    if (child.keyword === "read" && child.args.length === 1 && stores.has(value) && !new Set<string>(BASE_SOURCES).has(value) && !value.startsWith("__")) {
      program.reads.push(value);
    } else if (child.keyword === "submit" && child.args.length === 1 && /^\d+$/.test(value) && Number(value) <= 200) {
      program.submits.push(Number(value));
    } else if (child.keyword === "height" && child.args.length === 1 && Number(value) >= 120 && Number(value) <= 1200) {
      program.height = Number(value);
    } else {
      fail(child, "Programs accept read <own-store>, submit <form-widget-index>, and height <120–1200>. No built-in or other Tac-On stores can be read directly.");
    }
  }
  return program;
}
