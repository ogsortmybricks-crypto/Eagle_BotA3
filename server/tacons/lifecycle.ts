import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { taconControls, taconInstalls, positions } from "@shared/schema";
import { setupPlan, type SetupResult } from "@shared/tacons/contract";
import type { Manifest } from "@shared/tacons";
import type { LoadedInstall } from "./registry";
import { controlsFor, TaconAccessError } from "./governance";
import { syncPositions } from "./positions";
import { logActivity } from "../activity";

export const reviewSchema = z.object({
  reviewedVersionId: z.number().int().positive().optional(),
  grants: z.array(z.string().max(80)).max(9).default([]),
  selectedSetup: z.array(z.string().max(80)).max(1).default([]),
});
export function validateReview(manifest: Manifest, versionId: number, review: z.infer<typeof reviewSchema>) {
  if (manifest.contract && review.reviewedVersionId !== versionId) throw new TaconAccessError("Review this exact version before installing or updating. Reload the listing if it changed.", 409);
  if (review.grants.some(cap => !manifest.contract?.capabilities.includes(cap as never))) throw new TaconAccessError("Only capabilities requested by this version may be granted.", 400);
  const plan = setupPlan(manifest);
  if (review.selectedSetup.some(id => !plan.some(step => step.id === id))) throw new TaconAccessError("Unknown setup action.", 400);
  return [...new Set([...review.selectedSetup, ...plan.filter(step => !step.optional).map(step => step.id)])];
}
export function checkedSettings(manifest: Manifest, values: Record<string, unknown>) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const setting of manifest.settings) {
    const field: z.ZodTypeAny = setting.type === "boolean" ? z.boolean() :
      setting.type === "number" ? z.number().finite() :
      setting.type === "choice" ? z.string().refine(value => setting.options.includes(value), "Choose a declared option.") :
      z.string().max(2000);
    shape[setting.name] = field.default(setting.default);
  }
  const checked = z.object(shape).strict().safeParse(values);
  if (!checked.success) throw new TaconAccessError(`Invalid Tac-On settings: ${checked.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`, 400);
  return checked.data;
}

/** A transaction/advisory lock serializes retries, upgrades and host setup. */
export async function executeSetup(entry: LoadedInstall, actorUserId: number): Promise<SetupResult[]> {
  try {
    let createdSeats: { id: number; title: string }[] = [];
    const results = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(72421, ${entry.install.id})`);
      const [current] = await tx.select().from(taconInstalls).where(eq(taconInstalls.id, entry.install.id)).for("update");
      if (!current || current.versionId !== entry.install.versionId) throw new TaconAccessError("The installed version changed. Reload before retrying setup.", 409);
      const [control] = await tx.select().from(taconControls).where(eq(taconControls.installId, entry.install.id));
      const selected = control?.selectedSetup ?? (await controlsFor(entry.install.id, entry.manifest)).selectedSetup;
      const results: SetupResult[] = [];
      const before = await tx.select({ id: positions.id }).from(positions).where(eq(positions.taconInstallId, current.id));
      if (!selected.includes("positions")) await tx.update(positions).set({ archived: true, updatedAt: new Date() }).where(eq(positions.taconInstallId, current.id));
      for (const step of setupPlan(entry.manifest)) {
        if (!selected.includes(step.id)) {
          results.push({ id: step.id, status: "skipped", message: step.purpose });
          continue;
        }
        await syncPositions({ install: current, taconName: entry.tacon.name, manifest: entry.manifest, actorUserId, database: tx, log: false });
        results.push({ id: step.id, status: "completed", message: `${entry.manifest.positions.length} declared position(s) synchronized. Existing seats and their history were preserved.` });
      }
      if (control) await tx.update(taconControls).set({ setupResults: results, updatedAt: new Date() }).where(eq(taconControls.installId, current.id));
      const after = await tx.select({ id: positions.id, title: positions.title }).from(positions).where(eq(positions.taconInstallId, current.id));
      createdSeats = after.filter(seat => !before.some(old => old.id === seat.id));
      return results;
    });
    // Keep existing position.created hooks, but only after host setup commits.
    // A logging failure must not claim successfully committed setup rolled back.
    for (const seat of createdSeats) {
      try {
        await logActivity({ academyId: entry.install.academyId, studioId: entry.install.studioId, actorUserId,
          actorLabel: entry.tacon.name, action: "position.created", entityType: "position", entityId: seat.id,
          summary: `The Tac-On "${entry.tacon.name}" added the position "${seat.title}".` });
      } catch (error) { console.error("[tacons] committed setup activity could not be recorded", error); }
    }
    return results;
  } catch (error) {
    if (error instanceof TaconAccessError) throw error;
    // Host changes rolled back together. Installation and extension data stay
    // intact, with a visible result and an explicit retry action.
    const results: SetupResult[] = [{ id: "positions", status: "failed", message: "Setup rolled back without partial host changes. Retry setup, or ask an admin to check the server log." }];
    console.error("[tacons] setup failed", error);
    await db.update(taconControls).set({ setupResults: results }).where(eq(taconControls.installId, entry.install.id));
    return results;
  }
}
