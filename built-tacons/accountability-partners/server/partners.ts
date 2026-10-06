/** Storage, rules and rendering for the Accountability Partners Tac-On. */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { taconRecords, users } from "@shared/schema";
import { partnerDefinitions, type PartnersDef } from "../shared/definition";
import {
  ON_TRACK,
  SHOT_MAX_CHARS,
  SHOT_TYPES,
  SHOTS_PER_SUBJECT,
  addDays,
  isDay,
  partnersStore,
  weekday,
  type OnTrack,
  type PartnersStoreKind,
} from "../shared/partners";
import type {
  PartnerCandidate,
  PartnerCheckin,
  PartnerGoals,
  PartnerGroup,
  ViewPartners,
} from "../shared/view";
import { studioCircle } from "../../../server/studio";
import { audienceAllows, type Runtime } from "../../../server/tacons/runtime";
import { canReviewAp, renderApWorkspace } from "./workspace";

/** How far back a dashboard looks: this week, plus five before it. */
const HISTORY_DAYS = 42;

export class PartnersError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PartnersError";
  }
}

type Row = typeof taconRecords.$inferSelect;

function data(row: Row): Record<string, unknown> {
  return row.data ?? {};
}

function integer(value: unknown): number {
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : 0;
}

function ids(value: unknown): number[] {
  return Array.isArray(value) ? value.map(integer).filter((id) => id > 0) : [];
}

