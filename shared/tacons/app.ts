/**
 * Tac-On apps: the package format that replaced TacScript.
 *
 * A Tac-On is now a small web app - a folder with a `manifest.json` and an
 * `index.html`, plus any CSS and JS it links - in the shape of an Eggstension.
 * The folder is bundled into one HTML fragment, and the published version
 * stores `{ manifest, html }`.
 *
 * The one thing that is deliberately *not* like an Eggstension: the app never
 * runs in Eagle Bot's own page. It runs in a sandboxed frame with no access to
 * Eagle Bot's cookies, storage or network, and reaches Eagle Bot only through
 * the `EagleBot` SDK, whose every call the server checks against the role of
 * the person using it. A learner at another academy can write an app; they
 * can't write one that acts as whichever admin opens it.
 *
 * Everything here is shared, so the Dev menu shows the same checklist the
 * server enforces when publishing.
 */

import { z } from "zod";
import type { Manifest, PageDef } from "./types";

/* -------------------------------------------------------------------------- */
/*  Limits                                                                     */
/* -------------------------------------------------------------------------- */

export const APP_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const APP_NAME_MAX = 50;
export const SEMVER = /^\d+\.\d+\.\d+$/;
/** The bundled HTML, everything inlined. */
export const MAX_APP_HTML_BYTES = 2_000_000;
/** A folder upload, before bundling. */
export const MAX_APP_FILES = 200;
export const APP_FILE_TYPES = [".html", ".htm", ".css", ".js", ".mjs", ".json"];
/** What a package file for sharing is called. `.eggstension` files are read too. */
export const APP_FILE_EXTENSION = ".taconapp";

/* -------------------------------------------------------------------------- */
/*  Setup actions                                                              */
/* -------------------------------------------------------------------------- */

/** Fields every setup action may carry, to make it a question at install time. */
const askable = {
  /** Shown as a tickbox the installing admin answers, instead of always running. */
  optional: z.boolean().optional(),
  /** Whether that tickbox starts ticked. */
  default: z.boolean().optional(),
  prompt: z.string().max(200).optional(),
  why: z.string().max(300).optional(),
  /** A stable key, so answers survive the array being reordered. */
  id: z.string().max(60).optional(),
};

export const setupActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("createPosition"),
    title: z.string().trim().min(1).max(120),
    description: z.string().max(2000).optional(),
    seats: z.number().int().min(1).max(20).optional(),
    elected: z.boolean().optional(),
    ...askable,
  }),
  z.object({
    type: z.literal("createWikiPage"),
    title: z.string().trim().min(1).max(200),
    content: z.string().min(1).max(50_000),
    ...askable,
  }),
  z.object({
    type: z.literal("enableFullWindow"),
    mode: z.enum(["fullscreen", "inline"]).optional(),
    ...askable,
  }),
]);

export type SetupAction = z.infer<typeof setupActionSchema>;
export const SETUP_ACTION_TYPES = ["createPosition", "createWikiPage", "enableFullWindow"] as const;

/* -------------------------------------------------------------------------- */
/*  manifest.json                                                              */
/* -------------------------------------------------------------------------- */

export const appManifestSchema = z.object({
  name: z.string(),
  title: z.string(),
  version: z.string(),
  description: z.string(),
  author: z.string(),
  icon: z.string(),
  category: z.string().max(40).optional(),
  setup: z.array(z.unknown()).max(30).optional(),
});

export type AppManifest = {
  name: string;
  title: string;
  version: string;
  description: string;
  author: string;
  icon: string;
  category?: string;
  setup?: SetupAction[];
};

/** A published app: its manifest and its bundled HTML. */
export type AppPackage = { manifest: AppManifest; html: string };

/** What a published version keeps, inside the engine's manifest. */
export type AppDef = {
  html: string;
  author: string;
  setup: SetupAction[];
};

export type AppCheck = { label: string; ok: boolean; message?: string };

/**
 * Every rule a package has to pass, as a checklist the Dev menu can show.
 * `ok` is true only when nothing failed.
 */
