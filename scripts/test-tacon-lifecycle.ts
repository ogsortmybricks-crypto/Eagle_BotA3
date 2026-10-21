/**
 * Development-only integration checks against the running app. All records
 * belong to temporary academies created here and are removed in finally.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../server/db";
import { academies, studios, users, tacons, taconVersions, taconInstalls, taconRecords, positions, taconMessages } from "../shared/schema";
import { executeSetup } from "../server/tacons/lifecycle";

if (process.env.REPLIT_DEPLOYMENT === "1" || !process.env.REPLIT_DEV_DOMAIN?.endsWith(".replit.dev")) {
  throw new Error("Run these fixture checks in the development workspace only.");
}
const base = `https://${process.env.REPLIT_DEV_DOMAIN}`, key = randomUUID().slice(0, 8), password = randomUUID();
const owned: number[] = [];
let checks = 0;
const codeFiles = { "main.ts": 'export default function(eagle: any) { eagle.render({tag:"p",text:"Contract test"}); }' };
function source(slug: string, version = "1.0.0") {
  return `tacon ${slug} {
name "Lifecycle fixture"
version ${version}
tags academics reviews
engine 1 {
 view everyone
 configure guide
 read admin guide learner
 write admin guide
 capability storage.read storage.write extensions.discover events.send events.receive sharing.read sharing.provide ${version === "1.0.0" ? "" : "host.hooks"}
 emit work.done
 listen work.done
 setup positions optional "Create ordinary review seats for this studio"
}
setting greeting {
 default "Hello"
}
store entry {
 field title text required
}
provides entry
position reviewer {
 title "${version === "1.0.0" ? "Reviewer" : "Senior Reviewer"}"
}
${version === "1.0.0" ? "" : 'position helper {\n title "Review Helper"\n}'}
page home {
 nav true
 program "main.ts" {
  read entry
  submit 1
  submit 3
 }
 form "Add entry" {
  into entry
  ask title
  allow admin guide
 }
 list entry {
  columns title, link
  allow remove admin
 }
 form "Confirmed entry" {
  into entry
  ask title
  allow admin guide
  confirm with code
 }
}
}`;
}
type Client = (method: string, path: string, payload?: unknown, expected?: number, studioId?: number) => Promise<any>;
async function actor(academyId: number, studioId: number, role: "admin" | "guide" | "learner", suffix: string): Promise<Client> {
  const email = `fixture-${key}-${suffix}@example.test`;
  await db.insert(users).values({ academyId, studioId, name: "Lifecycle fixture", email, role, devStatus: role === "admin",
    devHandle: role === "admin" ? `fixture-${key}-${suffix}` : null, passwordHash: await bcrypt.hash(password, 8) });
  let cookie = "";
  const request: Client = async (method, path, payload, expected = 200, targetStudio = studioId) => {
    const response = await fetch(`${base}/api${path}`, { method, headers: {
      "Content-Type": "application/json", "X-Studio-Id": String(targetStudio), ...(cookie ? { Cookie: cookie } : {}),
    }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    const set = response.headers.getSetCookie();
    if (set.length) cookie = set.map(value => value.split(";")[0]).join("; ");
    const result = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result).slice(0, 600)}`);
    checks++;
    return result;
  };
  await request("POST", "/auth/login", { email, password });
  return request;
}
async function school() {
  const [academy] = await db.insert(academies).values({ name: "Lifecycle fixture", emailDomain: `${randomUUID()}.example.test`,
    palette: { primary: "#0369a1", accent: "#0ea5e9", surface: "#f8fafc" } }).returning();
  owned.push(academy.id);
  const [studio] = await db.insert(studios).values({ academyId: academy.id, name: "Fixture A", slug: `fixture-${randomUUID().slice(0, 8)}` }).returning();
  return { academy, studio };
}
try {
  const { academy, studio } = await school();
  const [otherStudio] = await db.insert(studios).values({ academyId: academy.id, name: "Fixture B", slug: `fixture-b-${key}` }).returning();
  const foreign = await school();
  const admin = await actor(academy.id, studio.id, "admin", "admin");
  const guide = await actor(academy.id, studio.id, "guide", "guide");
  const learner = await actor(academy.id, studio.id, "learner", "learner");
  const otherLearner = await actor(academy.id, otherStudio.id, "learner", "other");
  const foreignAdmin = await actor(foreign.academy.id, foreign.studio.id, "admin", "foreign");
  async function publish(client: Client, slug: string, version = "1.0.0") {
    await client("POST", "/tacons/dev/publish", { source: source(slug, version), codeFiles, visibility: "draft" }, 201);
    const [listing] = await db.select().from(tacons).where(eq(tacons.slug, slug));
    const [published] = await db.select().from(taconVersions).where(eq(taconVersions.id, listing.latestVersionId!));
    return { listing, version: published, manifest: published.manifest as any };
  }
  const sender = await publish(admin, `sender-${key}`), receiver = await publish(admin, `receiver-${key}`);
  const outside = await publish(foreignAdmin, `outside-${key}`);
  const review = (published: typeof sender, extra: object = {}) => ({
    reviewedVersionId: published.version.id, grants: published.manifest.contract.capabilities, selectedSetup: [], ...extra,
  });
  const install = async (client: Client, published: typeof sender, targetStudio: number) =>
    (await client("POST", `/tacons/market/${published.listing.slug}/install`, { ...review(published), studioId: targetStudio, settings: { greeting: "Saved greeting" } }, 201)).install;
  await admin("POST", `/tacons/market/${sender.listing.slug}/install`, { studioId: studio.id }, 409);
  const sent = await install(admin, sender, studio.id), received = await install(admin, receiver, studio.id);
  const inOtherStudio = await install(admin, receiver, otherStudio.id);
  const outsideInstall = await install(foreignAdmin, outside, foreign.studio.id);
  const rpc = (client: Client, id: number, method: string, args: unknown = {}, status = 200) =>
    client("POST", `/tacons/sdk/${id}/rpc`, { sdk: 1, page: "home", index: 0, method, args }, status);
  const countPositions = async () => db.select().from(positions).where(eq(positions.taconInstallId, sent.id));
  assert.equal((await countPositions()).length, 0, "Optional setup stays off until approved.");
  await Promise.all([0, 1].map(() => admin("POST", `/tacons/market/${sender.listing.slug}/install`, { ...review(sender), studioId: studio.id, settings: {} })));
  assert.equal((await db.select().from(taconInstalls).where(and(eq(taconInstalls.academyId, academy.id), eq(taconInstalls.taconId, sender.listing.id)))).length, 1);
  await guide("PATCH", `/tacons/sdk/${sent.id}/configuration`, { settings: { greeting: "Configured by guide" } });
  await learner("PATCH", `/tacons/sdk/${sent.id}/configuration`, { settings: { greeting: "No" } }, 403);
  await guide("PATCH", `/tacons/sdk/${sent.id}/configuration`, { settings: { unknown: "No" } }, 400);
  await learner("POST", `/tacons/view/${sent.id}/submit`, { page: "home", index: 1, values: { title: "No" } }, 403);
  const created = await guide("POST", `/tacons/view/${sent.id}/submit`, { page: "home", index: 1, values: { title: "Preserve this record" } }, 201);
  await guide("POST", `/tacons/view/${sent.id}/submit`, { page: "home", index: 3, values: { title: "Missing personal code" } }, 400);
  await learner("GET", `/tacons/view/${sent.id}/home`);
  await otherLearner("GET", `/tacons/view/${sent.id}/home`, undefined, 404);
  await foreignAdmin("GET", `/tacons/view/${sent.id}/home`, undefined, 404);
  const discovered = (await rpc(admin, sent.id, "extensions.discover")).result;
  assert.ok(discovered.some((entry: any) => entry.id === received.id));
  assert.ok(!discovered.some((entry: any) => [inOtherStudio.id, outsideInstall.id].includes(entry.id)));
  await rpc(admin, sent.id, "events.send", { to: outsideInstall.id, topic: "work.done", payload: {} }, 404);
  await rpc(admin, sent.id, "events.send", { to: inOtherStudio.id, topic: "work.done", payload: {} }, 404);
  await rpc(admin, sent.id, "events.send", { to: received.id, topic: "undeclared", payload: {} }, 403);
  await rpc(admin, sent.id, "events.send", { to: received.id, topic: "work.done", payload: { text: "x".repeat(16001) } }, 413);
  await rpc(learner, sent.id, "events.send", { to: received.id, topic: "work.done", payload: {} }, 403);
  for (let index = 0; index < 2; index++) await rpc(admin, sent.id, "events.send", { to: received.id, topic: "work.done", payload: { index } });
  const first = (await rpc(learner, received.id, "events.read", { limit: 1 })).result;
  assert.equal(first.events.length, 1); assert.equal(first.hasMore, true);
  const second = (await rpc(learner, received.id, "events.read", { after: first.nextCursor, limit: 1 })).result;
  assert.equal(second.events[0].payload.index, 1); assert.equal(second.hasMore, false);
  await admin("POST", `/tacons/sdk/${sent.id}/rpc`, { sdk: 2, page: "home", index: 0, method: "events.read", args: {} }, 400);
  const patch = (values: object) => admin("PATCH", `/tacons/installs/${sent.id}/controls`, { ...review(sender), policy: {}, ...values });
  await patch({ selectedSetup: ["positions"] });
  const [originalSeat] = await countPositions();
  assert.ok(originalSeat && !originalSeat.archived);
  const brokenManifest = { ...sender.manifest, positions: [
    { ...sender.manifest.positions[0], title: "Must roll back this title" },
    { ...sender.manifest.positions[0], name: "broken", seats: "not-an-integer" },
  ] };
  const log = console.error;
  let failure;
  try {
    console.error = () => {}; // Expected fixture-only database failure.
    failure = await executeSetup({ install: sent, tacon: sender.listing, version: sender.version, manifest: brokenManifest, studioName: null }, sent.installedBy);
  } finally { console.error = log; }
  assert.equal(failure[0].status, "failed");
  assert.equal((await countPositions()).length, 1);
  assert.equal((await countPositions())[0].title, originalSeat.title, "A failed setup rolls back earlier host changes.");
  await Promise.all([0, 1].map(() => admin("POST", `/tacons/installs/${sent.id}/setup`, {})));
  assert.equal((await countPositions()).length, 1, "Concurrent retries must not duplicate host seats.");
  await patch({ policy: { view: ["learner"], configure: ["guide"] }, selectedSetup: ["positions"] });
  await guide("GET", `/tacons/view/${sent.id}/home`, undefined, 403);
  const configurationNav = await guide("GET", "/tacons/nav");
  assert.ok(configurationNav.entries.some((entry: any) => entry.installId === sent.id && entry.page === "__configuration"));
  await guide("GET", `/tacons/sdk/${sent.id}/configuration`);
  await patch({ policy: { read: ["admin"], configure: ["none"] }, selectedSetup: ["positions"] });
  await learner("GET", `/tacons/view/${sent.id}/home`, undefined, 403);
  await guide("GET", `/tacons/sdk/${sent.id}/configuration`, undefined, 403);
  await admin("GET", `/tacons/sdk/${sent.id}/configuration`);
  await patch({ grants: sender.manifest.contract.capabilities.filter((cap: string) => cap !== "events.send"), selectedSetup: ["positions"] });
  await rpc(admin, sent.id, "events.send", { to: received.id, topic: "work.done", payload: {} }, 403);
  await patch({ selectedSetup: ["positions"] });
  const next = await publish(admin, sender.listing.slug, "1.1.0");
  await admin("POST", `/tacons/installs/${sent.id}/update`, {}, 409);
  await admin("POST", `/tacons/installs/${sent.id}/update`, review(next, { selectedSetup: ["positions"] }));
  assert.equal((await countPositions()).length, 2);
  assert.equal((await countPositions()).find(position => position.taconPosition === "reviewer")!.id, originalSeat.id);
  const [record] = await db.select().from(taconRecords).where(eq(taconRecords.id, created.id));
  assert.equal(record.data.title, "Preserve this record");
  assert.equal((await admin("GET", `/tacons/sdk/${sent.id}/configuration`)).settings.greeting, "Configured by guide");
  await admin("PATCH", `/tacons/installs/${sent.id}`, { enabled: false });
  await admin("GET", `/tacons/view/${sent.id}/home`, undefined, 404);
  await rpc(admin, sent.id, "events.read", {}, 404);
  assert.ok((await countPositions()).every(position => position.archived));
  await admin("PATCH", `/tacons/installs/${sent.id}`, { enabled: true });
  assert.ok((await countPositions()).every(position => !position.archived));
  await admin("DELETE", `/tacons/installs/${sent.id}`);
  assert.equal((await db.select().from(taconRecords).where(eq(taconRecords.installId, sent.id))).length, 0);
  assert.equal((await db.select().from(taconMessages).where(eq(taconMessages.senderId, sent.id))).length, 0);
  const [archived] = await db.select().from(positions).where(eq(positions.id, originalSeat.id));
  assert.ok(archived.archived); assert.equal(archived.taconInstallId, null);
  const reinstalled = await install(admin, next, studio.id);
  assert.notEqual(reinstalled.id, sent.id);
  assert.equal((await db.select().from(taconRecords).where(eq(taconRecords.installId, reinstalled.id))).length, 0);
  console.log(`PASS: ${checks} API assertions, manifest/version review, optional/idempotent setup, role/academy/studio isolation, configuration recovery, scoped discovery/events/cursors/limits, revocation, native confirmations, data-preserving update, disable/enable, uninstall and reinstall.`);
} finally {
  for (const id of owned.reverse()) await db.delete(academies).where(eq(academies.id, id));
  await pool.end();
}
