/**
 * Direct database access for the local Tac-On sandbox. Run it through
 * `testing/sandbox` (which sets the engine as the working directory so the
 * engine's `@shared/*` imports resolve), never by hand against a real database.
 *
 *   seed                     create (or refresh) the sandbox academy and personas
 *   reset                    delete the sandbox academy and everything in it, then seed
 *   fire <event> [options]   run every installed `when` block for an event, for real
 *   records <slug>           dump every stored record of a Tac-On's sandbox installs
 *
 * It refuses to touch any database that isn't on localhost and named *sandbox*.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PERSONAS, SANDBOX_ACADEMY, SANDBOX_DOMAIN, STUDIOS, personaEmail } from "./personas.mjs";

// The engine is loaded from wherever EAGLE_BOT_ENGINE points, so this file
// works the same inside the engine repo and from a separate Tac-Ons repo.
const engine = process.env.EAGLE_BOT_ENGINE;
if (!engine) throw new Error("Set EAGLE_BOT_ENGINE to the Eagle Bot checkout (testing/sandbox does this).");
const load = (file: string) => import(pathToFileURL(path.join(engine, file)).href);
// The engine's own copy, so query helpers match the tables it defines.
const { and, eq, inArray } = await load("node_modules/drizzle-orm/index.js");
const { db, pool } = await load("server/db.ts");
const { hashPassword } = await load("server/auth.ts");
const { activityLog, academies, studios, taconInstalls, taconRecords, tacons, users } = await load("shared/schema.ts");
const { HOOK_EVENTS } = await load("shared/tacons/index.ts");
const { dispatchTaconEvent } = await load("server/tacons/events.ts");

function guard() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  const name = url.pathname.slice(1);
  if (!local || !name.includes("sandbox")) {
    throw new Error(`Refusing to touch ${url.hostname}/${name}. The sandbox only runs on a local database whose name contains "sandbox".`);
  }
}

async function findAcademy() {
  const [academy] = await db.select().from(academies).where(eq(academies.emailDomain, SANDBOX_DOMAIN)).limit(1);
  return academy ?? null;
}

async function seed() {
  const password = process.env.SANDBOX_PASSWORD || "sandbox-password";
  const passwordHash = await hashPassword(password);
  let academy = await findAcademy();
  if (!academy) {
    [academy] = await db.insert(academies).values({
      name: SANDBOX_ACADEMY,
      emailDomain: SANDBOX_DOMAIN,
      palette: { primary: "#1d4ed8", accent: "#f59e0b", surface: "#ffffff" },
    }).returning();
  }
  const studioIds: Record<string, number> = {};
  for (const studio of STUDIOS) {
    let [row] = await db.select().from(studios)
      .where(and(eq(studios.academyId, academy.id), eq(studios.slug, studio.slug))).limit(1);
    if (!row) [row] = await db.insert(studios).values({ academyId: academy.id, name: studio.name, slug: studio.slug }).returning();
    studioIds[studio.slug] = row.id;
  }
  for (const persona of PERSONAS) {
    const values = {
      academyId: academy.id,
      email: personaEmail(persona.key),
      name: persona.name,
      role: persona.role,
      studioId: persona.studio ? studioIds[persona.studio] : null,
      passwordHash,
      devStatus: persona.dev,
      learnerAdmin: persona.learnerAdmin,
      active: true,
    } as const;
    const [existing] = await db.select().from(users).where(eq(users.email, values.email)).limit(1);
    const [user] = existing
      ? await db.update(users).set(values).where(eq(users.id, existing.id)).returning()
      : await db.insert(users).values(values).returning();
    if (persona.dev && !user.devHandle) {
      await db.update(users).set({ devHandle: `sandbox-${persona.key}-${user.id}`, devSince: new Date() }).where(eq(users.id, user.id));
    }
  }
  console.log(`Sandbox academy "${academy.name}" is ready: ${PERSONAS.length} personas, studios ${STUDIOS.map(s => s.slug).join(", ")}.`);
}

async function reset() {
  const academy = await findAcademy();
  if (academy) {
    // Tac-Ons, installs, records, positions and people all cascade from the academy.
    await db.delete(academies).where(eq(academies.id, academy.id));
    console.log("Deleted the sandbox academy and everything in it.");
  }
  await seed();
}

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
}

async function personaId(academyId: number, key: string | undefined) {
  if (!key) return null;
  const [user] = await db.select().from(users)
    .where(and(eq(users.academyId, academyId), eq(users.email, personaEmail(key)))).limit(1);
  if (!user) throw new Error(`No persona "${key}". Run seed first.`);
  return user;
}

async function fire(args: string[]) {
  const action = args[0];
  if (!action || !(HOOK_EVENTS as readonly string[]).includes(action)) {
    throw new Error(`Name an event: ${HOOK_EVENTS.join(", ")}.`);
  }
  const academy = await findAcademy();
  if (!academy) throw new Error("No sandbox academy. Run seed first.");
  const studioSlug = option(args, "studio") ?? "launchpad";
  const [studio] = studioSlug === "none" ? [null] : await db.select().from(studios)
    .where(and(eq(studios.academyId, academy.id), eq(studios.slug, studioSlug))).limit(1);
  if (studio === undefined) throw new Error(`No studio "${studioSlug}".`);
  const actor = await personaId(academy.id, option(args, "actor") ?? "admin");
  const winner = await personaId(academy.id, option(args, "winner"));
  const metadata: Record<string, unknown> = JSON.parse(option(args, "metadata") ?? "{}");
  if (winner) metadata.ranked = [{ userId: winner.id, label: winner.name, votes: Number(option(args, "votes") ?? 5) }];
  const entityId = option(args, "entity");
  const event = {
    academyId: academy.id,
    studioId: studio?.id ?? null,
    action,
    summary: option(args, "summary") ?? `Sandbox fired ${action}.`,
    actorUserId: actor?.id ?? null,
    entityType: "sandbox",
    entityId: entityId ? Number(entityId) : null,
    metadata,
  };
  const before = await recordCount(academy.id);
  // Written straight to the log rather than through logActivity, which would
  // also dispatch in the background and run every hook twice.
  await db.insert(activityLog).values({ ...event, actorType: "user", actorLabel: null });
  await dispatchTaconEvent(event);
  const after = await recordCount(academy.id);
  console.log(`Fired ${action} in ${studio?.name ?? "no studio"}${winner ? `, winner ${winner.name}` : ""}. Tac-On records written: ${after - before}.`);
}

async function recordCount(academyId: number) {
  const installs = await db.select({ id: taconInstalls.id }).from(taconInstalls).where(eq(taconInstalls.academyId, academyId));
  if (installs.length === 0) return 0;
  const rows = await db.select({ id: taconRecords.id }).from(taconRecords).where(inArray(taconRecords.installId, installs.map(i => i.id)));
  return rows.length;
}

async function records(slug: string | undefined) {
  if (!slug) throw new Error("Name a Tac-On slug.");
  const academy = await findAcademy();
  if (!academy) throw new Error("No sandbox academy. Run seed first.");
  const [tacon] = await db.select().from(tacons).where(eq(tacons.slug, slug)).limit(1);
  if (!tacon) throw new Error(`No Tac-On "${slug}" in the sandbox.`);
  const installs = await db.select().from(taconInstalls)
    .where(and(eq(taconInstalls.academyId, academy.id), eq(taconInstalls.taconId, tacon.id)));
  for (const install of installs) {
    const rows = await db.select().from(taconRecords).where(eq(taconRecords.installId, install.id));
    console.log(JSON.stringify({ install: install.id, studioId: install.studioId, records: rows }, null, 2));
  }
}

async function main() {
  guard();
  const [command, ...args] = process.argv.slice(2);
  if (command === "seed") await seed();
  else if (command === "reset") await reset();
  else if (command === "fire") await fire(args);
  else if (command === "records") await records(args[0]);
  else throw new Error("Use seed, reset, fire <event> or records <slug>.");
}

main().then(() => pool.end()).catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await pool.end();
  process.exit(1);
});
