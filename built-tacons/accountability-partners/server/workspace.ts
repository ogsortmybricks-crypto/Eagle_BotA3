import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { academies, taconRecords, users } from "@shared/schema";
import type { PartnersDef } from "../shared/definition";
import { addDays, isDay, partnersStore, weekday, type PartnersStoreKind } from "../shared/partners";
import { AP_CATEGORIES, type ApAssignment, type ApCertificate, type ApProfile, type ApPublicCertificate, type ApWorkspace } from "../shared/workspace";
import type { Runtime } from "../../../server/tacons/runtime";
import { canBePartner, canManagePartners, PartnersError } from "./partners";
import { hasVerificationCode, resetVerificationCode, setVerificationCode, verifyUserCode } from "../../../server/verification-code";

type Row = typeof taconRecords.$inferSelect;
const values = (row: Row) => row.data ?? {};
const members = (row: Row): number[] => Array.isArray(values(row).members) ? values(row).members as number[] : [];
const filter = (runtime: Runtime, def: PartnersDef, kind: PartnersStoreKind) => and(
  eq(taconRecords.academyId, runtime.academyId),
  eq(taconRecords.installId, runtime.install.install.id),
  eq(taconRecords.store, partnersStore(def.name, kind)),
);
async function read(runtime: Runtime, def: PartnersDef, kind: PartnersStoreKind): Promise<Row[]> {
  return db.select().from(taconRecords).where(filter(runtime, def, kind)).orderBy(desc(taconRecords.createdAt));
}
async function lock(tx: any, runtime: Runtime, def: PartnersDef) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tacon-partners:${runtime.install.install.id}:${def.name}`}, 0))`);
}
async function insert(tx: any, runtime: Runtime, def: PartnersDef, kind: PartnersStoreKind, data: Record<string, unknown>): Promise<Row> {
  const [row] = await tx.insert(taconRecords).values({
    academyId: runtime.academyId, installId: runtime.install.install.id,
    store: partnersStore(def.name, kind), createdByType: "user", createdBy: runtime.user!.id, data,
  }).returning();
  return row;
}
async function write(tx: any, row: Row, data: Record<string, unknown>): Promise<Row> {
  const [updated] = await tx.update(taconRecords).set({ data, updatedAt: new Date() })
    .where(eq(taconRecords.id, row.id)).returning();
  return updated;
}
export const canPlanAp = (runtime: Runtime) => runtime.user?.role === "admin";
export const canReviewAp = (runtime: Runtime, def: PartnersDef) =>
  canManagePartners(runtime, def) || runtime.user?.role === "guide" || runtime.user?.role === "admin";
function plan(runtime: Runtime) {
  if (!canPlanAp(runtime)) throw new PartnersError("Only admins, including learner admins, can plan assignments.");
}
function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function assignmentView(row: Row): ApAssignment { return { ...values(row), id: row.id } as ApAssignment; }
function certificateView(row: Row): ApCertificate {
  const { academyName: _academy, ...publicToPair } = values(row);
  return { ...publicToPair, id: row.id } as ApCertificate;
}
export async function renderApWorkspace(runtime: Runtime, def: PartnersDef): Promise<ApWorkspace> {
  const [groupRows, categoryRows, assignmentRows, certificateRows, profileRows, hasCode] = await Promise.all([
    read(runtime, def, "groups"), read(runtime, def, "categories"), read(runtime, def, "assignments"),
    read(runtime, def, "certificates"), read(runtime, def, "profiles"),
    runtime.user ? hasVerificationCode(runtime.user.id) : Promise.resolve(false),
  ]);
  const review = canReviewAp(runtime, def);
  const visibleGroups = groupRows.filter(row => review || members(row).includes(runtime.user?.id ?? 0));
  const groupIds = new Set(visibleGroups.map(row => row.id));
  const people = new Set([runtime.user?.id ?? 0, ...visibleGroups.flatMap(members)]);
  return {
    canPlan: canPlanAp(runtime), canReviewAll: review, hasCode,
    categories: [
      ...AP_CATEGORIES.map(name => ({ id: 0, name, archived: false })),
      ...categoryRows.map(row => ({ id: row.id, name: String(values(row).name), archived: values(row).archived === true })),
    ],
    assignments: assignmentRows.map(assignmentView),
    certificates: certificateRows.filter(row => review || groupIds.has(Number(values(row).groupId))).map(certificateView),
    profiles: profileRows.filter(row => people.has(Number(values(row).personId))).map(row => values(row) as ApProfile),
  };
}