export function checkApp(input: { manifest: unknown; html: string | null }): {
  ok: boolean;
  checks: AppCheck[];
  pkg: AppPackage | null;
} {
  const checks: AppCheck[] = [];
  const add = (label: string, problem: string | null) =>
    checks.push(problem ? { label, ok: false, message: problem } : { label, ok: true });

  const parsed = appManifestSchema.safeParse(input.manifest);
  const raw = (input.manifest ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string).trim() : "");

  if (!input.manifest || typeof input.manifest !== "object") {
    add("manifest.json", "manifest.json is missing or isn't a JSON object.");
  } else {
    add("manifest.json", parsed.success ? null : "Every field has to be text: name, title, version, description, author, icon.");
  }

  const name = text("name");
  add(
    "name",
    !name
      ? "Add a name: a short kebab-case id like \"sign-in-sheet\"."
      : !APP_NAME.test(name)
        ? "The name may only use lowercase letters, numbers and single hyphens, like \"sign-in-sheet\"."
        : name.length < 3 || name.length > APP_NAME_MAX
          ? `The name has to be 3 to ${APP_NAME_MAX} characters.`
          : null,
  );
  const title = text("title");
  add("title", !title ? "Add a title: what people see in the sidebar." : title.length > 100 ? "Keep the title under 100 characters." : null);
  const version = text("version");
  add("version", !SEMVER.test(version) ? "The version has to look like 1.0.0 (MAJOR.MINOR.PATCH)." : null);
  const description = text("description");
  add("description", !description ? "Add a one- or two-sentence description." : description.length > 500 ? "Keep the description under 500 characters." : null);
  const author = text("author");
  add("author", !author ? "Add an author: your name or your team's." : author.length > 100 ? "Keep the author under 100 characters." : null);
  const icon = text("icon");
  add("icon", !icon ? "Add an icon: a single emoji, like \"📋\"." : [...icon].length > 4 || /[a-z0-9]/i.test(icon) ? "The icon has to be a single emoji, like \"📋\"." : null);

  const setup: SetupAction[] = [];
  const setupProblems: string[] = [];
  if (raw.setup !== undefined && !Array.isArray(raw.setup)) setupProblems.push("setup has to be a list of actions.");
  for (const [index, entry] of (Array.isArray(raw.setup) ? raw.setup : []).entries()) {
    const where = `setup[${index}]`;
    const action = setupActionSchema.safeParse(entry);
    if (!action.success) {
      const type = (entry as { type?: unknown } | null)?.type;
      setupProblems.push(
        typeof type === "string" && !(SETUP_ACTION_TYPES as readonly string[]).includes(type)
          ? `${where}: "${type}" isn't a setup action. Use ${SETUP_ACTION_TYPES.join(", ")}.`
          : `${where}: ${action.error.issues.map((issue) => `${issue.path.join(".") || "action"} ${issue.message.toLowerCase()}`).join("; ")}.`,
      );
      continue;
    }
    // A question nobody is asked is almost always a mistake.
    if (!action.data.optional && (action.data.prompt || action.data.why)) {
      setupProblems.push(`${where}: "prompt" and "why" only make sense with "optional": true.`);
      continue;
    }
    setup.push(action.data);
  }
  if (Array.isArray(raw.setup) && raw.setup.length > 30) setupProblems.push("Keep setup to 30 actions or fewer.");
  const ids = setup.map((action) => action.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) setupProblems.push("Two setup actions share an id.");
  if (setup.filter((action) => action.type === "enableFullWindow").length > 1) {
    setupProblems.push("Only one enableFullWindow action, please.");
  }
  add("setup", setupProblems.length ? setupProblems.join(" ") : null);

  const html = input.html ?? "";
  add(
    "index.html",
    !input.html
      ? "index.html is missing."
      : new TextEncoder().encode(html).length > MAX_APP_HTML_BYTES
        ? "The bundled app is over 2 MB. Leave large libraries and data out."
        : !html.trim()
          ? "index.html is empty."
          : null,
  );

  const ok = checks.every((check) => check.ok);
  return {
    ok,
    checks,
    pkg: ok
      ? {
          manifest: {
            name,
            title,
            version,
            description,
            author,
            icon,
            ...(text("category") ? { category: text("category").toLowerCase() } : {}),
            ...(setup.length ? { setup } : {}),
          },
          html,
        }
      : null,
  };
}

