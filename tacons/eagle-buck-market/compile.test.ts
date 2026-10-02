import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { compile } from "../../shared/tacons/compile";

const source = readFileSync(new URL("./eagle-buck-market.tacon", import.meta.url), "utf8");

test("Eagle Buck Market compiles with fixed conversion, cap, shared scope and Shopkeeper desk", () => {
  const result = compile(source);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  if (!result.ok) return;
  assert.deepEqual(result.manifest.markets, [{
    name: "wallet", title: "Eagle Buck Market", rate: 100, cap: 1000, keeper: "shopkeeper", scope: "academy",
  }]);
  assert.ok(result.manifest.pages[0].widgets.some((w) => w.kind === "market" && w.market === "wallet"));
  assert.ok(result.manifest.positions[0].widgets.some((w) => w.kind === "market"));
  assert.equal(result.manifest.positions[0].seats, 1);
});

test("market widgets cannot reference missing markets", () => {
  const result = compile('tacon bad-market {\n name "Bad"\n version 1.0.0\n page market { market missing }\n}');
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((d) => d.message.includes("no market")));
});

test("markets require a real keeper position", () => {
  const result = compile(source.replace("keeper shopkeeper", "keeper nobody"));
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((d) => d.message.includes("declared position")));
});

test("market cap and rate must be positive whole numbers", () => {
  for (const edit of ["cap 0", "cap -1", "cap 0.5", "cap 1000000001", "cap NaN"]) {
    assert.equal(compile(source.replace("cap 1000", edit)).ok, false, edit);
  }
  assert.equal(compile(source.replace("rate 100", "rate 1001")).ok, false);
});

test("market declarations cannot be duplicated or configured inside widgets", () => {
  assert.equal(compile(source.replace("  page market {", '  market wallet { keeper shopkeeper }\n  page market {')).ok, false);
  assert.equal(compile(source.replace("    market wallet\n", "    market wallet { cap 2000 }\n")).ok, false);
});

test("reserved financial stores cannot be declared or exposed for generic writes", () => {
  assert.equal(compile(source.replace("  page market {", "  store __market_wallet_ledger { field points number }\n  page market {")).ok, false);
});

test("existing non-market Tac-Ons continue compiling", () => {
  const result = compile('tacon old-addon {\n name "Old"\n version 1.0.0\n page home { note "Hello" }\n}');
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
});