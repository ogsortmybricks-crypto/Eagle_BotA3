import test from "node:test";
import assert from "node:assert/strict";
import { compile } from "./compile";
import { compilePackage, codeFilesSchema } from "../../server/tacons/program-build";
import { validCodePath } from "./programs";

const source = `tacon program-test {
  name "Program test"
  version 1.0.0
  store entry {
    field title text required
  }
  page home {
    program "src/main.ts" {
      read entry
      submit 1
      height 300
    }
    form "Add" {
      into entry
      ask title
    }
  }
}`;
test("Tac-Script declares a program's entry, scoped reads, form capabilities and size", () => {
  const result = compile(source);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  if (result.ok) assert.deepEqual(result.manifest.pages[0].widgets[0], {
    kind: "program", entry: "src/main.ts", reads: ["entry"], submits: [1], height: 300,
  });
});
test("compile TS with relative JS imports and CSS, keeping package files for later editing", async () => {
  const files = {
    "src/main.ts": `import { title } from "./helper"; import css from "./theme.css";
      export default function(eagle: any) { eagle.styles(css); eagle.render({tag:"h1",text:title}); }`,
    "src/helper.js": 'export const title = "A real JavaScript module";',
    "src/theme.css": "h1 { color: blue; }",
  };
  const result = await compilePackage(source, files);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  if (result.ok) {
    assert.match(result.manifest.programBundles!["src/main.ts"], /A real JavaScript module/);
    assert.deepEqual(result.manifest.codeFiles, files);
  }
});
test("missing entries and syntax errors fail publishing explicitly", async () => {
  assert.equal((await compilePackage(source)).ok, false);
  const result = await compilePackage(source, { "src/main.ts": "export default function( {" });
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.at(-1)!.message, /src\/main.ts/);
});
test("TSX uses the sandbox UI factory, not a privileged DOM renderer", async () => {
  const result = await compilePackage(source.replace("src/main.ts", "src/main.tsx"), {
    "src/main.tsx": 'export default function(eagle: any) { eagle.render(<section><h2>Typed JSX</h2></section>); }',
  });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  if (result.ok) assert.match(result.manifest.programBundles!["src/main.tsx"], /eagle\.h/);
});
test("package code cannot import Node, URLs or files outside its uploaded map", async () => {
  for (const specifier of ["node:fs", "https://example.com/code.js", "/etc/passwd", "../../secret"]) {
    const result = await compilePackage(source, { "src/main.ts": `import x from ${JSON.stringify(specifier)}; export default () => x;` });
    assert.equal(result.ok, false, specifier);
  }
  for (const path of ["../a.ts", "/a.ts", "a/../b.ts", "a\\b.ts", "node_modules/a.js"]) assert.equal(validCodePath(path), false, path);
});
test("store reads and submit targets must be declared and owned", async () => {
  for (const read of ["people", "other.entry", "__private"]) assert.equal(compile(source.replace("read entry", `read ${read}`)).ok, false);
  const result = await compilePackage(source.replace("submit 1", "submit 0"), { "src/main.ts": "export default function() {}" });
  assert.equal(result.ok, false);
});
test("old declarative packages still compile and malicious or oversized code maps are rejected", async () => {
  assert.equal((await compilePackage('tacon old-test {\nversion 1.0.0\npage home {\nnote "Legacy"\n}\n}')).ok, true);
  assert.equal(codeFilesSchema.safeParse({ "../secret.ts": "export default {}" }).success, false);
  assert.equal(codeFilesSchema.safeParse({ "a.js": "x".repeat(200001) }).success, false);
});
