/** Transaction-backed storage and rendering for TacScript's built-in market. */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { taconRecords, users } from "@shared/schema";
import { marketStore } from "@shared/tacons/market";
import type { MarketDef } from "@shared/tacons";
import type { MarketEntry, MarketProduct, MarketPurchase, ViewMarket } from "@shared/tacons/view";
import { studioCircle } from "../studio";
import type { Runtime } from "./runtime";

const RECENT_LIMIT = 200;

export class MarketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketError";
  }
}

function assertWritableMarket(runtime: Runtime, def: MarketDef): void {
  if (!validMarketDefinition(def)) throw new MarketError("This market has an invalid points rate or cap.");
  if (!marketInstallCompatible(def, runtime.install.install.studioId)) {
    throw new MarketError("This market requires one academy-wide install.");
  }
}

type MarketKind = "catalog" | "ledger" | "purchases";
type MarketRow = typeof taconRecords.$inferSelect;
type Product = { id: number; name: string; description: string; pricePoints: number; active: boolean };

export function validMarketDefinition(def: MarketDef): boolean {
  return Number.isSafeInteger(def.rate) && def.rate >= 1 && def.rate <= 1_000_000_000 &&
    Number.isSafeInteger(def.cap) && def.cap >= def.rate && def.cap <= 1_000_000_000 &&
    (def.overdraft === undefined || typeof def.overdraft === "boolean");
}

export function marketRequiresAcademyInstall(def: MarketDef): boolean {
  return "scope" in def && def.scope === "academy";
}

export function marketInstallCompatible(def: MarketDef, studioId: number | null): boolean {
  return !marketRequiresAcademyInstall(def) || studioId === null;
}

/** Stores the built-in engines (`market`, `partners`) own. */
export function isReservedMarketStore(storeName: string): boolean {
  return storeName.startsWith("__");
}

function store(def: MarketDef, kind: MarketKind): string {
  return marketStore(def.name, kind);
}

function data(row: MarketRow): Record<string, unknown> {
  return row.data ?? {};
}

function integer(value: unknown): number {
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : 0;
}

function userName(runtime: Runtime, id: unknown): string {
  return runtime.people.get(integer(id)) ?? "Someone";
}

async function eligibleLearners(runtime: Runtime) {
  const all = await db.select({ id: users.id, name: users.name, studioId: users.studioId })
    .from(users)
    .where(and(eq(users.academyId, runtime.academyId), eq(users.active, true), inArray(users.role, ["learner", "admin"])));
  const scope = runtime.scope;
  // An install in a grouped studio is the whole group's market.
  const installCircle = await studioCircle(runtime.install.install.studioId);
  return all.filter((person) => {
    if (!runtime.people.has(person.id)) return false;
    if (runtime.install.install.studioId !== null) return installCircle.includes(person.studioId ?? -1);
    if (!scope) return false;
    if (scope.studioId !== null) {
      return scope.circleIds.includes(person.studioId ?? -1) || person.studioId === null;
    }
    if (scope.canSeeAll) return person.studioId === null || scope.readableIds.includes(person.studioId ?? -1);
    return person.studioId === null || scope.readableIds.includes(person.studioId ?? -1);
  });
}

async function marketRows(runtime: Runtime, def: MarketDef, kind: MarketKind): Promise<MarketRow[]> {
  return db.select().from(taconRecords).where(and(
    eq(taconRecords.installId, runtime.install.install.id),
    eq(taconRecords.store, store(def, kind)),
  )).orderBy(desc(taconRecords.createdAt));
}

function safeBalance(points: bigint): number {
  const balance = Number(points);
  if (!Number.isSafeInteger(balance)) throw new MarketError("This wallet exceeds the supported balance range.");
  return balance;
}

function walletBalance(ledger: MarketRow[], ownerId: number): number {
  return safeBalance(ledger
    .filter((row) => integer(data(row).learnerId) === ownerId)
    .reduce((total, row) => total + BigInt(integer(data(row).points)), 0n));
}

function balances(ledger: MarketRow[]): Map<number, number> {
  const result = new Map<number, bigint>();
  for (const record of ledger) {
    const row = data(record);
    const learnerId = integer(row.learnerId);
    result.set(learnerId, (result.get(learnerId) ?? 0n) + BigInt(integer(row.points)));
  }
  return new Map([...result].map(([id, points]) => [id, safeBalance(points)]));
}

