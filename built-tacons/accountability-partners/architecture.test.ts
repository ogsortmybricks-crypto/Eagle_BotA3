import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { compile } from "../../shared/tacons/compile";
import { compilerExtensions } from "../../shared/tacons/extension-registry";
import { EXTENSION_ID, partnerWidget } from "./shared/definition";

const root = new URL("../../", import.meta.url);
test("AP implementation belongs to its package, not main app directories", () => {
  for (const path of [
    "server/tacons/partners.ts", "server/tacons/partners-workspace.ts",
    "server/routes/tacon-partners.ts", "server/routes/partners-workspace.ts",
    "shared/tacons/partners.ts", "shared/tacons/partners-workspace.ts",
    "client/src/tacons/PartnersView.tsx", "client/src/tacons/ApWorkspace.tsx",
    "client/src/tacons/ApVerification.tsx", "client/src/pages/ApVerification.tsx",
  ]) assert.equal(existsSync(new URL(path, root)), false, `${path} must remain package-owned.`);
  for (const path of [
    "shared/tacons/compile.ts", "shared/tacons/types.ts", "shared/tacons/view.ts",
    "server/tacons/runtime.ts", "server/routes/index.ts", "server/routes/tacons.ts",
    "client/src/App.tsx", "client/src/tacons/Renderer.tsx", "client/src/pages/Market.tsx",
  ]) {
    const source = readFileSync(new URL(path, root), "utf8");
    assert.doesNotMatch(source, /ApWorkspace|ViewPartners|PartnersDef|renderPartners|readPublicApCertificate|\/ap\/verify|accountability-partners/);
  }
});
test("generic engine dispatch compiles package-owned definitions and widgets", () => {
  const source = readFileSync(new URL("./accountability-partners.tacon", import.meta.url), "utf8");
  const result = compile(source);
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  assert.ok(result.manifest!.extensions?.[EXTENSION_ID]);
  assert.equal("partners" in result.manifest!, false);
  assert.equal(result.manifest!.pages[0].widgets[0].kind, "extension");
  assert.equal(partnerWidget(result.manifest!.pages[0].widgets[0])?.partners, "ap");
  assert.ok(compilerExtensions.find(extension => extension.id === EXTENSION_ID));
});
test("unavailable extensions and cross-package widget payloads fail closed", () => {
  const result = compile('tacon missing-extension { extension not-bundled\n page home { title "Home"\n note "Hello" } }');
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(entry => entry.message.includes("not-bundled")));
  assert.equal(partnerWidget({ kind: "extension", extension: "unrelated-package", config: { kind: "partners", partners: "ap" } }), null);
});