/**
 * The engine's manifest for an app. Its one page is the app itself; there are
 * no TacScript stores, widgets or reactions. Install, update, the market, the
 * sidebar and records all work off this exactly as they did for TacScript.
 */
export function manifestForApp(pkg: AppPackage): Manifest {
  const page: PageDef = {
    name: "app",
    title: pkg.manifest.title,
    icon: pkg.manifest.icon,
    nav: true,
    subtitle: null,
    showTo: [],
    widgets: [],
  };
  return {
    slug: pkg.manifest.name,
    name: pkg.manifest.title,
    version: pkg.manifest.version,
    about: pkg.manifest.description,
    icon: pkg.manifest.icon,
    category: pkg.manifest.category ?? "general",
    author: pkg.manifest.author,
    needs: [],
    provides: [],
    uses: [],
    settings: [],
    stores: [],
    pages: [page],
    panels: [],
    positions: [],
    hooks: [],
    computes: [],
    calendars: [],
    app: { html: pkg.html, author: pkg.manifest.author, setup: pkg.manifest.setup ?? [] },
  };
}

/** The `{ manifest, html }` a published app version was made from, for exporting. */
export function packageOf(manifest: Manifest): AppPackage | null {
  if (!manifest.app) return null;
  return {
    manifest: {
      name: manifest.slug,
      title: manifest.name,
      version: manifest.version,
      description: manifest.about,
      author: manifest.app.author,
      icon: manifest.icon,
      ...(manifest.category && manifest.category !== "general" ? { category: manifest.category } : {}),
      ...(manifest.app.setup.length ? { setup: manifest.app.setup } : {}),
    },
    html: manifest.app.html,
  };
}

/* -------------------------------------------------------------------------- */
/*  Install-time answers                                                       */
/* -------------------------------------------------------------------------- */

/** How an action is named in an installer's answers: its `id`, or its position. */
export function actionKey(action: SetupAction, index: number): string {
  return action.id ?? String(index);
}

/**
 * Whether each action runs, given the installer's answers. Actions that aren't
 * optional always run. With no answers (an older client, a script) every
 * optional action falls back to its `default`.
 */
export function chosenActions(setup: SetupAction[], selection: (string | number)[] | undefined): boolean[] {
  const picked = selection ? new Set(selection.map(String)) : null;
  return setup.map((action, index) => {
    if (!action.optional) return true;
    if (!picked) return action.default ?? true;
    return picked.has(actionKey(action, index)) || picked.has(String(index));
  });
}

/** What a setup action is called on the install screen when it has no `prompt`. */
export function describeAction(action: SetupAction): string {
  switch (action.type) {
    case "createPosition":
      return `Create the position "${action.title}"`;
    case "createWikiPage":
      return `Add the wiki section "${action.title}"`;
    case "enableFullWindow":
      return action.mode === "inline" ? "Open inside the page" : "Open full screen";
  }
}

/* -------------------------------------------------------------------------- */
/*  Bundling a folder                                                          */
/* -------------------------------------------------------------------------- */

export type AppFile = { path: string; text: string };

/**
 * Turns a project folder into one HTML fragment, the Eggstension way:
 *
 * 1. `<html>`, `<head>` and `<body>` are dropped; their contents are kept.
 * 2. `<link rel="stylesheet" href="...">` to a file in the folder becomes an
 *    inline `<style>`; `<script src="...">` becomes an inline `<script>`.
 * 3. CSS files nobody linked go first, JS files nobody linked go last.
 *
 * References resolve by full path first, then by the end of the path, so
 * `href="base.css"` finds `styles/base.css`. Outside URLs are left alone (the
 * sandbox will refuse to load them). Paths are relative to the folder.
 */