function string(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function partnersDef(runtime: Runtime, name: string): PartnersDef | undefined {
  return partnerDefinitions(runtime.install.manifest).find((entry) => entry.name === name);
}

export function canManagePartners(runtime: Runtime, def: PartnersDef): boolean {
  return audienceAllows(def.managers, runtime.user, runtime.held);
}

function rowsQuery(runtime: Runtime, def: PartnersDef, kind: PartnersStoreKind) {
  return and(
    eq(taconRecords.installId, runtime.install.install.id),
    eq(taconRecords.store, partnersStore(def.name, kind)),
  );
}

async function rows(runtime: Runtime, def: PartnersDef, kind: PartnersStoreKind, since?: Date): Promise<Row[]> {
  const where = since
    ? and(rowsQuery(runtime, def, kind), gte(taconRecords.updatedAt, since))
    : rowsQuery(runtime, def, kind);
  return db.select().from(taconRecords).where(where).orderBy(desc(taconRecords.createdAt));
}

/** All writes to one partners block serialize on the same transaction lock. */
async function lock(tx: any, runtime: Runtime, def: PartnersDef) {
  const key = `tacon-partners:${runtime.install.install.id}:${def.name}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

/**
 * APs are learners holding each other accountable, so only learners can be
 * one - including the learners who happen to carry a secretary's or an
 * admin's job. Secretaries almost always are learners; a learner admin is by
 * definition. Guides and staff admins never are.
 */
export function canBePartner(person: { role: string; learnerAdmin: boolean }): boolean {
  return (
    person.role === "learner" ||
    person.role === "secretary" ||
    (person.role === "admin" && person.learnerAdmin)
  );
}

/** Who can be put in a group: learners (in any of the forms above) in this install's reach. */
async function candidates(runtime: Runtime): Promise<PartnerCandidate[]> {
  const everyone = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      learnerAdmin: users.learnerAdmin,
      studioId: users.studioId,
    })
    .from(users)
    .where(and(eq(users.academyId, runtime.academyId), eq(users.active, true)));
  const installStudio = runtime.install.install.studioId;
  // An install in a grouped studio is the whole group's.
  const circle = await studioCircle(installStudio);
  const scope = runtime.scope;
  return everyone
    .filter(canBePartner)
    .filter((person) => {
      // Someone not yet placed in a studio can partner anywhere they're allowed.
      if (person.studioId === null) return true;
      if (installStudio !== null) return circle.includes(person.studioId);
      if (!scope) return false;
      if (scope.studioId !== null) return scope.circleIds.includes(person.studioId);
      return scope.canSeeAll || scope.readableIds.includes(person.studioId);
    })
    .map((person) => ({ id: person.id, name: person.name, role: person.role }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function groupView(runtime: Runtime, row: Row): PartnerGroup {
  const values = data(row);
  return {
    id: row.id,
    members: ids(values.members).map((id) => ({ id, name: runtime.people.get(id) ?? "Someone" })),
    active: values.active === true,
    startedAt: row.createdAt.toISOString(),
    endedAt: typeof values.endedAt === "string" ? values.endedAt : null,
  };
}

function checkinView(runtime: Runtime, row: Row): PartnerCheckin {
  const values = data(row);
  const onTrack = ON_TRACK.includes(values.onTrack as OnTrack) ? (values.onTrack as OnTrack) : "on-track";
  return {
    id: row.id,
    groupId: integer(values.groupId),
    date: String(values.date ?? ""),
    checkerId: integer(values.checkerId),
    checkerName: runtime.people.get(integer(values.checkerId)) ?? "Someone",
    targetId: integer(values.targetId),
    targetName: runtime.people.get(integer(values.targetId)) ?? "Someone",
    core: Array.isArray(values.core) ? (values.core as PartnerCheckin["core"]) : [],
    evidence: Array.isArray(values.evidence) ? (values.evidence as PartnerCheckin["evidence"]) : [],
    onTrack,
    notes: String(values.notes ?? ""),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function renderPartners(
  runtime: Runtime,
  widget: { kind: "partners"; partners: string },
  index: number,
): Promise<ViewPartners | null> {
  const def = partnersDef(runtime, widget.partners);
  if (!def) return null;
  const user = runtime.user;
  const manager = canReviewAp(runtime, def);
  const [groupRows, checkinRows, goalRows] = await Promise.all([
    rows(runtime, def, "groups"),
    rows(runtime, def, "checkins"),
    rows(runtime, def, "goals"),
  ]);
  const groups = groupRows.map((row) => groupView(runtime, row));
  const mine = user ? groups.find((group) => group.active && group.members.some((m) => m.id === user.id)) ?? null : null;
  // Every group the viewer was ever in, so a re-pairing doesn't hide their history.
  const myGroupIds = new Set(
    user ? groups.filter((group) => group.members.some((m) => m.id === user.id)).map((group) => group.id) : [],
  );
  const visibleGroups = groups.filter(group => manager || myGroupIds.has(group.id));
  const mates = new Set(visibleGroups.flatMap(group => group.members.map(member => member.id)));
  if (user) mates.add(user.id);

  const checkins = checkinRows
    .map((row) => checkinView(runtime, row))
    .filter((checkin) => manager || myGroupIds.has(checkin.groupId));
  const goals: PartnerGoals[] = goalRows
    .filter((row) => manager || mates.has(integer(data(row).personId)))
    .map((row) => ({
      personId: integer(data(row).personId),
      week: String(data(row).week ?? ""),
      goals: (data(row).goals as Record<string, string>) ?? {},
      updatedAt: row.updatedAt.toISOString(),
    }));

  return {
    kind: "partners",
    index,
    partners: def.name,
    title: def.title,
    core: def.core,
    evidence: def.evidence,
    required: def.required,
    due: def.due,
    trios: def.trios,
    workspace: await renderApWorkspace(runtime, def),
    me: user ? { id: user.id, name: user.name } : null,
    group: mine,
    historyGroups: visibleGroups,
    checkins,
    goals,
    manage: manager
      ? {
          candidates: await candidates(runtime),
          groups,
          revision: groups.filter(group => group.active).map(group => group.id).sort((a, b) => a - b),
        }
      : null,
  };
}

/* -------------------------------------------------------------------------- */
/*  Pairings                                                                   */
/* -------------------------------------------------------------------------- */

function key(members: number[]): string {
  return [...members].sort((a, b) => a - b).join(",");
}

/**
 * Replaces the pairings with `groups`. A group whose members are unchanged
 * keeps its id (and its history); any other active group is ended, not
 * deleted, so last month's check-ins still say who they were partnered with.
 */
export async function savePairings(
  runtime: Runtime,
  def: PartnersDef,
  groups: number[][],
  actorId: number,
  options?: { mode: "merge"; removedGroupIds: number[]; expectedGroupIds: number[] },
): Promise<{ kept: number; started: number; ended: number }> {
  const seen = new Set<number>();
  for (const members of groups) {
    if (members.length < 2) throw new PartnersError("Every group needs at least two people.");
    if (members.length > (def.trios ? 3 : 2)) {
      throw new PartnersError(def.trios ? "Groups can have at most three people." : "Groups of three aren't allowed here.");
    }
    for (const id of members) {
      if (seen.has(id)) {
        throw new PartnersError(`${runtime.people.get(id) ?? "Someone"} is in more than one group.`);
      }
      seen.add(id);
    }
  }
  const eligible = new Map((await candidates(runtime)).map((person) => [person.id, person]));
  for (const id of seen) {
    if (!eligible.has(id)) {
      const name = runtime.people.get(id) ?? "Someone";
      throw new PartnersError(
        `${name} can't be an AP here. APs are learners, secretaries and learner admins in this Tac-On's studio.`,
      );
    }
  }

  return db.transaction(async (tx) => {
    await lock(tx, runtime, def);
    const current = await tx.select().from(taconRecords).where(rowsQuery(runtime, def, "groups"));
    const active = current.filter((row) => data(row).active === true);
    if (options) {
      const revision = active.map(row => row.id).sort((a, b) => a - b);
      const expected = [...options.expectedGroupIds].sort((a, b) => a - b);
      if (JSON.stringify(revision) !== JSON.stringify(expected)) {
        throw new PartnersError("Pairings changed while you were editing. Refresh before saving so nobody's pair is lost.");
      }
      const removals = new Set(options.removedGroupIds);
      for (const row of active) {
        if (removals.has(row.id) || groups.some(group => key(group) === key(ids(data(row).members)))) continue;
        if (ids(data(row).members).some(id => seen.has(id))) {
          throw new PartnersError("Someone is already paired. Explicitly remove their old pair before moving them.");
        }
      }
    }
    const wanted = new Map(groups.map((members) => [key(members), members]));
    let kept = 0;
    let ended = 0;
    const now = new Date();
    for (const row of active) {
      const rowKey = key(ids(data(row).members));
      if (wanted.has(rowKey)) {
        wanted.delete(rowKey);
        kept += 1;
        continue;
      }
      if (options && !options.removedGroupIds.includes(row.id)) {
        kept += 1;
        continue;
      }
      await tx.update(taconRecords).set({
        data: { ...data(row), active: false, endedAt: now.toISOString(), endedBy: actorId },
        updatedAt: now,
      }).where(eq(taconRecords.id, row.id));
      ended += 1;
    }
    for (const members of wanted.values()) {
      await tx.insert(taconRecords).values({
        academyId: runtime.academyId,
        installId: runtime.install.install.id,
        store: partnersStore(def.name, "groups"),
        createdByType: "user",
        createdBy: actorId,
        data: { members, active: true, endedAt: null },
      });
    }
    return { kept, started: wanted.size, ended };
  });
}

async function activeGroupOf(runtime: Runtime, def: PartnersDef, personId: number): Promise<Row | null> {
  const groups = await rows(runtime, def, "groups");
  return groups.find((row) => data(row).active === true && ids(data(row).members).includes(personId)) ?? null;
}

/* -------------------------------------------------------------------------- */
/*  Goals                                                                      */
/* -------------------------------------------------------------------------- */

/** Days either side of the server's date a client's calendar may be on. */
function nearToday(day: string, slack: number): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return day >= addDays(today, -slack) && day <= addDays(today, slack);
}

export async function saveGoals(
  runtime: Runtime,
  def: PartnersDef,
  options: { personId: number; week: string; goals: Record<string, string> },
) {
  if (!isDay(options.week) || weekday(options.week) !== 1 || !nearToday(options.week, 8)) {
    throw new PartnersError("Goals can only be set for this week or next.");
  }
  const goals: Record<string, string> = {};
  for (const subject of def.core) goals[subject] = string(options.goals[subject], 300);
  if (!(await activeGroupOf(runtime, def, options.personId))) {
    throw new PartnersError("You need an accountability partner before setting goals here.");
  }
  await db.transaction(async (tx) => {
    await lock(tx, runtime, def);
    const existing = (await tx.select().from(taconRecords).where(rowsQuery(runtime, def, "goals")))
      .find((row) => integer(data(row).personId) === options.personId && data(row).week === options.week);
    if (existing) {
      await tx.update(taconRecords).set({ data: { ...data(existing), goals }, updatedAt: new Date() })
        .where(eq(taconRecords.id, existing.id));
      return;
    }
    await tx.insert(taconRecords).values({
      academyId: runtime.academyId,
      installId: runtime.install.install.id,
      store: partnersStore(def.name, "goals"),
      createdByType: "user",
      createdBy: options.personId,
      data: { personId: options.personId, week: options.week, goals },
    });
  });
}

/* -------------------------------------------------------------------------- */
/*  Screenshots                                                                */
/* -------------------------------------------------------------------------- */

const DATA_URL = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/;

/** Stores one screenshot, unattached until a check-in claims it. */
export async function uploadShot(runtime: Runtime, def: PartnersDef, uploaderId: number, dataUrl: string): Promise<number> {
  if (dataUrl.length > SHOT_MAX_CHARS) throw new PartnersError("That screenshot is too large. Try a smaller one.");
  const match = DATA_URL.exec(dataUrl);
  if (!match || !(SHOT_TYPES as readonly string[]).includes(match[1])) {
    throw new PartnersError("Screenshots have to be PNG, JPEG or WebP images.");
  }
  if (!(await activeGroupOf(runtime, def, uploaderId))) {
    throw new PartnersError("Only people with an accountability partner can upload screenshots.");
  }
  const [row] = await db.insert(taconRecords).values({
    academyId: runtime.academyId,
    installId: runtime.install.install.id,
    store: partnersStore(def.name, "shots"),
    createdByType: "user",
    createdBy: uploaderId,
    data: { uploaderId, mime: match[1], image: match[2], checkinId: null },
  }).returning({ id: taconRecords.id });
  return row.id;
}

/** A screenshot, if the viewer may see the check-in it belongs to. */
export async function readShot(
  runtime: Runtime,
  def: PartnersDef,
  shotId: number,
): Promise<{ mime: string; bytes: Buffer } | null> {
  const user = runtime.user;
  if (!user) return null;
  const [shot] = await db.select().from(taconRecords)
    .where(and(rowsQuery(runtime, def, "shots"), eq(taconRecords.id, shotId))).limit(1);
  if (!shot) return null;
  const values = data(shot);
  let allowed = integer(values.uploaderId) === user.id || canManagePartners(runtime, def);
  if (!allowed && values.checkinId) {
    const [checkin] = await db.select().from(taconRecords)
      .where(and(rowsQuery(runtime, def, "checkins"), eq(taconRecords.id, integer(values.checkinId)))).limit(1);
    if (checkin) {
      const [group] = await db.select().from(taconRecords)
        .where(and(rowsQuery(runtime, def, "groups"), eq(taconRecords.id, integer(data(checkin).groupId)))).limit(1);
      allowed = Boolean(group && ids(data(group).members).includes(user.id));
    }
  }
  if (!allowed) return null;
  return { mime: String(values.mime), bytes: Buffer.from(String(values.image ?? ""), "base64") };
}

/* -------------------------------------------------------------------------- */
/*  Check-ins                                                                  */
/* -------------------------------------------------------------------------- */

export type CheckinInput = {
  targetId: number;
  date: string;
  core: { subject: string; goal: string; progress: string; percent: number | null }[];
  evidence: { subject: string; notes: string; shots: number[] }[];
  onTrack: OnTrack;
  notes: string;
};

/**
 * Records one partner's check-in on another, for today. One per pair per day:
 * submitting again the same day updates it, so a check-in can be finished in
 * two sittings without counting twice.
 */
export async function saveCheckin(
  runtime: Runtime,
  def: PartnersDef,
  checkerId: number,
  input: CheckinInput,
): Promise<{ id: number; updated: boolean }> {
  if (!isDay(input.date) || !nearToday(input.date, 1)) {
    throw new PartnersError("Check-ins are recorded on the day they happen.");
  }
  if (input.targetId === checkerId) throw new PartnersError("You check in on your partner, not yourself.");
  const group = await activeGroupOf(runtime, def, checkerId);
  if (!group || !ids(data(group).members).includes(input.targetId)) {
    throw new PartnersError("You can only check in on your current accountability partner.");
  }

  const core = def.core.map((subject) => {
    const entry = input.core.find((candidate) => candidate.subject === subject);
    const percent = entry?.percent;
    return {
      subject,
      goal: string(entry?.goal, 300),
      progress: string(entry?.progress, 500),
      percent: typeof percent === "number" && Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : null,
    };
  });
  const evidence = def.evidence.map((subject) => {
    const entry = input.evidence.find((candidate) => candidate.subject === subject);
    const shots = [...new Set(entry?.shots ?? [])];
    if (shots.length > SHOTS_PER_SUBJECT) {
      throw new PartnersError(`Attach up to ${SHOTS_PER_SUBJECT} screenshots for ${subject}.`);
    }
    return { subject, notes: string(entry?.notes, 1000), shots };
  });
  if (!ON_TRACK.includes(input.onTrack)) throw new PartnersError("Say whether your partner is on track.");
  const notes = string(input.notes, 1000);
  const said = core.some((entry) => entry.progress || entry.percent !== null) ||
    evidence.some((entry) => entry.notes || entry.shots.length > 0);
  if (!said) throw new PartnersError("Record some progress, a note or a screenshot before saving.");

  return db.transaction(async (tx) => {
    await lock(tx, runtime, def);
    const existing = (await tx.select().from(taconRecords).where(rowsQuery(runtime, def, "checkins")))
      .find((row) => {
        const values = data(row);
        return integer(values.groupId) === group.id && integer(values.checkerId) === checkerId &&
          integer(values.targetId) === input.targetId && values.date === input.date;
      });

    const shotIds = evidence.flatMap((entry) => entry.shots);
    if (shotIds.length > 0) {
      // Only the ownership fields - the images themselves can be large.
      const shots = await tx.select({
        id: taconRecords.id,
        uploaderId: sql<string | null>`${taconRecords.data}->>'uploaderId'`,
        checkinId: sql<string | null>`${taconRecords.data}->>'checkinId'`,
      }).from(taconRecords).where(and(rowsQuery(runtime, def, "shots"), inArray(taconRecords.id, shotIds)));
      for (const id of shotIds) {
        const shot = shots.find((candidate) => candidate.id === id);
        const owner = shot ? integer(shot.uploaderId) : 0;
        const claimedBy = shot ? integer(shot.checkinId) : 0;
        if (!shot || owner !== checkerId || (claimedBy !== 0 && claimedBy !== existing?.id)) {
          throw new PartnersError("One of those screenshots isn't yours to attach. Upload it again.");
        }
      }
    }

    const values = { groupId: group.id, checkerId, targetId: input.targetId, date: input.date, core, evidence, onTrack: input.onTrack, notes };
    let id: number;
    if (existing) {
      await tx.update(taconRecords).set({ data: values, updatedAt: new Date() }).where(eq(taconRecords.id, existing.id));
      id = existing.id;
    } else {
      const [created] = await tx.insert(taconRecords).values({
        academyId: runtime.academyId,
        installId: runtime.install.install.id,
        store: partnersStore(def.name, "checkins"),
        createdByType: "user",
        createdBy: checkerId,
        data: values,
      }).returning({ id: taconRecords.id });
      id = created.id;
    }
    // Claim the screenshots. The jsonb merge leaves the image itself untouched.
    for (const shotId of shotIds) {
      await tx.update(taconRecords)
        .set({ data: sql`${taconRecords.data} || ${JSON.stringify({ checkinId: id })}::jsonb` })
        .where(eq(taconRecords.id, shotId));
    }
    return { id, updated: Boolean(existing) };
  });
}
