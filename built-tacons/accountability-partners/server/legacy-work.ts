/**
 * Accountability partners, part two: the week's assignments, certifying a
 * partner's work, milestones, and the records browser.
 *
 * The flow for one assignment: an admin or guide puts it on the week. Bob does
 * it and submits his work (a note and screenshots). Joey, his AP, looks at it
 * and either sends it back or confirms it - saying whether it was done with
 * Excellence and signing with his six-digit code. Excellence gets a public
 * verification link Bob pastes into Journey Tracker.
 */

import { randomBytes } from "node:crypto";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { academies, taconRecords, users } from "@shared/schema";
import type { PartnersDef } from "../shared/definition";
import { addDays, isDay, partnersStore, weekStart, SHOTS_PER_SUBJECT } from "../shared/legacy-partners";
import type {
  PartnerAssignment,
  PartnerAttendance,
  PartnerCheckin,
  PartnerCompletion,
  PartnerGoals,
  PartnerGroup,
  PartnerMilestone,
} from "../shared/legacy-view";
import { attendanceFor, checkVerifyCode, VerifyCodeError } from "../../../server/personal";
import { hasVerificationCode } from "../../../server/verification-code";
import type { Runtime } from "../../../server/tacons/runtime";
import {
  PartnersError,
  activeGroupOf,
  canManagePartners,
  data,
  ids,
  integer,
  lock,
  rows,
  rowsQuery,
  string,
  type Row,
} from "./legacy-pairs";

function insertValues(runtime: Runtime, def: PartnersDef, kind: Parameters<typeof partnersStore>[1], actorId: number, values: Record<string, unknown>) {
  return {
    academyId: runtime.academyId,
    installId: runtime.install.install.id,
    store: partnersStore(def.name, kind),
    createdByType: "user" as const,
    createdBy: actorId,
    data: values,
  };
}

async function one(runtime: Runtime, def: PartnersDef, kind: Parameters<typeof partnersStore>[1], id: number): Promise<Row | null> {
  const [row] = await db.select().from(taconRecords).where(and(rowsQuery(runtime, def, kind), eq(taconRecords.id, id))).limit(1);
  return row ?? null;
}

function requireManager(runtime: Runtime, def: PartnersDef) {
  if (!canManagePartners(runtime, def)) throw new PartnersError("Only admins and guides can plan the week.");
}

/* -------------------------------------------------------------------------- */
/*  Categories                                                                 */
/* -------------------------------------------------------------------------- */

export async function customCategories(runtime: Runtime, def: PartnersDef): Promise<{ id: number; name: string }[]> {
  return (await rows(runtime, def, "categories"))
    .map((row) => ({ id: row.id, name: string(data(row).name, 40) }))
    .filter((entry) => entry.name)
    .reverse();
}

export async function addCategory(runtime: Runtime, def: PartnersDef, name: string, actorId: number): Promise<void> {
  requireManager(runtime, def);
  const clean = string(name, 40);
  if (!clean) throw new PartnersError("Give the category a name.");
  const existing = [...def.evidence, ...(await customCategories(runtime, def)).map((entry) => entry.name)];
  if (existing.some((entry) => entry.toLowerCase() === clean.toLowerCase())) {
    throw new PartnersError(`There's already a ${clean} category.`);
  }
  if (existing.length >= 12) throw new PartnersError("That's plenty of categories. Remove one first.");
  await db.insert(taconRecords).values(insertValues(runtime, def, "categories", actorId, { name: clean }));
}

/** Removing a category keeps its past assignments and certifications; it just stops being offered. */
export async function removeCategory(runtime: Runtime, def: PartnersDef, id: number): Promise<void> {
  requireManager(runtime, def);
  await db.delete(taconRecords).where(and(rowsQuery(runtime, def, "categories"), eq(taconRecords.id, id)));
}

/* -------------------------------------------------------------------------- */
/*  Assignments                                                                */
/* -------------------------------------------------------------------------- */

function assignmentView(row: Row): PartnerAssignment {
  const values = data(row);
  return {
    id: row.id,
    week: String(values.week ?? ""),
    category: string(values.category, 40),
    title: string(values.title, 200),
    details: string(values.details, 1000),
  };
}

export type AssignmentInput = { id?: number; week: string; category: string; title: string; details: string };

