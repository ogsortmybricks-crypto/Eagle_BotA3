import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { taconMessages } from "@shared/schema";
import { topicSchema, granted } from "@shared/tacons/contract";
import { visibleInstalls, type LoadedInstall } from "./registry";
import { controlsFor, demandAccess, demandCapability, installAllows, TaconAccessError } from "./governance";
import type { Runtime } from "./runtime";
import { studioCircle } from "../studio";

const counters = new Map<string, { since: number; count: number }>();
function rateLimit(runtime: Runtime) {
  const now = Date.now(), key = `${runtime.academyId}:${runtime.user!.id}:${runtime.install.install.id}`;
  if (counters.size > 10_000) for (const [key, value] of counters) if (now - value.since > 60_000) counters.delete(key);
  const counter = counters.get(key);
  if (!counter || now - counter.since > 60_000) counters.set(key, { since: now, count: 1 });
  else if (++counter.count > 120) throw new TaconAccessError("SDK request limit reached. Wait a minute before retrying.", 429);
}
const sendSchema = z.object({
  to: z.union([z.number().int().positive(), z.literal("broadcast")]),
  topic: topicSchema,
  payload: z.record(z.unknown()),
}).strict();
const readSchema = z.object({ after: z.number().int().min(0).max(2147483647).default(0), limit: z.number().int().min(1).max(100).default(50) }).strict();
function checked<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new TaconAccessError(`Invalid SDK arguments: ${parsed.error.issues.map(issue => issue.message).join("; ")}`, 400);
  return parsed.data;
}
async function peers(runtime: Runtime) {
  const sender = runtime.install.install;
  const circle = await studioCircle(sender.studioId);
  const candidates = await visibleInstalls(runtime.academyId, runtime.scope);
  const result = [];
  for (const entry of candidates) {
    if (sender.studioId !== null && entry.install.studioId !== null && !circle.includes(entry.install.studioId)) continue;
    if (await installAllows(entry, runtime.user!, "view")) result.push(entry);
  }
  return result;
}

export async function invokeSdk(runtime: Runtime, method: string, args: unknown) {
  if (!runtime.user) throw new TaconAccessError("SDK calls require a signed-in viewer.");
  demandAccess(runtime, "view");
  rateLimit(runtime);
  if (method === "extensions.discover") {
    demandCapability(runtime, "extensions.discover");
    return (await peers(runtime)).map(entry => ({
      id: entry.install.id, slug: entry.tacon.slug, name: entry.manifest.name,
      version: entry.version.version, studioId: entry.install.studioId,
    }));
  }
  if (method === "events.read") {
    demandCapability(runtime, "events.receive");
    demandAccess(runtime, "read");
    const query = checked(readSchema, args ?? {}) as z.output<typeof readSchema>;
    const topics = runtime.install.manifest.contract!.listens;
    if (!topics.length) return { events: [], nextCursor: query.after, hasMore: false };
    const rows = await db.select().from(taconMessages).where(and(
      eq(taconMessages.academyId, runtime.academyId),
      eq(taconMessages.recipientId, runtime.install.install.id),
      gt(taconMessages.id, query.after), inArray(taconMessages.topic, topics),
    )).orderBy(asc(taconMessages.id)).limit(query.limit + 1);
    const events = rows.slice(0, query.limit).map(({ actorUserId: _actor, academyId: _academy, ...event }) => event);
    return { events, nextCursor: events.at(-1)?.id ?? query.after, hasMore: rows.length > query.limit };
  }
  if (method === "events.send") {
    demandCapability(runtime, "events.send");
    demandAccess(runtime, "write");
    const message = checked(sendSchema, args);
    if (!runtime.install.manifest.contract!.emits.includes(message.topic)) throw new TaconAccessError("This package did not declare that emitted topic.");
    if (Buffer.byteLength(JSON.stringify(message.payload), "utf8") > 16_000) throw new TaconAccessError("Event payloads must be at most 16 KB.", 413);
    const candidates = await peers(runtime);
    const receivers: LoadedInstall[] = [];
    for (const entry of candidates) {
      if (message.to !== "broadcast" && entry.install.id !== message.to) continue;
      if (message.to === "broadcast" && entry.install.id === runtime.install.install.id) continue;
      const controls = await controlsFor(entry.install.id, entry.manifest);
      if (granted(entry.manifest, controls, "events.receive") && entry.manifest.contract?.listens.includes(message.topic)) receivers.push(entry);
    }
    if (message.to !== "broadcast" && !receivers.length) throw new TaconAccessError("That recipient is unavailable or has not approved this topic.", 404);
    if (receivers.length > 25) throw new TaconAccessError("A broadcast may reach at most 25 installations. Send targeted messages instead.", 400);
    if (!receivers.length) return { delivered: 0 };
    return db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(${runtime.academyId}, ${runtime.user!.id})`);
      const [{ count }] = await tx.select({ count: sql<number>`count(*)` }).from(taconMessages).where(and(
        eq(taconMessages.academyId, runtime.academyId), eq(taconMessages.actorUserId, runtime.user!.id),
        gt(taconMessages.createdAt, sql`now() - interval '1 minute'`),
      ));
      if (Number(count) + receivers.length > 120) throw new TaconAccessError("Event delivery limit reached. Wait a minute before retrying.", 429);
      await tx.insert(taconMessages).values(receivers.map(receiver => ({
        academyId: runtime.academyId, senderId: runtime.install.install.id,
        recipientId: receiver.install.id, actorUserId: runtime.user!.id,
        topic: message.topic, payload: message.payload,
      })));
      return { delivered: receivers.length };
    });
  }
  throw new TaconAccessError("Unknown SDK method.", 400);
}
