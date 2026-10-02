import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { test } from "node:test";
import express from "express";
import { eq } from "drizzle-orm";
import { portalDevs } from "@shared/schema";
import { db } from "../db";
import { portalRouter } from "./portal";

test("portal validates uploaded source using the server compiler without publishing", {
  skip: process.env.NODE_ENV !== "development" || process.env.RUN_PORTAL_FOLDER_DB_TESTS !== "true",
}, async () => {
  let server: Server | undefined;
  let devId: number | undefined;
  try {
    const [dev] = await db.insert(portalDevs).values({
      name: "Temporary validation fixture",
      email: `folder-validation-${randomUUID()}@test.invalid`,
      passwordHash: "unusable-test-fixture-hash",
    }).returning();
    devId = dev.id;
    let authenticated = false;
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use((req, _res, next) => {
      // Test-only session context. Real portal authentication stays unchanged.
      req.session = { portalDevId: authenticated ? devId : undefined } as typeof req.session;
      next();
    });
    app.use("/portal", portalRouter);
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const post = async (body: unknown) => {
      const res = await fetch(`http://127.0.0.1:${address.port}/portal/tacons/validate`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    };
    const source = readFileSync(new URL("../../tacons/eagle-buck-market/eagle-buck-market.tacon", import.meta.url), "utf8");
    assert.equal((await post({ source })).status, 401);
    authenticated = true;
    const valid = await post({ source });
    assert.equal(valid.status, 200);
    assert.equal(valid.body.ok, true);
    assert.deepEqual(valid.body.manifest, {
      slug: "eagle-buck-market", name: "Eagle Buck Market", version: "1.1.0", academyWide: true,
    });
    const invalid = await post({ source: source.replace("keeper shopkeeper", "keeper missing") });
    assert.equal(invalid.status, 200);
    assert.equal(invalid.body.ok, false);
    assert.equal(invalid.body.manifest, null);
    assert.ok(invalid.body.diagnostics.some((d: { line: number; severity: string }) => d.line > 0 && d.severity === "error"));
    assert.equal((await post({ source: "a".repeat(200_001) })).status, 400);
    assert.equal((await post({ source: "" })).status, 400);
    await db.update(portalDevs).set({ active: false }).where(eq(portalDevs.id, devId));
    assert.equal((await post({ source })).status, 401);
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    if (devId !== undefined) await db.delete(portalDevs).where(eq(portalDevs.id, devId));
  }
});