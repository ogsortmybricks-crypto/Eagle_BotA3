import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "./compile";
import { accessRules, granted, setupPlan, type InstallControls } from "./contract";
import { compilePackage } from "../../server/tacons/program-build";
const controls: InstallControls = { grants: [], policy: {}, selectedSetup: [], setupResults: [] };
function packageSource(contract = "", extra = "") {
  return `tacon contract-fixture {\nversion 1.0.0\n${contract}\n${extra}\npage home {\nnote "Hello"\n}\n}`;
}
test("versioned contracts compile roles, requested capabilities, topics and optional setup", () => {
  const result = compile(packageSource(`engine 1 {
view everyone
configure guide
read learner guide admin
write guide admin
capability storage.read storage.write events.send events.receive
emit work.done
listen work.done
setup positions optional "Create a review seat"
}`, `position reviewer {\ntitle "Reviewer"\n}`));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  if (!result.ok) return;
  assert.equal(result.manifest.formatVersion, 2);
  assert.equal(result.manifest.contract?.sdk, 1);
  assert.deepEqual(result.manifest.contract?.access.view, []);
  assert.deepEqual(result.manifest.contract?.access.write, ["guide", "admin"]);
  assert.equal(setupPlan(result.manifest)[0].optional, true);
  assert.equal(granted(result.manifest, controls, "storage.read"), false);
  assert.equal(granted(result.manifest, { ...controls, grants: ["storage.read"] }, "storage.read"), true);
  assert.equal(granted(result.manifest, { ...controls, grants: ["host.read"] }, "host.read"), false);
});
test("invalid SDK versions, roles, capabilities, topics and ambiguous rules fail compilation", () => {
  for (const body of ["engine 2 {}", "engine 1 {\nview mystery\n}", "engine 1 {\ncapability unrestricted.http\n}",
    "engine 1 {\nemit work.done\n}", 'engine 1 {\ncapability events.send\nemit "NOT VALID"\n}',
    "engine 1 {\nview admin\nview learner\n}", "engine 1 {}\nengine 1 {}",
    'engine 1 {\nsetup arbitrary optional "Run server code"\n}']) {
    assert.equal(compile(packageSource(body)).ok, false, body);
  }
});
test("none denies everyone, and installer overrides do not rewrite the author contract", () => {
  const result = compile(packageSource("engine 1 {\nread none\nconfigure none\n}"));
  assert.ok(result.ok);
  assert.deepEqual(accessRules(result.manifest, controls, "read"), ["none"]);
  assert.deepEqual(accessRules(result.manifest, { ...controls, policy: { read: ["guide"] } }, "read"), ["guide"]);
  assert.deepEqual(result.manifest.contract?.access.read, ["none"]);
});
test("legacy packages retain native capabilities, but gain no new event/discovery privileges", () => {
  const result = compile(packageSource("", 'position reviewer {\ntitle "Reviewer"\n}'));
  assert.ok(result.ok);
  assert.equal(granted(result.manifest, controls, "storage.read"), true);
  assert.equal(granted(result.manifest, controls, "host.read"), true);
  assert.equal(granted(result.manifest, controls, "events.send"), false);
  assert.equal(granted(result.manifest, controls, "extensions.discover"), false);
  assert.equal(setupPlan(result.manifest)[0].optional, false);
});
test("host positions in a new contract cannot bypass setup review", async () => {
  const result = await compilePackage(packageSource("engine 1 {}", 'position reviewer {\ntitle "Reviewer"\n}'));
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.at(-1)!.message, /reviewed setup/);
});
