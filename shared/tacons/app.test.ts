/**
 * The Tac-On app format: bundling a folder and checking a manifest.
 *
 *     npx tsx --test shared/tacons/app.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { bundleAppFolder, checkApp, chosenActions, manifestForApp, packageOf, type SetupAction } from "./app";

const MANIFEST = {
  name: "sign-in-sheet",
  title: "Sign-In Sheet",
  version: "1.0.0",
  description: "Learners sign in each morning.",
  author: "Ada Lovelace",
  icon: "📋",
};

test("a folder bundles the Eggstension way", () => {
  const { manifest, html, problems } = bundleAppFolder([
    { path: "manifest.json", text: JSON.stringify(MANIFEST) },
    {
      path: "index.html",
      text: `<!DOCTYPE html><html><head><link rel="stylesheet" href="base.css"></head>
<body><div class="sis">Hi</div><script src="app.js"></script><script src="https://cdn.example.com/x.js"></script></body></html>`,
    },
    { path: "styles/base.css", text: ".sis { color: red; }" },
    { path: "styles/theme.css", text: ".sis { font-weight: bold; }" },
    { path: "app.js", text: "document.title = '</script>';" },
    { path: "utils/helpers.js", text: "window.helper = 1;" },
  ]);
  assert.deepEqual(problems, []);
  assert.deepEqual(manifest, MANIFEST);
  assert.ok(html);
  assert.ok(!/<html|<head|<body|doctype/i.test(html!), "wrappers are dropped");
  assert.match(html!, /<style data-file="styles\/base.css">\n\.sis \{ color: red; \}/, "a linked file is found by the end of its path");
  assert.ok(html!.indexOf("theme.css") < html!.indexOf('class="sis"'), "unlinked CSS goes first");
  assert.ok(html!.indexOf("helpers.js") > html!.indexOf('class="sis"'), "unlinked JS goes last");
  assert.match(html!, /<\\\/script/, "a </script> inside a script can't close its tag");
  assert.match(html!, /src="https:\/\/cdn\.example\.com\/x\.js"/, "outside URLs are left as they are");
});

test("missing files are reported", () => {
  assert.deepEqual(bundleAppFolder([{ path: "index.html", text: "<p>x</p>" }]).problems, [
    "The folder has no manifest.json at its top level.",
  ]);
  assert.match(bundleAppFolder([{ path: "manifest.json", text: "{" }]).problems.join(" "), /isn't valid JSON/);
});

test("manifest checks", () => {
  assert.equal(checkApp({ manifest: MANIFEST, html: "<p>x</p>" }).ok, true);
  const bad = checkApp({ manifest: { ...MANIFEST, name: "Sign In", version: "1.0", icon: "clipboard" }, html: "" });
  assert.deepEqual(bad.checks.filter((check) => !check.ok).map((check) => check.label), ["name", "version", "icon", "index.html"]);
  const askedButNotOptional = checkApp({
    manifest: { ...MANIFEST, setup: [{ type: "createPosition", title: "Chair", prompt: "Make it?" }] },
    html: "<p>x</p>",
  });
  assert.match(askedButNotOptional.checks.find((check) => check.label === "setup")!.message!, /only make sense with "optional": true/);
  const unknown = checkApp({ manifest: { ...MANIFEST, setup: [{ type: "createStudio", title: "x" }] }, html: "<p>x</p>" });
  assert.match(unknown.checks.find((check) => check.label === "setup")!.message!, /"createStudio" isn't a setup action/);
});

test("setup answers", () => {
  const setup: SetupAction[] = [
    { type: "createPosition", title: "Chair" },
    { type: "createPosition", title: "Clerk", optional: true, id: "clerk" },
    { type: "enableFullWindow", optional: true, default: false },
  ];
  assert.deepEqual(chosenActions(setup, undefined), [true, true, false], "no answers: each default");
  assert.deepEqual(chosenActions(setup, []), [true, false, false], "required actions always run");
  assert.deepEqual(chosenActions(setup, ["clerk", 2]), [true, true, true], "by id or by position");
});

test("a package survives being published and exported", () => {
  const pkg = checkApp({ manifest: { ...MANIFEST, setup: [{ type: "enableFullWindow", optional: true }] }, html: "<p>x</p>" }).pkg!;
  const manifest = manifestForApp(pkg);
  assert.equal(manifest.slug, "sign-in-sheet");
  assert.equal(manifest.pages.length, 1);
  assert.deepEqual(packageOf(manifest), pkg);
});
