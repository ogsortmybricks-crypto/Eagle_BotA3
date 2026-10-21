import { eq } from "drizzle-orm";
import { db } from "../db";
import { taconControls, type User } from "@shared/schema";
import { AUDIENCES, positionAudience, studioPositionAudience, audienceStudioPosition, type Manifest } from "@shared/tacons";
import { accessRules, granted, setupPlan, type InstallControls, type Operation } from "@shared/tacons/contract";
import { heldNames } from "./positions";
import type { LoadedInstall } from "./registry";

export class TaconAccessError extends Error {
  constructor(message: string, public status = 403) { super(message); }
}
export async function controlsFor(installId: number, manifest: Manifest): Promise<InstallControls> {
  const [saved] = await db.select().from(taconControls).where(eq(taconControls.installId, installId));
  return saved ?? { grants: [], policy: {}, selectedSetup: setupPlan(manifest).filter(step => !step.optional).map(step => step.id), setupResults: [] };
}
export function validAudience(manifest: Manifest, entry: string) {
  return entry === "none" || (AUDIENCES as readonly string[]).includes(entry) ||
    manifest.positions.some(position => positionAudience(position.name) === entry) ||
    (manifest.studioPositions ?? []).some(title => studioPositionAudience(title) === entry);
}
export function policyAllows(manifest: Manifest, controls: InstallControls, operation: Operation, user: User | null, held: ReadonlySet<string>) {
  // Academy admins always retain configuration/recovery access, even if a
  // publisher declares an impossible audience or a selected seat is absent.
  if (operation === "configure" && user?.role === "admin") return true;
  if (!user) return operation !== "configure"; // Consented native background hooks only.
  const rules = accessRules(manifest, controls, operation);
  return rules.length === 0 || rules.some(rule => rule === "everyone" || rule === user.role ||
    (rule === "dev" && user.devStatus) ||
    manifest.positions.some(position => rule === positionAudience(position.name) && held.has(position.name)) ||
    (audienceStudioPosition(rule) !== null && held.has(rule)));
}
export async function installAllows(entry: LoadedInstall, user: User, operation: Operation) {
  return policyAllows(entry.manifest, await controlsFor(entry.install.id, entry.manifest), operation, user, await heldNames(user.id, entry.install.id));
}
export type GovernedRuntime = { install: LoadedInstall; controls: InstallControls; user: User | null; held: ReadonlySet<string> };
export function canAccess(runtime: GovernedRuntime, operation: Operation) {
  if (!policyAllows(runtime.install.manifest, runtime.controls, operation, runtime.user, runtime.held)) return false;
  if (operation === "read" || operation === "write") {
    return granted(runtime.install.manifest, runtime.controls, operation === "read" ? "storage.read" : "storage.write");
  }
  return true;
}
export function demandAccess(runtime: GovernedRuntime, operation: Operation) {
  if (!canAccess(runtime, operation)) throw new TaconAccessError(`This installation does not allow you to ${operation}. Ask an academy admin to review its permissions.`);
}
export function demandCapability(runtime: GovernedRuntime, capability: string) {
  if (!granted(runtime.install.manifest, runtime.controls, capability)) throw new TaconAccessError(`Capability "${capability}" is not granted to this installation.`);
}
export async function canReadShared(runtime: GovernedRuntime, target: LoadedInstall) {
  const controls = await controlsFor(target.install.id, target.manifest);
  return granted(runtime.install.manifest, runtime.controls, "sharing.read") &&
    granted(target.manifest, controls, "sharing.provide") &&
    granted(target.manifest, controls, "storage.read") &&
    (!runtime.user || ((await installAllows(target, runtime.user, "view")) && (await installAllows(target, runtime.user, "read"))));
}
