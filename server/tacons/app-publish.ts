/**
 * Checking an app package for publishing, shared by the Dev menu and the dev
 * portal. The browser bundles the folder; the server checks the result again
 * with the same rules, because a request can come from anywhere.
 */

import { z } from "zod";
import { checkApp, manifestForApp, type AppCheck, type Manifest } from "@shared/tacons";

export const appBodySchema = z.object({
  manifest: z.unknown(),
  html: z.string().max(3_000_000),
});

/** What a publish request said when TacScript source was sent instead of an app. */
export const TACSCRIPT_RETIRED =
  "TacScript has been retired. Publish a Tac-On as an app: a folder with manifest.json and index.html. Tac-Ons already installed keep working until you publish their app version.";

export type PreparedApp =
  | { ok: true; manifest: Manifest; source: string; checks: AppCheck[] }
  | { ok: false; checks: AppCheck[]; error: string };

/**
 * The engine manifest and stored source for a package, or the checklist of
 * what's wrong. `source` is the package as JSON, which is what Export hands
 * back and what the Dev menu reopens for the next version.
 */
export function prepareApp(app: unknown): PreparedApp {
  const parsed = appBodySchema.safeParse(app);
  if (!parsed.success) {
    return { ok: false, checks: [], error: "Send the app as { manifest, html }." };
  }
  const result = checkApp({ manifest: parsed.data.manifest, html: parsed.data.html });
  if (!result.ok || !result.pkg) {
    return { ok: false, checks: result.checks, error: "This app doesn't pass its checks yet." };
  }
  return {
    ok: true,
    manifest: manifestForApp(result.pkg),
    source: JSON.stringify(result.pkg),
    checks: result.checks,
  };
}
