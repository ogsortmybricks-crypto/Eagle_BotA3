import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { compile } from "@shared/tacons";
import { importTaconFolder, type PackageFile } from "./importFolder";

const source = readFileSync(new URL("../../../built-tacons/eagle-buck-market/eagle-buck-market.tacon", import.meta.url), "utf8");
function file(path: string, text = source): PackageFile {
  return {
    name: path.split("/").at(-1)!,
    webkitRelativePath: path,
    size: new TextEncoder().encode(text).length,
    text: async () => text,
  };
}

test("a real Eagle Buck folder imports only its .tacon source and compiles", async () => {
  const result = await importTaconFolder([
    file("eagle-buck-market/eagle-buck-market.tacon"),
    file("eagle-buck-market/README.md", "# Notes"),
    file("eagle-buck-market/compile.test.ts", "not TacScript"),
  ]);
  assert.equal(result.source, source);
  assert.equal(result.sourcePath, "eagle-buck-market/eagle-buck-market.tacon");
  assert.equal(result.folderName, "eagle-buck-market");
  assert.equal(result.ignoredFiles, 2);
  const checked = compile(result.source);
  assert.equal(checked.ok, true, JSON.stringify(checked.diagnostics));
  if (checked.ok) assert.equal(checked.manifest.markets?.[0].cap, 1000);
});

test("BOM and Windows newlines are normalized before compiling", async () => {
  const imported = await importTaconFolder([file("market/market.tacon", "\uFEFF" + source.replace(/\n/g, "\r\n"))]);
  assert.equal(imported.source, source);
  assert.equal(compile(imported.source).ok, true);
});

test("nested files and single-file fallback are supported", async () => {
  assert.equal((await importTaconFolder([file("market/src/market.TACON")])).source, source);
  assert.equal((await importTaconFolder([{ ...file("market.tacon"), webkitRelativePath: "" }])).sourcePath, "market.tacon");
});

test("ambiguous or missing sources fail clearly without guessing", async () => {
  await assert.rejects(importTaconFolder([]), /Choose a folder/);
  await assert.rejects(importTaconFolder([file("market/README.md")]), /No .tacon file/);
  await assert.rejects(importTaconFolder([file("market/a.tacon"), file("market/b.tacon")]), /Found 2/);
});

test("generated and dependency directories are never treated as package source", async () => {
  const result = await importTaconFolder([
    file("market/market.tacon"), file("market/node_modules/template.tacon"), file("market/.git/old.tacon"),
  ]);
  assert.equal(result.ignoredFiles, 2);
});

test("empty, binary, unreadable and oversized files are rejected", async () => {
  await assert.rejects(importTaconFolder([file("market/market.tacon", " ")]), /empty/);
  await assert.rejects(importTaconFolder([file("market/market.tacon", "\0binary")]), /plain UTF-8/);
  await assert.rejects(importTaconFolder([{ ...file("market/market.tacon"), text: async () => { throw new Error("read failure"); } }]), /Couldn't read/);
  await assert.rejects(importTaconFolder([file("market/market.tacon", "a".repeat(200_001))]), /too large/);
  await assert.rejects(importTaconFolder([{ ...file("market/market.tacon"), size: 1, text: async () => "é".repeat(120_000) }]), /too large/);
  await assert.rejects(importTaconFolder(Array.from({ length: 1001 }, () => file("market/README.md"))), /too many files/);
});