import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { test } from "node:test";
import express from "express";
import { and, eq } from "drizzle-orm";
import { academies, positionHolders, positions, studios, taconInstalls, taconRecords, taconVersions, tacons, users } from "@shared/schema";
import { compile, type MarketDef } from "@shared/tacons";
import { DEFAULT_SETTINGS } from "@shared/settings";
import { db } from "../db";
import { addRecord, type Runtime } from "./runtime";
import { heldNames } from "./positions";
import {
  fulfillPurchase,
  isReservedMarketStore,
  marketInstallCompatible,
  marketRequiresAcademyInstall,
  purchaseProduct,
  recordPoints,
  renderMarket,
  saveProduct,
  validMarketDefinition,
} from "./market";
import { marketStore } from "@shared/tacons/market";
import { taconsRouter } from "../routes/tacons";

const runDatabaseTests =
  process.env.NODE_ENV === "development" &&
  process.env.RUN_TACON_MARKET_DB_TESTS === "true";

test("market definitions enforce the compiler's safe integer policy and reserved store names", () => {
  const base: MarketDef = { name: "wallet", title: "Wallet", rate: 100, cap: 1000, keeper: "shopkeeper", scope: "academy" };
  assert.equal(validMarketDefinition(base), true);
  assert.equal(validMarketDefinition({ ...base, cap: 99 }), false);
  assert.equal(validMarketDefinition({ ...base, cap: 1_000_000_001 }), false);
  assert.equal(marketRequiresAcademyInstall(base), true);
  assert.equal(marketRequiresAcademyInstall({ ...base, scope: "install" }), false);
  assert.equal(marketInstallCompatible(base, null), true);
  assert.equal(marketInstallCompatible(base, 7), false);
  assert.equal(isReservedMarketStore(marketStore(base.name, "ledger")), true);
  assert.equal(isReservedMarketStore("ordinary_records"), false);
});