export async function saveAssignment(runtime: Runtime, def: PartnersDef, input: AssignmentInput, actorId: number): Promise<number> {
  requireManager(runtime, def);
  if (!isDay(input.week) || weekStart(input.week) !== input.week) throw new PartnersError("Pick a week.");
  const categories = [...def.evidence, ...(await customCategories(runtime, def)).map((entry) => entry.name)];
  if (!categories.includes(input.category)) throw new PartnersError("Pick one of the categories.");
  const title = string(input.title, 200);
  if (!title) throw new PartnersError("Give the assignment a name.");
  const values = { week: input.week, category: input.category, title, details: string(input.details, 1000) };
  if (input.id) {
    const row = await one(runtime, def, "assignments", input.id);
    if (!row) throw new PartnersError("That assignment is gone.");
    await db.update(taconRecords).set({ data: values, updatedAt: new Date() }).where(eq(taconRecords.id, row.id));
    return row.id;
  }
  const [created] = await db
    .insert(taconRecords)
    .values(insertValues(runtime, def, "assignments", actorId, values))
    .returning({ id: taconRecords.id });
  return created.id;
}

/** Copies one week's assignments into another, for a week that looks like the last. */
export async function copyWeek(runtime: Runtime, def: PartnersDef, from: string, to: string, actorId: number): Promise<number> {
  requireManager(runtime, def);
  if (!isDay(from) || !isDay(to) || weekStart(from) !== from || weekStart(to) !== to) throw new PartnersError("Pick a week.");
  const source = (await rows(runtime, def, "assignments")).map(assignmentView).filter((entry) => entry.week === from);
  if (source.length === 0) throw new PartnersError("That week has no assignments to copy.");
  for (const entry of source) {
    await db.insert(taconRecords).values(
      insertValues(runtime, def, "assignments", actorId, { week: to, category: entry.category, title: entry.title, details: entry.details }),
    );
  }
  return source.length;
}

export async function deleteAssignment(runtime: Runtime, def: PartnersDef, id: number): Promise<void> {
  requireManager(runtime, def);
  const confirmed = (await rows(runtime, def, "completions")).some(
    (row) => integer(data(row).assignmentId) === id && data(row).status === "confirmed",
  );
  if (confirmed) {
    throw new PartnersError("Someone's work on this is already certified, so it can't be deleted. Edit it instead.");
  }
  await db.delete(taconRecords).where(and(rowsQuery(runtime, def, "assignments"), eq(taconRecords.id, id)));
}

/* -------------------------------------------------------------------------- */
/*  Completions                                                                */
/* -------------------------------------------------------------------------- */

export function completionView(runtime: Runtime, row: Row, showLink: boolean): PartnerCompletion {
  const values = data(row);
  const confirmerId = integer(values.confirmerId) || null;
  const token = typeof values.token === "string" ? values.token : null;
  return {
    id: row.id,
    assignmentId: integer(values.assignmentId),
    personId: integer(values.personId),
    personName: runtime.people.get(integer(values.personId)) ?? "Someone",
    groupId: integer(values.groupId),
    status: values.status === "confirmed" ? "confirmed" : values.status === "returned" ? "returned" : "submitted",
    notes: string(values.notes, 2000),
    shots: ids(values.shots),
    submittedAt: String(values.submittedAt ?? row.createdAt.toISOString()),
    returnNote: string(values.returnNote, 1000),
    confirmerId,
    confirmerName: confirmerId ? runtime.people.get(confirmerId) ?? "Someone" : null,
    confirmedAt: typeof values.confirmedAt === "string" ? values.confirmedAt : null,
    excellence: values.excellence === true,
    apNotes: string(values.apNotes, 2000),
    link: showLink && token ? `/verify/${token}` : null,
    title: string(values.title, 200),
    category: string(values.category, 40),
    week: String(values.week ?? ""),
  };
}

export type SubmitInput = { assignmentId: number; notes: string; shots: number[] };