export async function renderMarket(runtime: Runtime, widget: { kind: "market"; market: string }, index: number): Promise<ViewMarket | null> {
  const def = runtime.install.manifest.markets?.find((entry) => entry.name === widget.market);
  if (!def || !validMarketDefinition(def)) return null;
  if (!marketInstallCompatible(def, runtime.install.install.studioId)) return null;
  const user = runtime.user;
  const isAdmin = user?.role === "admin";
  const isKeeper = runtime.held.has(def.keeper);
  const learner = user?.role === "learner" || isAdmin;
  const canManage = Boolean(isAdmin || isKeeper);
  const canViewLogs = Boolean(isAdmin || isKeeper);
  const [catalog, ledger, purchases, eligible] = await Promise.all([
    marketRows(runtime, def, "catalog"),
    marketRows(runtime, def, "ledger"),
    marketRows(runtime, def, "purchases"),
    eligibleLearners(runtime),
  ]);
  const balanceMap = balances(ledger);
  const products: MarketProduct[] = catalog
    .filter((row) => canManage || data(row).active === true)
    .map((row) => ({
      id: row.id,
      name: String(data(row).name ?? ""),
      description: String(data(row).description ?? ""),
      pricePoints: integer(data(row).pricePoints),
      active: data(row).active === true,
    }));
  const visibleLedger = canViewLogs
    ? ledger.slice(0, RECENT_LIMIT)
    : learner ? ledger.filter((row) => integer(data(row).learnerId) === user.id).slice(0, RECENT_LIMIT) : [];
  const entryView = (row: MarketRow): MarketEntry => {
    const values = data(row);
    const points = integer(values.points);
    return {
      id: row.id,
      learnerId: integer(values.learnerId),
      learnerName: userName(runtime, values.learnerId),
      points: Math.abs(points),
      reason: String(values.reason ?? ""),
      kind: values.kind === "purchase" ? "purchase" : "earn",
      createdAt: row.createdAt.toISOString(),
      actorName: userName(runtime, values.actorId),
    };
  };
  const entries = visibleLedger.map(entryView);
  const ownEntries = learner ? ledger
    .filter((row) => integer(data(row).learnerId) === user!.id).slice(0, RECENT_LIMIT).map(entryView) : [];
  const visiblePurchases = canViewLogs
    ? purchases.slice(0, RECENT_LIMIT)
    : learner ? purchases.filter((row) => integer(data(row).learnerId) === user.id).slice(0, RECENT_LIMIT) : [];
  const purchaseView = (row: MarketRow): MarketPurchase => {
    const values = data(row);
    return {
      id: row.id,
      learnerId: integer(values.learnerId),
      learnerName: userName(runtime, values.learnerId),
      productName: String(values.productName ?? ""),
      pricePoints: integer(values.pricePoints),
      status: values.status === "fulfilled" ? "fulfilled" : "pending",
      createdAt: row.createdAt.toISOString(),
      fulfilledAt: typeof values.fulfilledAt === "string" ? values.fulfilledAt : null,
    };
  };
  const purchaseViews = visiblePurchases.map(purchaseView);
  const ownPurchases = learner ? purchases
    .filter((row) => integer(data(row).learnerId) === user!.id).slice(0, RECENT_LIMIT).map(purchaseView) : [];
  const canAwardPoints = Boolean(isAdmin || isKeeper);
  const canLogPoints = Boolean(learner);
  const ownBalance = user ? balanceMap.get(user.id) ?? 0 : 0;
  return {
    kind: "market",
    index,
    market: def.name,
    title: def.title,
    rate: def.rate,
    cap: def.cap,
    balancePoints: ownBalance,
    overdraft: def.overdraft === true,
    canPurchase: Boolean(learner),
    canLogPoints,
    canAwardPoints,
    canManage,
    canViewLogs,
    products,
    entries,
    purchases: purchaseViews,
    ownEntries,
    ownPurchases,
    learners: canAwardPoints
      ? eligible.map((person) => ({ id: person.id, name: person.name, balancePoints: balanceMap.get(person.id) ?? 0 }))
      : [],
  };
}

function lockKey(installId: number, marketName: string): string {
  return `tacon-market:${installId}:${marketName}`;
}