test("PostgreSQL market transactions serialize cap awards, purchases, retries and snapshots", {
  skip: !runDatabaseTests
    ? "Set NODE_ENV=development and RUN_TACON_MARKET_DB_TESTS=true against the isolated development database."
    : false,
}, async () => {
  const key = randomUUID();
  let academyId: number | undefined;
  let httpServer: Server | undefined;
  try {
    const [academy] = await db.insert(academies).values({
      name: `Transient market test ${key}`,
      emailDomain: `${key}.market.invalid`,
      palette: { primary: "#000000", accent: "#ffffff", surface: "#ffffff" },
    }).returning();
    academyId = academy.id;
    const [studio] = await db.insert(studios).values({
      academyId, name: "Transient Studio", slug: `market-${key}`,
    }).returning();
    const [admin] = await db.insert(users).values({
      academyId, studioId: null, email: `admin-${key}@market.invalid`,
      name: "Test Admin", role: "admin",
    }).returning();
    const [learnerA] = await db.insert(users).values({
      academyId, studioId: studio.id, email: `learner-a-${key}@market.invalid`,
      name: "Learner A", role: "learner",
    }).returning();
    const [learnerB] = await db.insert(users).values({
      academyId, studioId: studio.id, email: `learner-b-${key}@market.invalid`,
      name: "Learner B", role: "learner",
    }).returning();

    const def: MarketDef = {
      name: "wallet", title: "Wallet", rate: 100, cap: 1000, keeper: "shopkeeper", scope: "academy",
    };
    const source = readFileSync(new URL("../../tacons/eagle-buck-market/eagle-buck-market.tacon", import.meta.url), "utf8");
    const compiled = compile(source);
    assert.ok(compiled.ok, JSON.stringify(compiled.diagnostics));
    const manifest = compiled.manifest;
    const [tacon] = await db.insert(tacons).values({
      slug: `transient-market-${key}`, name: "Transient Market", academyId, authorUserId: admin.id,
    }).returning();
    const [version] = await db.insert(taconVersions).values({
      taconId: tacon.id, version: "1.0.0", source, manifest: manifest as unknown as Record<string, unknown>,
    }).returning();
    const [install] = await db.insert(taconInstalls).values({
      academyId, studioId: null, taconId: tacon.id, versionId: version.id, installedBy: admin.id,
    }).returning();
    const [keeperPosition] = await db.insert(positions).values({
      academyId, studioId: null, title: "Shopkeeper", taconInstallId: install.id, taconPosition: def.keeper,
    }).returning();
    await db.insert(positionHolders).values({
      academyId, positionId: keeperPosition.id, userId: learnerA.id,
    });

    const runtimeFor = async (user: typeof admin, studioId: number | null): Promise<Runtime> => ({
      academyId,
      user,
      scope: {
        studioId, studio: studioId === null ? null : studio, allowed: [studio], allowedIds: [studio.id],
        circleIds: studioId === null ? [] : [studio.id], readableIds: [studio.id],
        canSeeAll: studioId === null, canWriteShared: user.role === "admin", effective: {} as never,
      },
      settings: {} as never,
      install: {
        install, tacon, version, manifest, studioName: null,
      },
      uses: new Map(), rows: new Map(), computed: new Map(), resolving: new Set(),
      people: new Map([[admin.id, admin.name], [learnerA.id, learnerA.name], [learnerB.id, learnerB.name]]),
      held: await heldNames(user.id, install.id),
      positions: {},
    } as unknown as Runtime);
    const adminRuntime = await runtimeFor(admin, null);
    const learnerRuntime = await runtimeFor(learnerA, studio.id);
    const learnerBRuntime = await runtimeFor(learnerB, studio.id);

    const earn = (learnerId: number, points: number, reason: string, requestId: string) =>
      recordPoints(adminRuntime, def, { learnerId, points, reason, requestId, actorId: admin.id });
    const firstAwardRequest = randomUUID();
    const firstAward = await earn(learnerA.id, 900, "Initial award", firstAwardRequest);
    const awardRetry = await earn(learnerA.id, 900, "Initial award", firstAwardRequest);
    assert.equal(awardRetry.replayed, true);
    assert.equal(awardRetry.id, firstAward.id);
    await assert.rejects(() => earn(learnerA.id, 900, "Different input", firstAwardRequest), /request ID was already used/);
    const capRace = await Promise.allSettled([
      earn(learnerA.id, 100, "Near cap A", randomUUID()),
      earn(learnerA.id, 100, "Near cap B", randomUUID()),
    ]);
    assert.equal(capRace.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(capRace.filter((result) => result.status === "rejected").length, 1);
    await assert.rejects(() => earn(learnerA.id, 1, "Past cap", randomUUID()), /wallet limit/);

    const seedRequest = randomUUID();
    await earn(learnerB.id, 1000, "Purchase balance", seedRequest);
    const product = await saveProduct(adminRuntime, def, {
      name: "Workshop", description: "A workshop place", pricePoints: 700, active: true,
    });
    const purchaseIds = [randomUUID(), randomUUID()];
    const purchaseRace = await Promise.allSettled(purchaseIds.map((requestId) =>
      purchaseProduct(learnerBRuntime, def, {
        learnerId: learnerB.id, actorId: learnerB.id, productId: product.id, requestId,
      }),
    ));
    assert.equal(purchaseRace.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(purchaseRace.filter((result) => result.status === "rejected").length, 1);
    const success = purchaseRace.find((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof purchaseProduct>>> =>
      result.status === "fulfilled",
    )!;
    const replayId = purchaseIds[purchaseRace.indexOf(success)];
    const replay = await purchaseProduct(learnerBRuntime, def, {
      learnerId: learnerB.id, actorId: learnerB.id, productId: product.id, requestId: replayId,
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.purchaseId, success.value.purchaseId);
    assert.equal(replay.balancePoints, 300);
    await assert.rejects(() => purchaseProduct(learnerBRuntime, def, {
      learnerId: learnerB.id, actorId: learnerB.id, productId: product.id + 1, requestId: replayId,
    }), /request ID was already used/);

    const archived = await saveProduct(adminRuntime, def, {
      ...product, name: "Archived workshop", pricePoints: 900, active: false,
    }, product.id);
    assert.equal(archived.active, false);
    const purchasedId = success.value.purchaseId;
    const firstFulfillment = await fulfillPurchase(learnerRuntime, def, purchasedId, learnerA.id);
    const secondFulfillment = await fulfillPurchase(learnerRuntime, def, purchasedId, learnerA.id);
    assert.equal(firstFulfillment.fulfilled, true);
    assert.equal(secondFulfillment.fulfilled, false);
    assert.equal(secondFulfillment.id, purchasedId);

    const keeperView = await renderMarket(learnerRuntime, { kind: "market", market: def.name }, 0);
    assert.ok(keeperView);
    assert.equal(keeperView.canViewLogs, true);
    assert.equal(keeperView.purchases.find((purchase) => purchase.id === purchasedId)?.productName, "Workshop");
    assert.equal(keeperView.purchases.find((purchase) => purchase.id === purchasedId)?.pricePoints, 700);
    assert.equal(keeperView.purchases.find((purchase) => purchase.id === purchasedId)?.status, "fulfilled");
    assert.equal(keeperView.canManage, true);
    assert.equal(keeperView.canLogPoints, true, "A learner Shopkeeper keeps their own wallet.");
    assert.equal(keeperView.products.find((entry) => entry.id === product.id)?.active, false);
    const adminView = await renderMarket(adminRuntime, { kind: "market", market: def.name }, 0);
    assert.ok(adminView);
    assert.equal(adminView.canViewLogs, true);
    assert.equal(adminView.canLogPoints, false, "Staff must select a learner rather than use a nonexistent staff wallet.");
    assert.equal(adminView.canAwardPoints, true);
    assert.equal(adminView.products.find((entry) => entry.id === product.id)?.active, false);
    const ownView = await renderMarket(learnerBRuntime, { kind: "market", market: def.name }, 0);
    assert.ok(ownView);
    assert.equal(ownView.canViewLogs, false);
    assert.ok(ownView.entries.every((entry) => entry.learnerId === learnerB.id));
    assert.equal(ownView.balancePoints, 300);

    // Crossing the generic store's 2,000-row window must not change the balance.
    const historicalRows = Array.from({ length: 2002 }, (_, index) => ({
      academyId: academyId!,
      installId: install.id,
      store: marketStore(def.name, "ledger"),
      createdByType: "user" as const,
      createdBy: admin.id,
      data: {
        learnerId: learnerB.id, points: index % 2 === 0 ? 1 : -1,
        kind: index % 2 === 0 ? "earn" : "purchase", reason: "History window fixture", actorId: admin.id,
      },
    }));
    for (let offset = 0; offset < historicalRows.length; offset += 500) {
      await db.insert(taconRecords).values(historicalRows.slice(offset, offset + 500));
    }
    const longLedgerView = await renderMarket(learnerBRuntime, { kind: "market", market: def.name }, 1);
    assert.equal(longLedgerView?.balancePoints, 300);
    assert.equal(longLedgerView?.entries.length, 200);

    const genericWrite = await addRecord(adminRuntime, marketStore(def.name, "ledger"), {}, { type: "user", userId: admin.id });
    assert.equal(genericWrite.ok, false);
    const incompatible = { ...def, scope: "academy" as const };
    const studioRuntime = { ...adminRuntime, install: { ...adminRuntime.install, install: { ...install, studioId: studio.id } } } as Runtime;
    assert.equal(await renderMarket(studioRuntime, { kind: "market", market: def.name }, 0), null);
    await assert.rejects(() => recordPoints(studioRuntime, incompatible, {
      learnerId: learnerA.id, points: 1, reason: "Wrong scope", requestId: randomUUID(), actorId: admin.id,
    }), /academy-wide install/);
    assert.equal(isReservedMarketStore("__market_wallet_ledger"), true);

    // This fixture-only HTTP app mocks authenticated context, not sessions.
    // It is never imported by the application or mounted on its real server.
    let asUser: typeof admin | undefined = admin;
    const app = express();
    app.use(express.json());
    app.use(async (req, _res, next) => {
      try {
        req.user = asUser;
        req.academy = academy;
        req.settings = DEFAULT_SETTINGS;
        req.scope = asUser
          ? (await runtimeFor(asUser, asUser.role === "admin" ? null : studio.id)).scope
          : undefined;
        next();
      } catch (error) { next(error); }
    });
    app.use("/tacons", taconsRouter);
    httpServer = await new Promise<Server>((resolve) => {
      const server = app.listen(0, "127.0.0.1", () => resolve(server));
    });
    const address = httpServer.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/tacons/view/${install.id}/markets/wallet`;
    const location = { page: "market", index: 1 };
    const request = async (path: string, body: Record<string, unknown>, method = "POST") => {
      const response = await fetch(`${base}${path}`, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...location, ...body }),
      });
      return { status: response.status, body: await response.json() };
    };
    const catalogInput = { name: "Route test", description: "Test item", pricePoints: 50, active: true };
    asUser = undefined;
    assert.equal((await request("/products", catalogInput)).status, 401);
    asUser = learnerB;
    assert.equal((await request("/products", catalogInput)).status, 403);
    assert.equal((await request("/points", {
      learnerId: learnerA.id, points: 1, reason: "Forged recipient", requestId: randomUUID(),
    })).status, 403);
    assert.equal((await request("/purchase", { productId: product.id, requestId: randomUUID() })).status, 400, "Archived items cannot be bought.");
    asUser = learnerA;
    const deskLocation = { page: undefined, position: "shopkeeper", index: 1 };
    const keeperProduct = await request("/products", { ...catalogInput, ...deskLocation });
    assert.equal(keeperProduct.status, 201, "The current Shopkeeper may add products from their desk.");
    const keeperProductId = keeperProduct.body.product.id;
    assert.equal((await request(`/products/${keeperProductId}`, {
      ...catalogInput, pricePoints: 100, active: false,
    }, "PATCH")).status, 200, "The current Shopkeeper may edit and archive products.");
    assert.equal((await request(`/products/${keeperProductId}`, {
      ...catalogInput, pricePoints: 100, ...deskLocation,
    }, "PATCH")).status, 200, "The current Shopkeeper may reactivate products from their desk.");
    assert.equal((await request("/purchase", { productId: keeperProductId, requestId: randomUUID() })).status, 201);
    const selfAward = await request("/points", {
      ...deskLocation, points: 100, reason: "Shopkeeper's own earnings", requestId: randomUUID(),
    });
    assert.equal(selfAward.status, 201, "Omitting a recipient credits the learner Shopkeeper's own wallet.");
    assert.equal(selfAward.body.balancePoints, 1000);
    const selfEntry = (await renderMarket(learnerRuntime, { kind: "market", market: def.name }, 1))?.entries
      .find((entry) => entry.id === selfAward.body.id);
    assert.equal(selfEntry?.learnerId, learnerA.id);
    assert.equal(selfEntry?.reason, "Shopkeeper's own earnings");
    assert.equal((await request("/points", {
      ...deskLocation, points: 1, reason: "Over cap", requestId: randomUUID(),
    })).status, 400, "Shopkeeper self-awards cannot bypass the 1,000-point cap.");
    assert.equal((await request("/points", {
      learnerId: learnerB.id, points: 25, reason: "Keeper-awarded points", requestId: randomUUID(),
    })).status, 201, "A learner holding the Shopkeeper position may award another learner.");
    asUser = admin;
    const createdProduct = await request("/products", catalogInput);
    assert.equal(createdProduct.status, 201);
    assert.equal((await request("/purchase", { productId: createdProduct.body.product.id, requestId: randomUUID() })).status, 403);
    assert.equal((await request("/points", { points: 1, reason: "Staff wallet", requestId: randomUUID() })).status, 400);
    assert.equal((await request("/products", { ...catalogInput, position: "shopkeeper" })).status, 400);
    assert.equal((await request("/products", { ...catalogInput, index: 0 })).status, 404);
    asUser = learnerB;
    const forgedPrice = await request("/purchase", {
      productId: createdProduct.body.product.id, requestId: randomUUID(),
      pricePoints: 1, learnerId: learnerA.id,
    });
    assert.equal(forgedPrice.status, 201);
    assert.equal(forgedPrice.body.balancePoints, 275, "Server uses the real price and authenticated wallet.");
    assert.equal((await renderMarket(learnerRuntime, { kind: "market", market: def.name }, 1))?.balancePoints, 1000);
    assert.equal((await request(`/purchases/${forgedPrice.body.purchaseId}/fulfill`, {})).status, 403);
    asUser = learnerA;
    assert.equal((await request(`/purchases/${forgedPrice.body.purchaseId}/fulfill`, deskLocation)).status, 200);
    await db.update(positionHolders).set({ endedAt: new Date() }).where(eq(positionHolders.positionId, keeperPosition.id));
    assert.equal((await request("/products", catalogInput)).status, 403, "Former Shopkeepers cannot add products.");
    assert.equal((await request(`/products/${keeperProductId}`, catalogInput, "PATCH")).status, 403);
    assert.equal((await request(`/purchases/${forgedPrice.body.purchaseId}/fulfill`, deskLocation)).status, 403);
    assert.equal((await request("/points", {
      learnerId: learnerB.id, points: 1, reason: "Former holder", requestId: randomUUID(),
    })).status, 403);
    asUser = admin;
    const immutableResponse = await fetch(
      `http://127.0.0.1:${address.port}/tacons/view/${install.id}/records/${purchasedId}`,
      { method: "DELETE" },
    );
    assert.equal(immutableResponse.status, 403);
    await db.update(taconInstalls).set({ enabled: false }).where(eq(taconInstalls.id, install.id));
    assert.equal((await request("/products", catalogInput)).status, 404);
  } finally {
    if (httpServer) await new Promise<void>((resolve, reject) => httpServer!.close((error) => error ? reject(error) : resolve()));
    if (academyId !== undefined) await db.delete(academies).where(eq(academies.id, academyId));
  }
});