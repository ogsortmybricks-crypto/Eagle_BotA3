import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { academies, studios, taconInstalls, taconVersions, tacons, users } from "@shared/schema";
import { compile } from "@shared/tacons";
import { addDays, weekStart } from "@shared/tacons/partners";
import { db } from "../db";
import { addRecord, type Runtime } from "./runtime";
import {
  readShot,
  renderPartners,
  saveCheckin,
  saveGoals,
  savePairings,
  uploadShot,
} from "./partners";

const runDatabaseTests =
  process.env.NODE_ENV === "development" &&
  process.env.RUN_TACON_PARTNERS_DB_TESTS === "true";

// A 1x1 PNG.
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

test("accountability partners: pairings, goals, check-ins and screenshot privacy", {
  skip: !runDatabaseTests
    ? "Set NODE_ENV=development and RUN_TACON_PARTNERS_DB_TESTS=true against an isolated development database."
    : false,
}, async () => {
  const key = randomUUID();
  let academyId: number | undefined;
  try {
    const [academy] = await db.insert(academies).values({
      name: `Transient partners test ${key}`,
      emailDomain: `${key}.partners.invalid`,
      palette: { primary: "#000000", accent: "#ffffff", surface: "#ffffff" },
    }).returning();
    academyId = academy.id;
    const [studio] = await db.insert(studios).values({ academyId, name: "Studio", slug: `ap-${key}` }).returning();
    const person = async (
      name: string,
      role: "admin" | "guide" | "secretary" | "learner",
      studioId: number | null,
      learnerAdmin = false,
    ) => {
      const [row] = await db.insert(users).values({
        academyId: academyId!, studioId, email: `${name.replace(/\s/g, "")}-${key}@partners.invalid`, name, role, learnerAdmin,
      }).returning();
      return row;
    };
    const admin = await person("Ada Admin", "admin", null);
    const guide = await person("Gus Guide", "guide", null);
    const secretary = await person("Sal Secretary", "secretary", studio.id);
    const learnerAdmin = await person("Lou Learner Admin", "admin", studio.id, true);
    const [a, b, c, d] = await Promise.all(
      ["Ana", "Ben", "Cam", "Dee"].map((name) => person(name, "learner", studio.id)),
    );

    const source = readFileSync(new URL("../../built-tacons/accountability-partners/accountability-partners.tacon", import.meta.url), "utf8");
    const compiled = compile(source);
    assert.ok(compiled.ok, JSON.stringify(compiled.diagnostics));
    const manifest = compiled.manifest;
    const def = manifest.partners![0];
    const [tacon] = await db.insert(tacons).values({
      slug: `transient-ap-${key}`, name: "Transient AP", academyId, authorUserId: admin.id,
    }).returning();
    const [version] = await db.insert(taconVersions).values({
      taconId: tacon.id, version: "1.0.0", source, manifest: manifest as unknown as Record<string, unknown>,
    }).returning();
    const [install] = await db.insert(taconInstalls).values({
      academyId, studioId: studio.id, taconId: tacon.id, versionId: version.id, installedBy: admin.id,
    }).returning();

    const everyone = [admin, guide, secretary, learnerAdmin, a, b, c, d];
    const runtimeFor = (user: typeof admin): Runtime => ({
      academyId,
      user,
      scope: {
        studioId: studio.id, studio, allowed: [studio], allowedIds: [studio.id], circleIds: [studio.id],
        readableIds: [studio.id], canSeeAll: user.role === "admin", canWriteShared: false, effective: {} as never,
      },
      settings: {} as never,
      install: { install, tacon, version, manifest, studioName: studio.name },
      uses: new Map(), rows: new Map(), computed: new Map(), resolving: new Set(),
      people: new Map(everyone.map((entry) => [entry.id, entry.name])),
      held: new Set(),
      positions: {},
    } as unknown as Runtime);
    const widget = { kind: "partners" as const, partners: "ap" };
    const today = new Date().toISOString().slice(0, 10);

    // The first screen: nothing paired, the admin manages, a learner waits.
    const adminView = await renderPartners(runtimeFor(admin), widget, 0);
    assert.ok(adminView?.manage);
    // Learners, secretaries and learner admins can be APs; guides and staff admins can't.
    assert.deepEqual(
      adminView.manage.candidates.map((p) => p.name),
      ["Ana", "Ben", "Cam", "Dee", "Lou Learner Admin", "Sal Secretary"],
    );
    const learnerView = await renderPartners(runtimeFor(a), widget, 0);
    assert.equal(learnerView?.manage, null);
    assert.equal(learnerView?.group, null);

    // Pairing rules.
    await assert.rejects(() => savePairings(runtimeFor(admin), def, [[a.id, b.id], [b.id, c.id]], admin.id), /more than one group/);
    await assert.rejects(() => savePairings(runtimeFor(admin), def, [[a.id, admin.id]], admin.id), /can't be an AP/);
    await assert.rejects(() => savePairings(runtimeFor(admin), def, [[a.id, guide.id]], admin.id), /can't be an AP/);
    await assert.rejects(() => savePairings(runtimeFor(admin), def, [[a.id, b.id, c.id, d.id]], admin.id), /at most three/);
    const learnerStaff = await savePairings(runtimeFor(admin), def, [[secretary.id, learnerAdmin.id]], admin.id);
    assert.deepEqual(learnerStaff, { kept: 0, started: 1, ended: 0 });

    let result = await savePairings(runtimeFor(admin), def, [[a.id, b.id], [c.id, d.id]], admin.id);
    assert.deepEqual(result, { kept: 0, started: 2, ended: 1 });

    // Goals and a check-in.
    const monday = weekStart(today);
    await assert.rejects(() => saveGoals(runtimeFor(a), def, { personId: a.id, week: addDays(monday, 1), goals: {} }), /this week or next/);
    await saveGoals(runtimeFor(b), def, { personId: b.id, week: monday, goals: { Math: "3 units", Reading: "100 pages", Bogus: "x" } });

    const shot = await uploadShot(runtimeFor(a), def, a.id, PIXEL);
    await assert.rejects(() => uploadShot(runtimeFor(a), def, a.id, "data:text/html;base64,PGgxPg=="), /PNG, JPEG or WebP/);
    const input = {
      targetId: b.id, date: today,
      core: [{ subject: "Math", goal: "3 units", progress: "1 unit done", percent: 33 }],
      evidence: [{ subject: "Quest", notes: "Prototype half built", shots: [shot] }],
      onTrack: "slightly-behind" as const, notes: "Needs to finish the essay",
    };
    await assert.rejects(() => saveCheckin(runtimeFor(a), def, a.id, { ...input, targetId: c.id }), /current accountability partner/);
    await assert.rejects(() => saveCheckin(runtimeFor(a), def, a.id, { ...input, targetId: a.id }), /not yourself/);
    await assert.rejects(() => saveCheckin(runtimeFor(a), def, a.id, { ...input, date: "2020-01-03" }), /day they happen/);
    const cShot = await uploadShot(runtimeFor(c), def, c.id, PIXEL);
    await assert.rejects(
      () => saveCheckin(runtimeFor(a), def, a.id, { ...input, evidence: [{ subject: "Quest", notes: "", shots: [cShot] }] }),
      /isn't yours/,
    );
    const first = await saveCheckin(runtimeFor(a), def, a.id, input);
    assert.equal(first.updated, false);
    const again = await saveCheckin(runtimeFor(a), def, a.id, { ...input, onTrack: "on-track" });
    assert.equal(again.updated, true);
    assert.equal(again.id, first.id);

    // Who sees what.
    const bView = await renderPartners(runtimeFor(b), widget, 0);
    assert.equal(bView?.checkins.length, 1);
    assert.equal(bView?.checkins[0].onTrack, "on-track");
    assert.deepEqual(bView?.goals.find((g) => g.personId === b.id)?.goals, { Math: "3 units", Reading: "100 pages" });
    const cView = await renderPartners(runtimeFor(c), widget, 0);
    assert.equal(cView?.checkins.length, 0);
    assert.equal(cView?.goals.length, 0);
    assert.ok(await readShot(runtimeFor(b), def, shot));
    assert.ok(await readShot(runtimeFor(guide), def, shot));
    assert.equal(await readShot(runtimeFor(c), def, shot), null);

    // Re-pairing keeps unchanged groups and history; trios are allowed.
    result = await savePairings(runtimeFor(admin), def, [[d.id, c.id], [b.id, a.id]], admin.id);
    assert.deepEqual(result, { kept: 2, started: 0, ended: 0 });
    result = await savePairings(runtimeFor(guide), def, [[a.id, c.id, d.id]], guide.id);
    assert.deepEqual(result, { kept: 0, started: 1, ended: 2 });
    const aLater = await renderPartners(runtimeFor(a), widget, 0);
    assert.equal(aLater?.group?.members.length, 3);
    assert.equal(aLater?.checkins.length, 1, "history with Ben survives the re-pairing");
    assert.equal((await renderPartners(runtimeFor(b), widget, 0))?.group, null);
    await assert.rejects(() => saveCheckin(runtimeFor(a), def, a.id, input), /current accountability partner/);

    // Generic Tac-On writes cannot touch built-in records.
    const write = await addRecord(runtimeFor(admin), "__partners_ap_checkins", {}, { type: "user", userId: admin.id });
    assert.equal(write.ok, false);
  } finally {
    if (academyId !== undefined) await db.delete(academies).where(eq(academies.id, academyId));
  }
});