/** All writes serialize on the same transaction-scoped lock for this market. */
async function lockMarket(tx: any, installId: number, marketName: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey(installId, marketName)}, 0))`);
}

function currentTime(): string {
  return new Date().toISOString();
}

function positivePoints(points: number): boolean {
  return Number.isSafeInteger(points) && points > 0;
}

function requestMatches(row: MarketRow, inputs: Record<string, unknown>): boolean {
  const record = data(row);
  return Object.entries(inputs).every(([key, value]) => record[key] === value);
}

function duplicate(rows: MarketRow[], actorId: number, requestId: string) {
  return rows.find((row) => data(row).actorId === actorId && data(row).requestId === requestId);
}

async function validateLearner(runtime: Runtime, learnerId: number): Promise<boolean> {
  return (await eligibleLearners(runtime)).some((person) => person.id === learnerId);
}

export async function recordPoints(runtime: Runtime, def: MarketDef, options: {
  learnerId: number; points: number; reason: string; requestId: string; actorId: number;
}): Promise<{ id: number; balancePoints: number; replayed: boolean }> {
  assertWritableMarket(runtime, def);
  if (!positivePoints(options.points)) throw new MarketError("Points must be a positive whole number.");
  if (!options.reason.trim() || options.reason.length > 500) throw new MarketError("Add a reason of 1–500 characters.");
  if (!(await validateLearner(runtime, options.learnerId))) throw new MarketError("That wallet owner isn't eligible for this market.");
  return db.transaction(async (tx) => {
    await lockMarket(tx, runtime.install.install.id, def.name);
    const ledger = await tx.select().from(taconRecords).where(and(
      eq(taconRecords.installId, runtime.install.install.id),
      eq(taconRecords.store, store(def, "ledger")),
    ));
    const prior = duplicate(ledger, options.actorId, options.requestId);
    const expected = { learnerId: options.learnerId, points: options.points, reason: options.reason.trim(), kind: "earn" };
    if (prior) {
      if (!requestMatches(prior, expected)) throw new MarketError("That request ID was already used for a different points entry.");
      const total = walletBalance(ledger, options.learnerId);
      return { id: prior.id, balancePoints: total, replayed: true };
    }
    const currentBalance = walletBalance(ledger, options.learnerId);
    if (!Number.isSafeInteger(currentBalance + options.points) || currentBalance + options.points > def.cap) {
      throw new MarketError(`That award would exceed this market's wallet limit of ${def.cap} points.`);
    }
    const [record] = await tx.insert(taconRecords).values({
      academyId: runtime.academyId,
      installId: runtime.install.install.id,
      store: store(def, "ledger"),
      createdByType: "user",
      createdBy: options.actorId,
      data: {
        market: def.name, learnerId: options.learnerId, points: options.points,
        kind: "earn", reason: options.reason.trim(), actorId: options.actorId,
        requestId: options.requestId,
      },
    }).returning();
    return { id: record.id, balancePoints: currentBalance + options.points, replayed: false };
  });
}

function validProduct(product: Omit<Product, "id">): boolean {
  return product.name.trim().length > 0 && product.name.length <= 100 &&
    product.description.length <= 1000 && positivePoints(product.pricePoints) &&
    typeof product.active === "boolean";
}

export async function saveProduct(runtime: Runtime, def: MarketDef, product: Omit<Product, "id">, id?: number): Promise<Product> {
  assertWritableMarket(runtime, def);
  if (!validProduct(product)) throw new MarketError("Enter a product name, description, and positive whole-number price.");
  return db.transaction(async (tx) => {
    await lockMarket(tx, runtime.install.install.id, def.name);
    if (id !== undefined) {
      const [current] = await tx.select().from(taconRecords).where(and(
        eq(taconRecords.id, id), eq(taconRecords.installId, runtime.install.install.id),
        eq(taconRecords.store, store(def, "catalog")),
      )).limit(1);
      if (!current) throw new MarketError("That product no longer exists.");
      const previous = data(current);
      const nextData = { ...previous, name: product.name.trim(), description: product.description, pricePoints: product.pricePoints, active: product.active, updatedAt: currentTime() };
      const [updated] = await tx.update(taconRecords).set({ data: nextData, updatedAt: new Date() }).where(eq(taconRecords.id, id)).returning();
      return { id: updated.id, name: product.name.trim(), description: product.description, pricePoints: product.pricePoints, active: product.active };
    }
    const [created] = await tx.insert(taconRecords).values({
      academyId: runtime.academyId, installId: runtime.install.install.id, store: store(def, "catalog"),
      createdByType: "user", createdBy: runtime.user!.id,
      data: { market: def.name, name: product.name.trim(), description: product.description, pricePoints: product.pricePoints, active: product.active, createdAt: currentTime() },
    }).returning();
    return { id: created.id, name: product.name.trim(), description: product.description, pricePoints: product.pricePoints, active: product.active };
  });
}