export async function saveApCategory(runtime: Runtime, def: PartnersDef, input: { id?: number; name: string; archived?: boolean }) {
  plan(runtime);
  const name = text(input.name, 60);
  if (!name) throw new PartnersError("Give the category a name.");
  return db.transaction(async tx => {
    await lock(tx, runtime, def);
    const current = await tx.select().from(taconRecords).where(filter(runtime, def, "categories"));
    if (AP_CATEGORIES.some(n => n.toLowerCase() === name.toLowerCase()) ||
      current.some(row => row.id !== input.id && String(values(row).name).toLowerCase() === name.toLowerCase())) {
      throw new PartnersError("That category already exists.");
    }
    const row = current.find(row => row.id === input.id);
    if (input.id && !row) throw new PartnersError("That category isn't available here.");
    if (row && name !== values(row).name) {
      const assignments = await tx.select().from(taconRecords).where(filter(runtime, def, "assignments"));
      if (assignments.some(a => values(a).category === values(row).name)) {
        throw new PartnersError("Categories with assignments cannot be renamed; add a new category instead.");
      }
    }
    const data = { name, archived: input.archived ?? false };
    const result = row ? await write(tx, row, data) : await insert(tx, runtime, def, "categories", data);
    return { id: result.id, ...data };
  });
}

export async function saveApAssignment(runtime: Runtime, def: PartnersDef, input: Omit<ApAssignment, "id"> & { id?: number }) {
  plan(runtime);
  if (!isDay(input.week) || weekday(input.week) !== 1 || !isDay(input.dueDate) ||
    input.dueDate < input.week || input.dueDate > addDays(input.week, 6)) {
    throw new PartnersError("Choose a Monday week and a due date within that week.");
  }
  const title = text(input.title, 160);
  const category = text(input.category, 60);
  if (!title) throw new PartnersError("Give the assignment a title.");
  return db.transaction(async tx => {
    await lock(tx, runtime, def);
    const categories = await tx.select().from(taconRecords).where(filter(runtime, def, "categories"));
    const existingRows = await tx.select().from(taconRecords).where(filter(runtime, def, "assignments"));
    const row = existingRows.find(row => row.id === input.id);
    if (input.id && !row) throw new PartnersError("That assignment isn't available here.");
    const knownCategory = AP_CATEGORIES.includes(category as any) ||
      categories.some(row => values(row).name === category && !values(row).archived);
    if (!knownCategory && !(row && values(row).category === category)) {
      throw new PartnersError("Choose an active assignment category.");
    }
    const data = { week: input.week, category, title, description: text(input.description, 2000),
      dueDate: input.dueDate, archived: input.archived };
    if (row) {
      const certificates = await tx.select().from(taconRecords).where(filter(runtime, def, "certificates"));
      if (certificates.some(c => values(c).assignmentId === row.id && !values(c).revoked)) {
        const before = values(row);
        if (["week", "category", "title", "description", "dueDate"].some(key => before[key] !== data[key as keyof typeof data])) {
          throw new PartnersError("Certified assignments cannot be rewritten. Archive this assignment and create a new one.");
        }
      }
    }
    return assignmentView(row ? await write(tx, row, data) : await insert(tx, runtime, def, "assignments", data));
  });
}

export async function saveApProfile(runtime: Runtime, def: PartnersDef, input: Omit<ApProfile, "personId">) {
  if (!runtime.user) throw new PartnersError("Sign in first.");
  if (!Array.isArray(input.attendanceDays) || input.attendanceDays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new PartnersError("Choose valid attendance days.");
  }
  if (input.absences.some(a => !isDay(a.date) || !["sick", "other"].includes(a.reason)) ||
    input.milestones.some(m => !isDay(m.date) || !text(m.title, 160))) {
    throw new PartnersError("Absences and milestones need valid dates and titles.");
  }
  if (new Set(input.absences.map(a => a.date)).size !== input.absences.length ||
    new Set(input.milestones.map(m => m.id)).size !== input.milestones.length) {
    throw new PartnersError("Each absence date and milestone ID must be unique.");
  }
  const data = {
    personId: runtime.user.id, attendanceDays: [...new Set(input.attendanceDays)].sort(),
    absences: input.absences.map(a => ({ date: a.date, reason: a.reason, notes: text(a.notes, 500) })),
    milestones: input.milestones.map(m => ({ id: text(m.id, 80), date: m.date, title: text(m.title, 160), notes: text(m.notes, 500) })),
  };
  return db.transaction(async tx => {
    await lock(tx, runtime, def);
    const current = await tx.select().from(taconRecords).where(filter(runtime, def, "profiles"));
    const row = current.find(row => values(row).personId === runtime.user!.id);
    await (row ? write(tx, row, data) : insert(tx, runtime, def, "profiles", data));
    return data;
  });
}

export async function saveApCode(runtime: Runtime, def: PartnersDef, code: string, currentCode?: string) {
  if (!runtime.user || !/^\d{6}$/.test(code)) throw new PartnersError("Choose exactly six digits.");
  try { await setVerificationCode(runtime.user.id, code, currentCode); }
  catch (error) { throw new PartnersError(error instanceof Error ? error.message : "Couldn't save code."); }
}
export async function resetApCode(runtime: Runtime, def: PartnersDef, personId: number) {
  plan(runtime);
  const [person] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, personId), eq(users.academyId, runtime.academyId)));
  if (!person) throw new PartnersError("That user isn't in this academy.");
  await resetVerificationCode(personId);
}

