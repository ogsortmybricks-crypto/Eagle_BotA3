import assert from "node:assert/strict";
import { test } from "node:test";
import { compile } from "@shared/tacons";
import { importTaconFolder, type PackageFile } from "./importFolder";

const source = `tacon sample-notes {
  name "Sample Notes"
  version 1.0.0
  about "A test Tac-On."
  store note { field text text required }
  page notes {
    title "Notes"
    form "Add a note" { into note
      ask text }
    list note { columns text, created }
  }
}
`;
function file(path: string, text = source): PackageFile {
  return {
    name: path.split("/").at(-1)!,
    webkitRelativePath: path,
    size: new TextEncoder().encode(text).length,
    text: async () => text,
  };
}

test("a package folder imports only its .tacon source and compiles", async () => {
  const result = await importTaconFolder([
    file("sample-notes/sample-notes.tacon"),
    file("sample-notes/README.md", "# Notes"),
    file("sample-notes/compile.test.ts", "not TacScript"),
  ]);
  assert.equal(result.source, source);
  assert.equal(result.sourcePath, "sample-notes/sample-notes.tacon");
  assert.equal(result.folderName, "sample-notes");
  assert.equal(result.ignoredFiles, 2);
  const checked = compile(result.source);
  assert.equal(checked.ok, true, JSON.stringify(checked.diagnostics));
  if (checked.ok) assert.equal(checked.manifest.pages[0].name, "notes");
});

test("BOM and Windows newlines are normalized before compiling", async () => {
  const imported = await importTaconFolder([file("notes/notes.tacon", "\uFEFF" + source.replace(/\n/g, "\r\n"))]);
  assert.equal(imported.source, source);
  assert.equal(compile(imported.source).ok, true);
});

test("nested files and single-file fallback are supported", async () => {
  assert.equal((await importTaconFolder([file("notes/src/notes.TACON")])).source, source);
  assert.equal((await importTaconFolder([{ ...file("notes.tacon"), webkitRelativePath: "" }])).sourcePath, "notes.tacon");
});

test("ambiguous or missing sources fail clearly without guessing", async () => {
  await assert.rejects(importTaconFolder([]), /Choose a folder/);
  await assert.rejects(importTaconFolder([file("notes/README.md")]), /No .tacon file/);
  await assert.rejects(importTaconFolder([file("notes/a.tacon"), file("notes/b.tacon")]), /Found 2/);
});

test("generated and dependency directories are never treated as package source", async () => {
  const result = await importTaconFolder([
    file("notes/notes.tacon"), file("notes/node_modules/template.tacon"), file("notes/.git/old.tacon"),
  ]);
  assert.equal(result.ignoredFiles, 2);
});

test("empty, binary, unreadable and oversized files are rejected", async () => {
  await assert.rejects(importTaconFolder([file("notes/notes.tacon", " ")]), /empty/);
  await assert.rejects(importTaconFolder([file("notes/notes.tacon", "\0binary")]), /plain UTF-8/);
  await assert.rejects(importTaconFolder([{ ...file("notes/notes.tacon"), text: async () => { throw new Error("read failure"); } }]), /Couldn't read/);
  await assert.rejects(importTaconFolder([file("notes/notes.tacon", "a".repeat(200_001))]), /too large/);
  await assert.rejects(importTaconFolder([{ ...file("notes/notes.tacon"), size: 1, text: async () => "é".repeat(120_000) }]), /too large/);
  await assert.rejects(importTaconFolder(Array.from({ length: 1001 }, () => file("notes/README.md"))), /too many files/);
});