export async function purchaseProduct(runtime: Runtime, def: MarketDef, options: {
  productId: number; learnerId: number; actorId: number; requestId: string;
}): Promise<{ purchaseId: number; balancePoints: number; replayed: boolean }> {
  assertWritableMarket(runtime, def);
  if (!(await validateLearner(runtime, options.learnerId))) throw new MarketError("That wallet owner isn't eligible for this market.");
  return db.transaction(async (tx) => {
    await lockMarket(tx, runtime.install.install.id, def.name);
    const catalog = await tx.select().from(taconRecords).where(and(
      eq(taconRecords.installId, runtime.install.install.id),
      eq(taconRecords.store, store(def, "catalog")),
    ));
    const ledger = await tx.select().from(taconRecords).where(and(
      eq(taconRecords.installId, runtime.install.install.id),
      eq(taconRecords.store, store(def, "ledger")),
    ));
    const purchases = await tx.select().from(taconRecords).where(and(
      eq(taconRecords.installId, runtime.install.install.id),
      eq(taconRecords.store, store(def, "purchases")),
    ));
    const prior = duplicate(purchases, options.actorId, options.requestId);
    if (prior) {
      if (!requestMatches(prior, { learnerId: options.learnerId, productId: options.productId })) {
        throw new MarketError("That request ID was already used for a different purchase.");
      }
      const total = walletBalance(ledger, options.learnerId);
      return { purchaseId: prior.id, balancePoints: total, replayed: true };
    }
    const productRecord = catalog.find((row) => row.id === options.productId);
    if (!productRecord || data(productRecord).active !== true) throw new MarketError("That product is no longer available.");
    const productData = data(productRecord);
    const pricePoints = integer(productData.pricePoints);
    if (!positivePoints(pricePoints)) throw new MarketError("That product has an invalid price.");
    const balance = walletBalance(ledger, options.learnerId);
    if (def.overdraft !== true && balance < pricePoints) {
      throw new MarketError("You don't have enough points for that purchase.");
    }
    if (!Number.isSafeInteger(balance - pricePoints)) {
      throw new MarketError("That purchase would exceed the supported balance range.");
    }
    const timestamp = currentTime();
    const [purchase] = await tx.insert(taconRecords).values({
      academyId: runtime.academyId, installId: runtime.install.install.id, store: store(def, "purchases"),
      createdByType: "user", createdBy: options.actorId,
      data: { market: def.name, learnerId: options.learnerId, productId: options.productId,
        productName: String(productData.name), pricePoints, status: "pending", createdAt: timestamp,
        fulfilledAt: null, requestId: options.requestId, actorId: options.actorId },
    }).returning();
    await tx.insert(taconRecords).values({
      academyId: runtime.academyId, installId: runtime.install.install.id, store: store(def, "ledger"),
      createdByType: "user", createdBy: options.actorId,
      data: { market: def.name, learnerId: options.learnerId, points: -pricePoints, kind: "purchase",
        reason: `Purchased ${String(productData.name)}`, actorId: options.actorId, purchaseId: purchase.id },
    });
    return { purchaseId: purchase.id, balancePoints: balance - pricePoints, replayed: false };
  });
}

export async function fulfillPurchase(runtime: Runtime, def: MarketDef, purchaseId: number, actorId: number): Promise<{ id: number; fulfilled: boolean }> {
  assertWritableMarket(runtime, def);
  return db.transaction(async (tx) => {
    await lockMarket(tx, runtime.install.install.id, def.name);
    const [purchase] = await tx.select().from(taconRecords).where(and(
      eq(taconRecords.id, purchaseId), eq(taconRecords.installId, runtime.install.install.id),
      eq(taconRecords.store, store(def, "purchases")),
    )).limit(1);
    if (!purchase) throw new MarketError("That purchase no longer exists.");
    const previous = data(purchase);
    if (previous.status === "fulfilled") return { id: purchase.id, fulfilled: false };
    const fulfilledAt = currentTime();
    await tx.update(taconRecords).set({
      data: { ...previous, status: "fulfilled", fulfilledAt, fulfilledBy: actorId },
      updatedAt: new Date(),
    }).where(eq(taconRecords.id, purchase.id));
    return { id: purchase.id, fulfilled: true };
  });
}