/** Bob hands in his work on one assignment for Joey to look at. */
export async function submitWork(runtime: Runtime, def: PartnersDef, personId: number, input: SubmitInput): Promise<number> {
  const group = await activeGroupOf(runtime, def, personId);
  if (!group) throw new PartnersError("You need an accountability partner to hand work in.");
  const assignment = await one(runtime, def, "assignments", input.assignmentId);
  if (!assignment) throw new PartnersError("That assignment is gone.");
  const values = assignmentView(assignment);
  const notes = string(input.notes, 2000);
  const shots = [...new Set(input.shots)];
  if (shots.length > SHOTS_PER_SUBJECT * 2) throw new PartnersError(`Attach up to ${SHOTS_PER_SUBJECT * 2} screenshots.`);
  if (!notes && shots.length === 0) throw new PartnersError("Show your work: add a note or a screenshot.");

  return db.transaction(async (tx) => {
    await lock(tx, runtime, def);
    const existing = (await tx.select().from(taconRecords).where(rowsQuery(runtime, def, "completions"))).find(
      (row) => integer(data(row).assignmentId) === input.assignmentId && integer(data(row).personId) === personId,
    );
    if (existing && data(existing).status === "confirmed") {
      throw new PartnersError("Your AP already certified this one.");
    }
    if (shots.length > 0) {
      const owned = await tx.select({
        id: taconRecords.id,
        uploaderId: sql<string | null>`${taconRecords.data}->>'uploaderId'`,
        checkinId: sql<string | null>`${taconRecords.data}->>'checkinId'`,
        completionId: sql<string | null>`${taconRecords.data}->>'completionId'`,
      }).from(taconRecords).where(and(rowsQuery(runtime, def, "shots"), inArray(taconRecords.id, shots)));
      for (const id of shots) {
        const shot = owned.find((entry) => entry.id === id);
        const claimed = shot ? integer(shot.checkinId) || integer(shot.completionId) : 0;
        if (!shot || integer(shot.uploaderId) !== personId || (claimed !== 0 && claimed !== existing?.id)) {
          throw new PartnersError("One of those screenshots isn't yours to attach. Upload it again.");
        }
      }
    }
    const record = {
      assignmentId: input.assignmentId,
      personId,
      groupId: group.id,
      status: "submitted",
      notes,
      shots,
      submittedAt: new Date().toISOString(),
      returnNote: "",
      title: values.title,
      category: values.category,
      week: values.week,
    };
    let id: number;
    if (existing) {
      await tx.update(taconRecords).set({ data: record, updatedAt: new Date() }).where(eq(taconRecords.id, existing.id));
      id = existing.id;
    } else {
      const [created] = await tx.insert(taconRecords)
        .values(insertValues(runtime, def, "completions", personId, record))
        .returning({ id: taconRecords.id });
      id = created.id;
    }
    for (const shotId of shots) {
      await tx.update(taconRecords)
        .set({ data: sql`${taconRecords.data} || ${JSON.stringify({ completionId: id })}::jsonb` })
        .where(eq(taconRecords.id, shotId));
    }
    return id;
  });
}

export type ReviewInput =
  | { completionId: number; decision: "return"; note: string }
  | { completionId: number; decision: "confirm"; excellence: boolean; code: string; notes: string };

/** Joey looks at Bob's work and either sends it back or signs for it. */
export async function reviewWork(
  runtime: Runtime,
  def: PartnersDef,
  reviewerId: number,
  input: ReviewInput,
): Promise<{ link: string | null }> {
  const row = await one(runtime, def, "completions", input.completionId);
  if (!row) throw new PartnersError("That work is gone.");
  const values = data(row);
  const personId = integer(values.personId);
  if (personId === reviewerId) throw new PartnersError("Your AP certifies your work, not you.");
  const group = await activeGroupOf(runtime, def, reviewerId);
  if (!group || !ids(data(group).members).includes(personId)) {
    throw new PartnersError("Only their current AP can certify this.");
  }
  if (values.status === "confirmed") throw new PartnersError("This is already certified.");

  if (input.decision === "return") {
    const note = string(input.note, 1000);
    if (!note) throw new PartnersError("Say what's missing, so they know what to fix.");
    await db.update(taconRecords)
      .set({ data: { ...values, status: "returned", returnNote: note, returnedBy: reviewerId }, updatedAt: new Date() })
      .where(eq(taconRecords.id, row.id));
    return { link: null };
  }

  try {
    await checkVerifyCode(reviewerId, input.code.trim());
  } catch (error) {
    if (error instanceof VerifyCodeError) throw new PartnersError(error.message);
    throw error;
  }
  const token = input.excellence ? randomBytes(18).toString("base64url") : null;
  await db.update(taconRecords)
    .set({
      data: {
        ...values,
        status: "confirmed",
        confirmerId: reviewerId,
        confirmedAt: new Date().toISOString(),
        excellence: input.excellence,
        apNotes: string(input.notes, 2000),
        token,
      },
      updatedAt: new Date(),
    })
    .where(eq(taconRecords.id, row.id));
  return { link: token ? `/verify/${token}` : null };
}

