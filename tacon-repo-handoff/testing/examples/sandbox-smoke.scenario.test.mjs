// A scenario test: drives the sandbox the way real people would, and asserts
// what each of them sees. Copy this next to your Tac-On as
// tacons/<slug>/sandbox.test.mjs. Needs `testing/sandbox up` first.
//
//   node --test testing/examples/sandbox-smoke.scenario.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { sandbox, ApiError } from "../client.mjs";

const file = fileURLToPath(new URL("./sandbox-smoke.tacon", import.meta.url));
const sb = sandbox();

test("only admins and the Treasurer can log points, and everyone sees the total", async () => {
  const deployed = await sb.deploy(file, { holders: { treasurer: "learner1" } });
  assert.ok(deployed.ok, JSON.stringify(deployed.diagnostics));
  const installId = deployed.install.id;
  const learner2 = (await sb.signIn("learner2")).user.id;

  const before = await sb.as("learner2").view(installId, "ledger");
  const total = Number(before.widgets.find(w => w.kind === "stat").value);
  const form = before.widgets.find(w => w.kind === "form");
  assert.equal(form.allowed, false, "a learner without the position can't log points");

  // The Treasurer can.
  await sb.as("learner1").submit(installId, { page: "ledger" }, form.index, { hero: learner2, amount: 7, reason: "Scenario" });

  // Learner2 can't, even by calling the API directly.
  await assert.rejects(
    sb.as("learner2").submit(installId, { page: "ledger" }, form.index, { hero: learner2, amount: 999 }),
    (error) => error instanceof ApiError && error.status === 403,
  );

  const after = await sb.as("learner2").view(installId, "ledger");
  assert.equal(Number(after.widgets.find(w => w.kind === "stat").value), total + 7);
});

test("the staff page is closed to learners and the Tac-On is invisible in another studio", async () => {
  const deployed = await sb.deploy(file);
  const installId = deployed.install.id;
  await assert.rejects(sb.as("learner1").view(installId, "staff"), (e) => e.status === 403);
  await sb.as("guide").view(installId, "staff");
  await assert.rejects(sb.as("learner3").view(installId, "ledger"), (e) => e.status === 404);
});
