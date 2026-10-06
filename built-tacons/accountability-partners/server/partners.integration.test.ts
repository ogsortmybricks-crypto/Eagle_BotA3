import { partnerDefinitions } from "../shared/definition";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { absences, academies, studios, taconInstalls, taconVersions, tacons, taconRecords, users } from "@shared/schema";
import { compile } from "@shared/tacons";
import { addDays, weekStart } from "../shared/partners";
import { db } from "../../../server/db";
import { verificationCodes } from "@shared/schema";
import { hasVerificationCode, resetVerificationCode, setVerificationCode } from "../../../server/verification-code";
import { certifyApAssignment, readPublicApCertificate, renderApWorkspace, revokeApCertificate, saveApAssignment, saveApCategory, saveApProfile } from "./workspace";
import { addRecord, renderPage, type Runtime } from "../../../server/tacons/runtime";
import type { Manifest } from "@shared/tacons";
import { partnerWidget } from "../shared/definition";
import { lookupVerification } from "./legacy-work";
import { attendanceFor, checkVerifyCode, setVerifyCode, clearVerifyCode } from "../../../server/personal";
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

    const source = readFileSync(new URL("../accountability-partners.tacon", import.meta.url), "utf8");
    const compiled = compile(source);
    assert.ok(compiled.ok, JSON.stringify(compiled.diagnostics));
    const manifest = compiled.manifest;
    const def = partnerDefinitions(manifest)[0];
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

    // The generic engine reads both new and already-installed manifests without
    // converting or deleting any package records.
    const newRuntime = runtimeFor(a);
    const newPage = await renderPage(newRuntime, manifest.pages[0]);
    assert.equal(newPage.widgets[0].kind, "extension");
    const legacyManifest = {
      ...manifest,
      extensions: undefined,
      partners: partnerDefinitions(manifest),
      pages: manifest.pages.map(page => ({
        ...page, widgets: page.widgets.map(entry => partnerWidget(entry) ?? entry),
      })),
    } as unknown as Manifest;
    const oldRuntime = { ...newRuntime, install: { ...newRuntime.install, manifest: legacyManifest } };
    const oldPage = await renderPage(oldRuntime, legacyManifest.pages[0]);
    assert.deepEqual(oldPage.widgets, newPage.widgets);

    // Incoming compatibility APIs share the core credential authority.
    await setVerifyCode(a.id, "246810");
    assert.equal(await hasVerificationCode(a.id), true);
    await checkVerifyCode(a.id, "246810");
    await assert.rejects(() => checkVerifyCode(a.id, "000000"), /doesn't match/);
    await clearVerifyCode(a.id);
    assert.equal(await hasVerificationCode(a.id), false);
    await db.insert(absences).values({ academyId: academyId!, userId: a.id, day: today, kind: "sick", note: "Private absence" });
    const attendance = await attendanceFor([a.id], today, today);
    assert.deepEqual(attendance.get(a.id)?.days, [1, 2, 3, 4, 5]);
    assert.equal(attendance.get(a.id)?.absences[0]?.day, today);
    const oldToken = randomUUID().replaceAll("-", "").slice(0, 24);
    await db.insert(taconRecords).values({
      academyId: academyId!, installId: install.id, store: "__partners_ap_completions",
      createdByType: "user", createdBy: b.id,
      data: { token: oldToken, status: "confirmed", excellence: true,
        personId: a.id, confirmerId: b.id, title: "Legacy work", category: "Quest",
        week: weekStart(today), confirmedAt: new Date().toISOString(),
        apNotes: "Private review note", notes: "Private work evidence" },
    });
    const oldCertificate = await lookupVerification(oldToken);
    assert.equal(oldCertificate?.assignment, "Legacy work");
    assert.equal(JSON.stringify(oldCertificate).includes("Private"), false);

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

    // Additive pairing saves cannot erase a pair absent from a draft.
    const initialRevision = (await renderPartners(runtimeFor(admin), widget, 0))!.manage!.revision;
    const merge = await savePairings(runtimeFor(admin), def, [[secretary.id, learnerAdmin.id]], admin.id,
      { mode: "merge", removedGroupIds: [], expectedGroupIds: initialRevision });
    assert.equal(merge.ended, 0);
    assert.equal((await renderPartners(runtimeFor(a), widget, 0))!.group!.id, bView!.group!.id);
    await assert.rejects(() => savePairings(runtimeFor(admin), def, [], admin.id,
      { mode: "merge", removedGroupIds: initialRevision, expectedGroupIds: initialRevision }), /changed while/);

    // Every admin, including learner admins, plans weekly work; guides only review.
    const category = await saveApCategory(runtimeFor(learnerAdmin), def, { name: "Art" });
    await assert.rejects(() => saveApCategory(runtimeFor(a), def, { name: "Not allowed" }), /Only admins/);
    await assert.rejects(() => saveApCategory(runtimeFor(guide), def, { name: "Not allowed" }), /Only admins/);
    await assert.rejects(() => saveApCategory(runtimeFor(admin), def, { name: "Quest" }), /already exists/);
    const assignmentInput = { week: monday, category: "Writers' Workshop", title: "Personal narrative",
      description: "Publish a revised narrative.", dueDate: addDays(monday, 4), archived: false };
    const assignment = await saveApAssignment(runtimeFor(admin), def, assignmentInput);
    const art = await saveApAssignment(runtimeFor(learnerAdmin), def, { ...assignmentInput, category: category.name, title: "Sketch" });
    await assert.rejects(() => saveApAssignment(runtimeFor(admin), def, { ...assignmentInput, week: today === monday ? addDays(monday, 1) : today }), /Monday week/);
    await assert.rejects(() => saveApAssignment(runtimeFor(admin), def, { ...assignmentInput, dueDate: addDays(monday, 7) }), /due date/);

    // Attendance and dated milestones are private to the learner and their pair/staff.
    await saveApProfile(runtimeFor(b), def, {
      attendanceDays: [1, 2, 3, 4, 5],
      absences: [{ date: today, reason: "sick", notes: "Resting" }],
      milestones: [{ id: "algebra", date: today, title: "Complete Khan Academy Algebra 1", notes: "All units" }],
    });
    assert.equal((await renderApWorkspace(runtimeFor(a), def)).profiles[0].personId, b.id);
    assert.equal((await renderApWorkspace(runtimeFor(c), def)).profiles.length, 0);
    assert.equal((await renderApWorkspace(runtimeFor(guide), def)).profiles.length, 1);
    await assert.rejects(() => saveApProfile(runtimeFor(a), def, { attendanceDays: [8], absences: [], milestones: [] }), /attendance/);

    // A private main-account code is reusable; no code or hash appears on the wire.
    assert.equal(await hasVerificationCode(a.id), false);
    await setVerificationCode(a.id, "473829");
    assert.equal(await hasVerificationCode(a.id), true);
    await assert.rejects(() => setVerificationCode(a.id, "123456"), /doesn't match/);
    await setVerificationCode(a.id, "572941", "473829");
    const certify = { assignmentId: assignment.id, targetId: b.id, completedDate: today,
      excellence: true, notes: "Thoughtful revision.", evidence: "Reviewed the finished essay together.", code: "572941" };
    await assert.rejects(() => certifyApAssignment(runtimeFor(a), def, { ...certify, targetId: a.id }), /cannot certify yourself/);
    await assert.rejects(() => certifyApAssignment(runtimeFor(a), def, { ...certify, targetId: c.id }), /current AP/);
    await assert.rejects(() => certifyApAssignment(runtimeFor(a), def, { ...certify, code: "999999" }), /doesn't match/);
    await assert.rejects(() => certifyApAssignment(runtimeFor(a), def, { ...certify, evidence: "" }), /work you reviewed/);
    const certificates = await Promise.all([certifyApAssignment(runtimeFor(a), def, certify), certifyApAssignment(runtimeFor(a), def, certify)]);
    assert.equal(certificates[0].id, certificates[1].id, "concurrent retry keeps one certificate");
    const certificate = certificates[0];
    assert.match(certificate.token, /^[a-f0-9]{64}$/);
    const publicCertificate = await readPublicApCertificate(certificate.token);
    assert.equal(publicCertificate!.excellence, true);
    assert.equal(publicCertificate!.learnerName, b.name);
    for (const secret of ["hash", "code", "notes", "evidence", "absences"]) assert.equal(Object.hasOwn(publicCertificate!, secret), false);
    const learnerWorkspace = await renderApWorkspace(runtimeFor(a), def);
    assert.equal(learnerWorkspace.hasCode, true);
    assert.ok(!JSON.stringify(learnerWorkspace).includes("572941"));
    assert.equal((await renderApWorkspace(runtimeFor(c), def)).certificates.length, 0);
    assert.equal((await renderApWorkspace(runtimeFor(guide), def)).certificates.length, 1);
    await assert.rejects(() => saveApAssignment(runtimeFor(admin), def, { ...assignmentInput, id: assignment.id, title: "Altered after review" }), /cannot be rewritten/);
    await assert.rejects(() => revokeApCertificate(runtimeFor(c), def, certificate.id), /Only the certifying AP/);
    await revokeApCertificate(runtimeFor(admin), def, certificate.id);
    assert.equal((await readPublicApCertificate(certificate.token))!.revoked, true);
    const ordinary = await certifyApAssignment(runtimeFor(a), def, { ...certify, excellence: false });
    assert.equal((await readPublicApCertificate(ordinary.token))!.excellence, false);
    assert.equal(await readPublicApCertificate("invalid"), null);

    // Incorrect code counters survive transaction rollback and limit guessing.
    await resetVerificationCode(a.id);
    await setVerificationCode(a.id, "572941");
    for (let attempt = 0; attempt < 5; attempt++) {
      await assert.rejects(() => certifyApAssignment(runtimeFor(a), def, { ...certify, assignmentId: art.id, code: "000000" }), /match|Too many/);
    }
    await assert.rejects(() => certifyApAssignment(runtimeFor(a), def, { ...certify, assignmentId: art.id }), /15 minutes/);
    const [locked] = await db.select().from(verificationCodes).where(eq(verificationCodes.userId, a.id));
    assert.equal(locked.failures, 5);
    assert.ok(locked.lockedUntil);
    await resetVerificationCode(a.id);
    await setVerificationCode(a.id, "572941");

    // Hide an assignment without erasing its verification record.
    await saveApAssignment(runtimeFor(admin), def, { ...assignment, archived: true });
    assert.ok(await readPublicApCertificate(ordinary.token));
    await assert.rejects(() => certifyApAssignment(runtimeFor(a), def, certify), /archived/);

    // Re-pairing keeps unchanged groups and history; trios are allowed.
    result = await savePairings(runtimeFor(admin), def, [[d.id, c.id], [b.id, a.id]], admin.id);
    assert.deepEqual(result, { kept: 2, started: 0, ended: 1 });
    result = await savePairings(runtimeFor(guide), def, [[a.id, c.id, d.id]], guide.id);
    assert.deepEqual(result, { kept: 0, started: 1, ended: 2 });
    const aLater = await renderPartners(runtimeFor(a), widget, 0);
    assert.equal(aLater?.group?.members.length, 3);
    assert.equal(aLater?.checkins.length, 1, "history with Ben survives the re-pairing");
    assert.ok(aLater!.historyGroups.some(group => !group.active && group.members.some(member => member.id === b.id)));
    assert.ok(aLater!.workspace.certificates.some(cert => cert.id === ordinary.id), "past certificates stay in the old pair folder");
    assert.equal((await renderPartners(runtimeFor(b), widget, 0))?.group, null);
    await assert.rejects(() => saveCheckin(runtimeFor(a), def, a.id, input), /current accountability partner/);

    // Generic Tac-On writes cannot touch built-in records.
    const write = await addRecord(runtimeFor(admin), "__partners_ap_checkins", {}, { type: "user", userId: admin.id });
    assert.equal(write.ok, false);
  } finally {
    if (academyId !== undefined) await db.delete(academies).where(eq(academies.id, academyId));
  }
});