/** The AP who certified something can add to their notes afterwards. */
export async function saveApNotes(runtime: Runtime, def: PartnersDef, actorId: number, completionId: number, notes: string) {
  const row = await one(runtime, def, "completions", completionId);
  if (!row || data(row).status !== "confirmed") throw new PartnersError("That isn't certified yet.");
  if (integer(data(row).confirmerId) !== actorId) throw new PartnersError("Only the AP who certified it can change these notes.");
  await db.update(taconRecords)
    .set({ data: { ...data(row), apNotes: string(notes, 2000) }, updatedAt: new Date() })
    .where(eq(taconRecords.id, row.id));
}

/**
 * Takes a certification back. The link stops working and the work goes back
 * to waiting for review - for when an AP signed too quickly, or a guide finds
 * the work wasn't what it claimed.
 */
export async function revokeCertification(runtime: Runtime, def: PartnersDef, actorId: number, completionId: number, reason: string) {
  const row = await one(runtime, def, "completions", completionId);
  if (!row || data(row).status !== "confirmed") throw new PartnersError("That isn't certified.");
  if (integer(data(row).confirmerId) !== actorId && !canManagePartners(runtime, def)) {
    throw new PartnersError("Only the AP who certified it, or a guide or admin, can take it back.");
  }
  const values = data(row);
  await db.update(taconRecords)
    .set({
      data: {
        ...values,
        status: "returned",
        returnNote: string(reason, 1000) || "The certification was taken back.",
        token: null,
        excellence: false,
        confirmerId: null,
        confirmedAt: null,
        revokedAt: new Date().toISOString(),
        revokedBy: actorId,
      },
      updatedAt: new Date(),
    })
    .where(eq(taconRecords.id, row.id));
}

/* -------------------------------------------------------------------------- */
/*  Milestones                                                                 */
/* -------------------------------------------------------------------------- */

