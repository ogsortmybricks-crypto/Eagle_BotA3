/**
 * What the browser is sent to run an app, and what the person using it may
 * do with each of its stores. Shared by the app's page and its panels.
 */

import type { Academy, User } from "@shared/schema";
import { compileAudience, type Manifest } from "@shared/tacons";
import type { ViewApp } from "@shared/tacons/view";
import type { LoadedInstall } from "./registry";
import { audienceAllows, type Runtime } from "./runtime";
import type { StoreAccess } from "./app-records";
import { displayModeOf } from "./app-setup";

/** The manifest's `stores` rules, for this person. Stores without rules are open to everyone using the app. */
export function storeAccess(manifest: Manifest, user: User, held: ReadonlySet<string>): StoreAccess {
  const rules = manifest.app?.stores ?? {};
  const staff = user.role === "admin";
  return {
    // Admins can always read and write, so an app can't lock its own academy out of its data.
    mayRead: (store) => staff || !rules[store]?.read || audienceAllows(compileAudience(rules[store].read), user, held),
    mayWrite: (store) => staff || !rules[store]?.write || audienceAllows(compileAudience(rules[store].write), user, held),
    mustSign: (store) => Boolean(rules[store]?.sign),
  };
}

/** Everything the sandboxed frame needs, for one place the app is shown. */
export function appView(options: {
  entry: LoadedInstall;
  runtime: Runtime;
  user: User;
  academy: Academy;
  place: ViewApp["place"];
}): ViewApp | undefined {
  const { entry, runtime, user, academy } = options;
  if (!entry.manifest.app) return undefined;
  const access = storeAccess(entry.manifest, user, runtime.held);
  const rules = entry.manifest.app.stores ?? {};
  return {
    html: entry.manifest.app.html,
    display: options.place === "page" ? displayModeOf(entry.install) : "inline",
    place: options.place,
    stores: Object.fromEntries(
      Object.keys(rules).map((store) => [
        store,
        { read: access.mayRead(store), write: access.mayWrite(store), sign: access.mustSign(store) },
      ]),
    ),
    identity: {
      user: { id: user.id, name: user.name, email: user.email ?? null, role: user.role },
      academy: { id: academy.id, name: academy.name, timeZone: runtime.timeZone },
      studio: entry.install.studioId !== null ? { id: entry.install.studioId, name: entry.studioName ?? "" } : null,
      tacon: {
        installId: entry.install.id,
        name: entry.tacon.name,
        version: entry.version.version,
        icon: entry.manifest.icon,
      },
      clock: {
        today: runtime.clock.today,
        weekStart: runtime.clock.this_week_start,
        weekday: runtime.clock.weekday,
      },
    },
  };
}
