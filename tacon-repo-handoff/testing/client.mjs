// HTTP client for a running Eagle Bot server. No dependencies: Node 20+.
//
// Everything here goes through Eagle Bot's real API, the same calls the
// browser makes, so permissions, studio scope and the compiler are the real
// ones. Use it from the CLI (tacon-test.mjs) or import it in your own
// `node:test` scenario files:
//
//   import { sandbox } from "../../testing/client.mjs";
//   const sb = sandbox();
//   const { install } = await sb.deploy("tacons/my-tacon/my-tacon.tacon");
//   const view = await sb.as("learner1").view(install.id, "home");

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PERSONAS, STUDIOS, personaEmail } from "./personas.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Reads testing/sandbox.env (KEY=value lines) into process.env without overriding. */
export function loadEnv(file = path.join(here, "sandbox.env")) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

export class ApiError extends Error {
  constructor(status, body, method, url) {
    super(`${method} ${url} -> ${status}: ${body?.error ?? JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

/** One signed-in person. Keeps its own session cookie. */
export class Session {
  constructor(baseUrl, label) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.label = label;
    this.cookies = new Map();
    this.user = null;
  }

  async request(method, url, body) {
    const headers = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(this.baseUrl + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const header of res.headers.getSetCookie?.() ?? []) {
      const [pair] = header.split(";");
      const at = pair.indexOf("=");
      this.cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = { error: text.slice(0, 300) }; }
    if (!res.ok) throw new ApiError(res.status, data, method, url);
    return data;
  }
  get(url) { return this.request("GET", url); }
  post(url, body = {}) { return this.request("POST", url, body); }
  patch(url, body = {}) { return this.request("PATCH", url, body); }
  delete(url) { return this.request("DELETE", url); }

  async login(email, password) {
    const { user } = await this.post("/api/auth/login", { email, password });
    this.user = user;
    return user;
  }
  async portalLogin(email, password) {
    return this.post("/api/portal/login", { email, password });
  }

  // --- What a viewer sees -------------------------------------------------
  nav() { return this.get("/api/tacons/nav").then(r => r.entries); }
  view(installId, page) { return this.get(`/api/tacons/view/${installId}/${page}`).then(r => r.view); }
  panels(host) { return this.get(`/api/tacons/panels/${host}`).then(r => r.panels); }
  desks() { return this.get("/api/tacons/desks").then(r => r.desks); }
  selectStudio(studioId) { return this.post("/api/studios/select", { studioId }); }

  // --- What a viewer does -------------------------------------------------
  /** `where` is { page } | { panel } | { position }; `index` is the form's index from the view. */
  submit(installId, where, index, values) {
    return this.post(`/api/tacons/view/${installId}/submit`, { ...where, index, values });
  }
  press(installId, where, index) {
    return this.post(`/api/tacons/view/${installId}/run`, { ...where, index });
  }
  removeRecord(installId, recordId) { return this.delete(`/api/tacons/view/${installId}/records/${recordId}`); }

  // --- Dev and admin ------------------------------------------------------
  check(source) { return this.post("/api/tacons/dev/check", { source }); }
  mine() { return this.get("/api/tacons/dev/mine").then(r => r.tacons); }
  publish(source, extra = {}) { return this.post("/api/tacons/dev/publish", { source, visibility: "draft", ...extra }); }
  listing(slug) { return this.get(`/api/tacons/market/${slug}`); }
  install(slug, studioId, settings = {}) { return this.post(`/api/tacons/market/${slug}/install`, { studioId, settings }).then(r => r.install); }
  update(installId) { return this.post(`/api/tacons/installs/${installId}/update`); }
  configure(installId, patch) { return this.patch(`/api/tacons/installs/${installId}`, patch); }
  uninstall(installId) { return this.delete(`/api/tacons/installs/${installId}`); }
  positions() { return this.get("/api/positions?includeArchived=false"); }
  appoint(positionId, userId) { return this.post(`/api/positions/${positionId}/holders`, { userId }); }
}

const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** The sandbox: the local Eagle Bot started by `testing/sandbox up`, and its personas. */
export function sandbox({ url = process.env.SANDBOX_URL || `http://localhost:${process.env.SANDBOX_PORT || 5199}`, password = process.env.SANDBOX_PASSWORD || "sandbox-password" } = {}) {
  const host = new URL(url).hostname;
  if (!LOCAL.has(host) && process.env.SANDBOX_ALLOW_REMOTE !== "1") {
    throw new Error(`The sandbox writes test data, so it only runs against localhost. ${url} isn't local. Set SANDBOX_ALLOW_REMOTE=1 only for a throwaway staging server, never the live site.`);
  }
  const sessions = new Map();
  const ids = new Map();

  async function as(key) {
    if (!PERSONAS.some(p => p.key === key)) throw new Error(`No persona "${key}". Use ${PERSONAS.map(p => p.key).join(", ")}.`);
    if (!sessions.has(key)) {
      const session = new Session(url, key);
      await session.login(personaEmail(key), password);
      ids.set(key, session.user.id);
      sessions.set(key, session);
    }
    return sessions.get(key);
  }

  /** Synchronous handle; the first call signs the persona in. */
  function persona(key) {
    const lazy = {};
    for (const name of Object.getOwnPropertyNames(Session.prototype)) {
      if (name !== "constructor") lazy[name] = async (...args) => (await as(key))[name](...args);
    }
    lazy.session = () => as(key);
    return lazy;
  }

  async function studioId(slug) {
    if (slug === "academy" || slug === null) return null;
    const admin = await as("admin");
    const me = await admin.get("/api/auth/me");
    const studios = me.studios ?? me.allStudios ?? [];
    const wanted = STUDIOS.find(s => s.slug === slug);
    if (!wanted) throw new Error(`No sandbox studio "${slug}". Use ${STUDIOS.map(s => s.slug).join(", ")} or academy.`);
    const found = studios.find(s => s.slug === slug || s.name === wanted.name);
    if (!found) throw new Error(`Couldn't find studio "${slug}" in /api/auth/me. Is the sandbox seeded?`);
    return found.id;
  }

  /**
   * Publishes a source file as the dev persona and installs it (or updates the
   * existing install) as the admin. Published versions are frozen, so when the
   * source's version is already in the sandbox it's published as the next free
   * patch. The returned `publishedAs` says which.
   */
  async function deploy(file, { studio = "launchpad", settings, holders = {} } = {}) {
    let source = readFileSync(file, "utf8");
    const dev = await as("dev");
    const checked = await dev.check(source);
    if (!checked.ok) return { ok: false, diagnostics: checked.diagnostics, manifest: null };
    let manifest = checked.manifest;
    const declared = manifest.version;
    const existing = (await dev.mine()).find(t => t.slug === manifest.slug);
    if (existing?.version && compareVersions(declared, existing.version) <= 0) {
      const next = bumpPatch(existing.version);
      source = source.replace(/^(\s*version\s+)\S+/m, `$1${next}`);
      manifest = { ...manifest, version: next };
    }
    if (!existing || existing.version !== manifest.version) await dev.publish(source);
    const admin = await as("admin");
    const academyWide = manifest.markets?.some(m => m.scope === "academy");
    const target = academyWide ? null : await studioId(studio);
    const listing = await admin.listing(manifest.slug);
    let install = listing.installs.find(i => i.studioId === target);
    let action = "updated";
    if (!install) {
      install = await admin.install(manifest.slug, target, settings ?? {});
      action = "installed";
    } else if (install.updateAvailable) {
      await admin.update(install.id);
    } else action = "unchanged";
    if (settings && action !== "installed") await admin.configure(install.id, { settings });
    if (install.enabled === false) await admin.configure(install.id, { enabled: true });
    const appointed = await appoint(install.id, holders);
    return { ok: true, manifest, declaredVersion: declared, publishedAs: manifest.version, install: { id: install.id, studioId: target }, action, appointed, diagnostics: checked.diagnostics };
  }

  /** holders: { positionName: personaKey | personaKey[] } for this install's positions. */
  async function appoint(installId, holders) {
    const admin = await as("admin");
    const done = [];
    if (!Object.keys(holders).length) return done;
    const listed = await admin.positions();
    const rows = listed.positions ?? listed;
    for (const [name, who] of Object.entries(holders)) {
      const position = rows.find(p => (p.taconInstallId ?? p.position?.taconInstallId) === installId && (p.taconPosition ?? p.position?.taconPosition) === name);
      if (!position) throw new Error(`Install ${installId} has no position "${name}".`);
      const positionId = position.id ?? position.position?.id;
      const current = (position.current ?? []).map(h => h.userId ?? h.user?.id);
      for (const key of [who].flat()) {
        const userId = (await as(key)).user.id;
        if (current.includes(userId)) continue;
        await admin.appoint(positionId, userId);
        done.push(`${name}=${key}`);
      }
    }
    return done;
  }

  async function uninstall(slug, studio = "launchpad") {
    const admin = await as("admin");
    const listing = await admin.listing(slug);
    const target = await studioId(studio);
    const install = listing.installs.find(i => i.studioId === target) ?? (listing.installs.length === 1 ? listing.installs[0] : null);
    if (!install) throw new Error(`${slug} isn't installed in ${studio}.`);
    return admin.uninstall(install.id);
  }

  return { url, as: persona, signIn: as, deploy, appoint, uninstall, studioId, personas: PERSONAS };
}

/** Compile-only check against the live site. Never writes anything there. */
export async function liveCheck(source) {
  const url = process.env.LIVE_URL;
  if (!url) throw new Error("Set LIVE_URL (and LIVE_PORTAL_EMAIL/LIVE_PORTAL_PASSWORD or LIVE_EMAIL/LIVE_PASSWORD) in testing/sandbox.env.");
  const session = new Session(url, "live");
  if (process.env.LIVE_PORTAL_EMAIL) {
    await session.portalLogin(process.env.LIVE_PORTAL_EMAIL, process.env.LIVE_PORTAL_PASSWORD ?? "");
    return { via: "portal", ...(await session.post("/api/portal/tacons/validate", { source })) };
  }
  if (process.env.LIVE_EMAIL) {
    await session.login(process.env.LIVE_EMAIL, process.env.LIVE_PASSWORD ?? "");
    return { via: "dev menu", ...(await session.check(source)) };
  }
  throw new Error("Set LIVE_PORTAL_EMAIL/LIVE_PORTAL_PASSWORD (dev portal account) or LIVE_EMAIL/LIVE_PASSWORD (an academy account with dev status).");
}

export function compareVersions(a, b) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}
function bumpPatch(version) {
  const [major, minor = 0, patch = 0] = version.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}