export function bundleAppFolder(files: AppFile[]): { manifest: unknown; html: string | null; problems: string[] } {
  const problems: string[] = [];
  const byPath = new Map(files.map((file) => [normalise(file.path), file.text]));
  const manifestText = byPath.get("manifest.json");
  let manifest: unknown = null;
  if (manifestText === undefined) problems.push("The folder has no manifest.json at its top level.");
  else {
    try {
      manifest = JSON.parse(manifestText);
    } catch (error) {
      problems.push(`manifest.json isn't valid JSON: ${error instanceof Error ? error.message : "it couldn't be read"}.`);
    }
  }

  const entry = byPath.get("index.html") ?? byPath.get("index.htm");
  if (entry === undefined) {
    problems.push("The folder has no index.html at its top level.");
    return { manifest, html: null, problems };
  }

  const used = new Set<string>(["manifest.json", "index.html", "index.htm"]);
  const find = (reference: string): string | null => {
    const clean = normalise(reference.split(/[?#]/)[0]);
    if (!clean || /^[a-z]+:|^\/\//i.test(reference)) return null;
    if (byPath.has(clean)) return clean;
    const matches = [...byPath.keys()].filter((path) => path === clean || path.endsWith(`/${clean}`));
    return matches.length >= 1 ? matches.sort((a, b) => a.length - b.length)[0] : null;
  };

  let body = entry;
  // Head and body wrappers go; what was inside them stays, in order.
  body = body.replace(/<!doctype[^>]*>/gi, "").replace(/<\/?(?:html|head|body)\b[^>]*>/gi, "");

  body = body.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
    const href = attribute(tag, "href");
    const path = href ? find(href) : null;
    if (!path) return tag;
    used.add(path);
    return `<style data-file="${escapeAttribute(path)}">\n${byPath.get(path)}\n</style>`;
  });

  body = body.replace(/<script\b([^>]*)\bsrc\s*=\s*["']?([^"'\s>]+)["']?([^>]*)>\s*<\/script>/gi, (tag, before, src, after) => {
    const path = find(src);
    if (!path) return tag;
    used.add(path);
    const type = attribute(`<script ${before} ${after}>`, "type");
    const typeAttribute = type ? ` type="${escapeAttribute(type)}"` : "";
    return `<script data-file="${escapeAttribute(path)}"${typeAttribute}>\n${guardScript(byPath.get(path)!)}\n</script>`;
  });

  const unlinked = (extension: string[]) =>
    [...byPath.keys()].filter((path) => !used.has(path) && extension.some((ext) => path.endsWith(ext))).sort();
  const css = unlinked([".css"]).map((path) => `<style data-file="${escapeAttribute(path)}">\n${byPath.get(path)}\n</style>`);
  const js = unlinked([".js", ".mjs"]).map((path) => `<script data-file="${escapeAttribute(path)}">\n${guardScript(byPath.get(path)!)}\n</script>`);

  const html = [...css, body.trim(), ...js].filter(Boolean).join("\n");
  return { manifest, html, problems };
}

/** Which files of a chosen folder are part of the app, and their paths inside it. */
export function appFilesFrom(paths: string[]): { keep: string[]; skipped: string[] } {
  const keep: string[] = [];
  const skipped: string[] = [];
  for (const path of paths) {
    const parts = normalise(path).split("/");
    const hidden = parts.some((part) => part.startsWith(".") || part === "node_modules" || part === "dist");
    if (!hidden && APP_FILE_TYPES.some((type) => path.toLowerCase().endsWith(type))) keep.push(path);
    else skipped.push(path);
  }
  return { keep, skipped };
}

function normalise(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** A script containing `</script>` would end its own tag early once inlined. */
function guardScript(source: string): string {
  return source.replace(/<\/script/gi, "<\\/script");
}