function milestoneView(row: Row): PartnerMilestone {
  const values = data(row);
  return {
    id: row.id,
    personId: integer(values.personId),
    title: string(values.title, 200),
    achievedOn: isDay(values.achievedOn) ? values.achievedOn : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function saveMilestone(
  runtime: Runtime,
  def: PartnersDef,
  personId: number,
  input: { id?: number; title: string; achievedOn: string | null },
): Promise<void> {
  const title = string(input.title, 200);
  if (!title) throw new PartnersError("Name the milestone.");
  if (input.achievedOn !== null && !isDay(input.achievedOn)) throw new PartnersError("That isn't a date.");
  const values = { personId, title, achievedOn: input.achievedOn };
  if (input.id) {
    const row = await one(runtime, def, "milestones", input.id);
    if (!row || integer(data(row).personId) !== personId) throw new PartnersError("That milestone isn't yours.");
    await db.update(taconRecords).set({ data: values, updatedAt: new Date() }).where(eq(taconRecords.id, row.id));
    return;
  }
  await db.insert(taconRecords).values(insertValues(runtime, def, "milestones", personId, values));
}

export async function deleteMilestone(runtime: Runtime, def: PartnersDef, personId: number, id: number): Promise<void> {
  const row = await one(runtime, def, "milestones", id);
  if (!row || integer(data(row).personId) !== personId) throw new PartnersError("That milestone isn't yours.");
  await db.delete(taconRecords).where(eq(taconRecords.id, row.id));
}

/* -------------------------------------------------------------------------- */
/*  What the dashboard needs                                                   */
/* -------------------------------------------------------------------------- */

export async function renderWork(
  runtime: Runtime,
  def: PartnersDef,
  options: { manager: boolean; mates: Set<number>; groups: PartnerGroup[]; since: Date },
) {
  const user = runtime.user;
  const sinceDay = options.since.toISOString().slice(0, 10);
  const [categories, assignmentRows, completionRows, milestoneRows] = await Promise.all([
    customCategories(runtime, def),
    rows(runtime, def, "assignments"),
    rows(runtime, def, "completions"),
    rows(runtime, def, "milestones"),
  ]);
  const myGroupIds = new Set(
    user ? options.groups.filter((group) => group.members.some((m) => m.id === user.id)).map((group) => group.id) : [],
  );
  const assignments = assignmentRows.map(assignmentView).filter((entry) => entry.week >= weekStart(sinceDay));
  const completions = completionRows
    .filter((row) => options.manager || myGroupIds.has(integer(data(row).groupId)) || integer(data(row).personId) === user?.id)
    .map((row) => {
      const values = data(row);
      const involved = integer(values.personId) === user?.id || integer(values.confirmerId) === user?.id;
      return completionView(runtime, row, options.manager || involved);
    })
    .filter((entry) => entry.week >= weekStart(sinceDay));
  const milestones = milestoneRows
    .map(milestoneView)
    .filter((entry) => options.manager || options.mates.has(entry.personId));

  const people = options.manager
    ? [...new Set(options.groups.filter((group) => group.active).flatMap((group) => group.members.map((m) => m.id)))]
    : [...options.mates];
  const attendanceMap = await attendanceFor(people, sinceDay, addDays(new Date().toISOString().slice(0, 10), 31));
  const attendance: PartnerAttendance[] = [...attendanceMap.values()];

  let codeSet = false;
  if (user) {
    codeSet = await hasVerificationCode(user.id);
  }

  return {
    categories: [...def.evidence, ...categories.map((entry) => entry.name)],
    customCategories: categories,
    assignments,
    completions,
    milestones,
    attendance,
    codeSet,
  };
}

/* -------------------------------------------------------------------------- */
/*  Records: every pair's full history                                         */
/* -------------------------------------------------------------------------- */

export type PartnerRecords = {
  groups: PartnerGroup[];
  checkins: PartnerCheckin[];
  goals: PartnerGoals[];
  completions: PartnerCompletion[];
};

/**
 * Everything ever recorded, for the records browser. A partner sees the pairs
 * they've been in; admins and guides see every pair. Screenshots are only
 * referenced - each loads separately, with the same checks as everywhere else.
 */
export async function partnersRecords(
  runtime: Runtime,
  def: PartnersDef,
  views: {
    group: (row: Row) => PartnerGroup;
    checkin: (row: Row) => PartnerCheckin;
  },
): Promise<PartnerRecords> {
  const user = runtime.user;
  const manager = canManagePartners(runtime, def);
  const [groupRows, checkinRows, goalRows, completionRows] = await Promise.all([
    rows(runtime, def, "groups"),
    rows(runtime, def, "checkins"),
    rows(runtime, def, "goals"),
    rows(runtime, def, "completions"),
  ]);
  const groups = groupRows
    .map(views.group)
    .filter((group) => manager || group.members.some((member) => member.id === user?.id));
  const groupIds = new Set(groups.map((group) => group.id));
  const people = new Set(groups.flatMap((group) => group.members.map((member) => member.id)));
  return {
    groups,
    checkins: checkinRows.map(views.checkin).filter((checkin) => groupIds.has(checkin.groupId)),
    goals: goalRows
      .filter((row) => people.has(integer(data(row).personId)))
      .map((row) => ({
        personId: integer(data(row).personId),
        week: String(data(row).week ?? ""),
        goals: (data(row).goals as Record<string, string>) ?? {},
        updatedAt: row.updatedAt.toISOString(),
      })),
    completions: completionRows
      .filter((row) => groupIds.has(integer(data(row).groupId)))
      .map((row) => {
        const values = data(row);
        const involved = integer(values.personId) === user?.id || integer(values.confirmerId) === user?.id;
        return completionView(runtime, row, manager || involved);
      }),
  };
}

/* -------------------------------------------------------------------------- */
/*  Public verification                                                        */
/* -------------------------------------------------------------------------- */

export type Verification = {
  academy: string;
  learner: string;
  certifiedBy: string;
  assignment: string;
  category: string;
  week: string;
  certifiedAt: string;
};

/**
 * What the public verification page shows. First names only: the page is
 * open to anyone holding the link, and that's all a reviewer needs.
 */
export async function lookupVerification(token: string): Promise<Verification | null> {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const [row] = await db
    .select()
    .from(taconRecords)
    .where(and(like(taconRecords.store, "__partners_%_completions"), sql`${taconRecords.data}->>'token' = ${token}`))
    .limit(1);
  if (!row) return null;
  const values = data(row);
  if (values.status !== "confirmed" || values.excellence !== true) return null;
  const people = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, [integer(values.personId), integer(values.confirmerId)]));
  const first = (id: number) => (people.find((person) => person.id === id)?.name ?? "A learner").split(/\s+/)[0];
  const [academy] = await db.select({ name: academies.name }).from(academies).where(eq(academies.id, row.academyId)).limit(1);
  return {
    academy: academy?.name ?? "",
    learner: first(integer(values.personId)),
    certifiedBy: first(integer(values.confirmerId)),
    assignment: string(values.title, 200),
    category: string(values.category, 40),
    week: String(values.week ?? ""),
    certifiedAt: String(values.confirmedAt ?? ""),
  };
}