export type CertificationInput = {
  assignmentId: number; targetId: number; completedDate: string; excellence: boolean;
  notes: string; evidence: string; code: string;
};
export async function certifyApAssignment(runtime: Runtime, def: PartnersDef, input: CertificationInput): Promise<ApCertificate> {
  const checker = runtime.user;
  if (!checker || checker.id === input.targetId) throw new PartnersError("Your AP must certify your work; you cannot certify yourself.");
  const today = new Date().toISOString().slice(0, 10);
  if (!isDay(input.completedDate) || input.completedDate > addDays(today, 1)) {
    throw new PartnersError("Choose a valid completion date, not a future date.");
  }
  const evidence = text(input.evidence, 2000);
  if (!evidence) throw new PartnersError("Describe the work you reviewed or include its link.");
  const result = await db.transaction(async tx => {
    await lock(tx, runtime, def);
    const groups = await tx.select().from(taconRecords).where(filter(runtime, def, "groups"));
    const group = groups.find(row => values(row).active && members(row).includes(checker.id) && members(row).includes(input.targetId));
    if (!group) throw new PartnersError("You may only certify work for your current AP.");
    const participants = await tx.select().from(users).where(and(
      eq(users.academyId, runtime.academyId), eq(users.active, true), inArray(users.id, [checker.id, input.targetId]),
    ));
    if (participants.length !== 2 || participants.some(person => !canBePartner(person))) {
      throw new PartnersError("Both people must be active, eligible AP learners.");
    }
    const assignments = await tx.select().from(taconRecords).where(filter(runtime, def, "assignments"));
    const assignment = assignments.find(row => row.id === input.assignmentId && !values(row).archived);
    if (!assignment) throw new PartnersError("That assignment is archived or unavailable.");
    if (input.completedDate < String(values(assignment).week)) throw new PartnersError("Completion cannot be before the assignment week.");
    const codeError = await verifyUserCode(tx, checker.id, input.code);
    if (codeError) return { error: codeError };
    const certs = await tx.select().from(taconRecords).where(filter(runtime, def, "certificates"));
    const prior = certs.find(row => values(row).assignmentId === assignment.id && values(row).learnerId === input.targetId && !values(row).revoked);
    if (prior) {
      const v = values(prior);
      if (v.checkerId === checker.id && v.excellence === input.excellence && v.notes === text(input.notes, 2000) &&
        v.evidence === evidence && v.completedDate === input.completedDate) return { certificate: certificateView(prior) };
      throw new PartnersError("This work is already certified. Revoke the old certificate before correcting it.");
    }
    const a = assignmentView(assignment);
    const [academy] = await tx.select({ name: academies.name }).from(academies).where(eq(academies.id, runtime.academyId));
    const data = {
      assignmentId: a.id, groupId: group.id, learnerId: input.targetId,
      learnerName: runtime.people.get(input.targetId) ?? "Learner", checkerId: checker.id, checkerName: checker.name,
      assignmentTitle: a.title, category: a.category, week: a.week, completedDate: input.completedDate,
      certifiedAt: new Date().toISOString(), excellence: input.excellence, notes: text(input.notes, 2000),
      evidence, token: randomBytes(32).toString("hex"), revoked: false, academyName: academy?.name ?? "Academy",
    };
    return { certificate: certificateView(await insert(tx, runtime, def, "certificates", data)) };
  });
  if (result.error) throw new PartnersError(result.error);
  return result.certificate!;
}
export async function revokeApCertificate(runtime: Runtime, def: PartnersDef, id: number) {
  return db.transaction(async tx => {
    await lock(tx, runtime, def);
    const rows = await tx.select().from(taconRecords).where(filter(runtime, def, "certificates"));
    const row = rows.find(row => row.id === id);
    if (!row) throw new PartnersError("That certificate isn't available.");
    if (!canPlanAp(runtime) && values(row).checkerId !== runtime.user?.id) {
      throw new PartnersError("Only the certifying AP or an admin can revoke this certificate.");
    }
    return certificateView(await write(tx, row, { ...values(row), revoked: true, revokedAt: new Date().toISOString() }));
  });
}
export async function readPublicApCertificate(token: string): Promise<ApPublicCertificate | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const [row] = await db.select().from(taconRecords).where(and(
    sql`${taconRecords.store} LIKE '__partners_%_certificates'`,
    sql`${taconRecords.data}->>'token' = ${token}`,
  )).limit(1);
  if (!row) return null;
  const data = values(row);
  return {
    learnerName: String(data.learnerName), checkerName: String(data.checkerName),
    assignmentTitle: String(data.assignmentTitle), category: String(data.category),
    week: String(data.week), completedDate: String(data.completedDate), certifiedAt: String(data.certifiedAt),
    excellence: data.excellence === true, revoked: data.revoked === true, academyName: String(data.academyName),
  };
}
