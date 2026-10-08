#!/usr/bin/env node
// Tac-On test CLI. Run `node testing/tacon-test.mjs help`.

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sandbox, liveCheck, ApiError } from "./client.mjs";
import { PERSONAS } from "./personas.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PANEL_HOSTS = ["wiki", "town-hall", "elections", "positions", "people", "admin"];

const HELP = `Tac-On test CLI: drives a real Eagle Bot server.

  check <file.tacon>            Compile on the sandbox server (the real compiler)
  check <file.tacon> --live     Compile on the live site (read-only, nothing is saved)
  try <file.tacon> [options]    Check, publish, install/update, then show what every persona sees
      --studio launchpad|middle|academy   Where to install (default launchpad; markets with scope academy go academy-wide)
      --setting key=value                 Install setting (repeatable)
      --hold position=persona             Appoint a persona to one of the Tac-On's positions (repeatable)
      --as p1,p2                          Only report these personas (default: all)
  view <slug> <page> --as <persona>          One page, as one persona
  panel <slug> <host> --as <persona>         Panels this Tac-On adds to a base page
  desk <slug> --as <persona>                 Position desks this persona sees for this Tac-On
  submit <slug> --as <persona> --page <p>|--panel <host>|--position <name> --index <n> --values '<json>'
  press <slug> --as <persona> --page <p>|--panel <host>|--position <name> --index <n>
  remove <slug> [--studio launchpad]         Uninstall (deletes its sandbox records)
  api <METHOD> <path> --as <persona> [--body '<json>']   Any Eagle Bot API call, e.g. extension routes
  personas                                   List the sandbox personas

Add --json to any command for raw output. Every run also writes testing/out/last.json.
Personas: ${PERSONAS.map(p => p.key).join(", ")}`;

function parse(argv) {
  const positional = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) { positional.push(arg); continue; }
    const key = arg.slice(2);
    const next = argv[i + 1];
    const value = next === undefined || next.startsWith("--") ? true : (i++, next);
    if (flags[key] === undefined) flags[key] = value;
    else flags[key] = [flags[key]].flat().concat(value);
  }
  return { positional, flags };
}
const list = v => (v === undefined ? [] : [v].flat());
function parseValue(raw) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw !== "" && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
}
function where(flags) {
  if (flags.page) return { page: flags.page };
  if (flags.panel) return { panel: flags.panel };
  if (flags.position) return { position: flags.position };
  throw new Error("Say where the widget is: --page, --panel or --position.");
}

function printDiagnostics(file, diagnostics) {
  for (const d of diagnostics ?? []) console.log(`  ${file}:${d.line}:${d.column} ${d.severity}: ${d.message}`);
}

// ---- Rendering what a persona sees ----------------------------------------

function widgetLines(widget) {
  switch (widget.kind) {
    case "note": return [`note${widget.tone !== "plain" ? ` (${widget.tone})` : ""}: ${widget.text}`];
    case "heading": return [`## ${widget.text}`];
    case "divider": return ["---"];
    case "stat": return [`stat ${widget.label} = ${widget.value}${widget.hint ? `  (${widget.hint})` : ""}`];
    case "list": {
      const lines = [`list ${widget.title ?? widget.store ?? ""}: ${widget.rows.length} row(s) [${widget.columns.map(c => c.key).join(", ")}]`];
      if (widget.problem) lines.push(`  problem: ${widget.problem}`);
      if (!widget.rows.length) lines.push(`  empty: ${widget.empty}`);
      for (const row of widget.rows.slice(0, 5)) lines.push(`  #${row.id} ${widget.columns.map(c => `${c.key}=${row.cells[c.key] ?? ""}`).join(" | ")}${row.canRemove ? "  [can remove]" : ""}`);
      if (widget.rows.length > 5) lines.push(`  ... ${widget.rows.length - 5} more`);
      return lines;
    }
    case "form": return [
      `form [index ${widget.index}] "${widget.title}" ${widget.allowed ? "ALLOWED" : `DENIED (${widget.deniedReason ?? "not allowed"})`}`,
      `  fields: ${widget.fields.map(f => `${f.name}:${f.type}${f.required ? "*" : ""}${f.options.length ? `(${f.options.join("/")})` : ""}`).join(", ")}`,
    ];
    case "button": return [`button [index ${widget.index}] "${widget.label}" ${widget.allowed ? "ALLOWED" : "DENIED"}${widget.confirm ? `  confirm: ${widget.confirm}` : ""}`];
    case "market": return [
      `market [index ${widget.index}] ${widget.market}: balance ${widget.balancePoints} pts, ${widget.products.length} product(s)`,
      `  can: ${["canPurchase", "canLogPoints", "canAwardPoints", "canManage", "canViewLogs"].filter(k => widget[k]).join(", ") || "nothing"}; sees ${widget.entries.length} ledger entries, ${widget.purchases.length} purchases, ${widget.learners.length} learners`,
    ];
    case "extension": {
      const json = JSON.stringify(widget.data);
      return [`extension ${widget.extension} [index ${widget.index}]: ${json.length > 400 ? `${json.slice(0, 400)}... (${json.length} chars, use --json)` : json}`];
    }
    default: return [`${widget.kind}: ${JSON.stringify(widget).slice(0, 200)}`];
  }
}
const indent = (lines, by = "    ") => lines.map(l => by + l).join("\n");

async function personaReport(sb, key, manifest, installId) {
  const me = await sb.signIn(key);
  const report = { persona: key, name: me.user.name, role: me.user.role, nav: [], pages: {}, panels: {}, desks: [] };
  report.nav = (await me.nav()).filter(e => e.installId === installId).map(e => e.page);
  for (const page of manifest.pages) {
    try { report.pages[page.name] = { ok: true, view: await me.view(installId, page.name) }; }
    catch (error) { report.pages[page.name] = { ok: false, status: error.status, error: error.body?.error ?? error.message }; }
  }
  const hosts = [...new Set(manifest.panels.map(p => p.host))].filter(h => PANEL_HOSTS.includes(h));
  for (const host of hosts) {
    try { report.panels[host] = (await me.panels(host)).filter(p => p.installId === installId); }
    catch (error) { report.panels[host] = { error: error.body?.error ?? error.message }; }
  }
  try { report.desks = (await me.desks()).filter(d => d.installId === installId); }
  catch (error) { report.desks = { error: error.body?.error ?? error.message }; }
  return report;
}

function printReport(report) {
  console.log(`\n=== ${report.persona} (${report.name}, ${report.role}) ===`);
  console.log(`  sidebar: ${report.nav.length ? report.nav.join(", ") : "(nothing from this Tac-On)"}`);
  for (const [name, page] of Object.entries(report.pages)) {
    if (!page.ok) { console.log(`  page ${name}: ${page.status} ${page.error}`); continue; }
    console.log(`  page ${name} "${page.view.page.title}":`);
    console.log(indent(page.view.widgets.flatMap(widgetLines)));
  }
  for (const [host, panels] of Object.entries(report.panels)) {
    if (!Array.isArray(panels)) { console.log(`  panels on ${host}: ${panels.error}`); continue; }
    if (!panels.length) console.log(`  panels on ${host}: (none shown)`);
    for (const panel of panels) { console.log(`  panel on ${host} "${panel.title}":`); console.log(indent(panel.widgets.flatMap(widgetLines))); }
  }
  if (!Array.isArray(report.desks)) console.log(`  desks: ${report.desks.error}`);
  else for (const desk of report.desks) { console.log(`  desk ${desk.position} "${desk.title}":`); console.log(indent(desk.widgets.flatMap(widgetLines))); }
}

async function installIdFor(sb, slug, flags) {
  const listing = await (await sb.signIn("admin")).listing(slug);
  if (!listing.installs.length) throw new Error(`${slug} isn't installed in the sandbox. Run try first.`);
  if (flags.install) return Number(flags.install);
  if (flags.studio) {
    const target = await sb.studioId(flags.studio);
    const found = listing.installs.find(i => i.studioId === target);
    if (!found) throw new Error(`${slug} isn't installed in ${flags.studio}.`);
    return found.id;
  }
  return listing.installs[0].id;
}
// ---- Commands --------------------------------------------------------------

async function run() {
  const { positional: [command, ...args], flags } = parse(process.argv.slice(2));
  const out = (data, print) => {
    mkdirSync(path.join(here, "out"), { recursive: true });
    writeFileSync(path.join(here, "out", "last.json"), JSON.stringify(data, null, 2));
    if (flags.json) console.log(JSON.stringify(data, null, 2));
    else print();
  };

  if (!command || command === "help") return console.log(HELP);
  if (command === "personas") return out(PERSONAS, () => PERSONAS.forEach(p => console.log(`${p.key.padEnd(13)} ${p.name.padEnd(20)} ${p.role.padEnd(10)} studio=${p.studio ?? "(all)"}${p.dev ? " dev" : ""}${p.learnerAdmin ? " learner-admin" : ""}`)));

  if (command === "check") {
    const file = args[0];
    const source = readFileSync(file, "utf8");
    const result = flags.live ? await liveCheck(source) : await (await sandbox().signIn("dev")).check(source);
    out(result, () => {
      console.log(`${result.ok ? "COMPILES" : "DOES NOT COMPILE"} on ${flags.live ? `the live site (${result.via})` : "the sandbox"}: ${file}`);
      printDiagnostics(file, result.diagnostics);
    });
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  const sb = sandbox();

  if (command === "try") {
    const file = args[0];
    const settings = list(flags.setting).length ? Object.fromEntries(list(flags.setting).map(s => { const [k, ...v] = s.split("="); return [k, parseValue(v.join("="))]; })) : undefined;
    const holders = {};
    for (const h of list(flags.hold)) { const [pos, who] = h.split("="); holders[pos] = [...(holders[pos] ?? []), who]; }
    const deployed = await sb.deploy(file, { studio: flags.studio ?? "launchpad", settings, holders });
    if (!deployed.ok) {
      out(deployed, () => { console.log(`DOES NOT COMPILE: ${file}`); printDiagnostics(file, deployed.diagnostics); });
      process.exitCode = 1;
      return;
    }
    const who = flags.as ? String(flags.as).split(",") : PERSONAS.map(p => p.key);
    const reports = [];
    for (const key of who) reports.push(await personaReport(sb, key, deployed.manifest, deployed.install.id));
    out({ deployed, reports }, () => {
      const m = deployed.manifest;
      console.log(`COMPILES: ${m.name} (${m.slug})`);
      printDiagnostics(file, deployed.diagnostics);
      console.log(`Published as ${deployed.publishedAs}${deployed.publishedAs !== deployed.declaredVersion ? ` (source says ${deployed.declaredVersion}, already in the sandbox)` : ""}; install #${deployed.install.id} ${deployed.action} in ${deployed.install.studioId === null ? "the whole academy" : flags.studio ?? "launchpad"}.`);
      if (deployed.appointed.length) console.log(`Appointed: ${deployed.appointed.join(", ")}`);
      console.log(`Adds: ${m.pages.length} page(s), ${m.panels.length} panel(s), ${m.positions.length} position(s), ${m.hooks.length} reaction(s), ${m.stores.length} store(s).`);
      reports.forEach(printReport);
      console.log(`\nFull JSON: testing/out/last.json`);
    });
    return;
  }

  if (command === "remove") {
    const result = await sb.uninstall(args[0], flags.studio ?? "launchpad");
    return out(result, () => console.log(`Removed. ${result.removedRecords} record(s) deleted, ${result.archivedPositions} position(s) archived.`));
  }

  const key = flags.as;
  if (!key && command !== "api") throw new Error("Say who's looking: --as <persona>.");

  if (command === "api") {
    const [method, url] = args;
    const me = await sb.signIn(key ?? "admin");
    const result = await me.request(method.toUpperCase(), url, flags.body ? JSON.parse(flags.body) : undefined);
    return out(result, () => console.log(JSON.stringify(result, null, 2)));
  }

  const slug = args[0];
  const installId = await installIdFor(sb, slug, flags);
  const me = await sb.signIn(key);

  if (command === "view") {
    const view = await me.view(installId, args[1]);
    return out(view, () => { console.log(`page ${args[1]} as ${key}:`); console.log(indent(view.widgets.flatMap(widgetLines))); });
  }
  if (command === "panel") {
    const panels = (await me.panels(args[1])).filter(p => p.installId === installId);
    return out(panels, () => panels.length ? panels.forEach(p => { console.log(`panel "${p.title}":`); console.log(indent(p.widgets.flatMap(widgetLines))); }) : console.log("(no panel shown)"));
  }
  if (command === "desk") {
    const desks = (await me.desks()).filter(d => d.installId === installId);
    return out(desks, () => desks.length ? desks.forEach(d => { console.log(`desk ${d.position}:`); console.log(indent(d.widgets.flatMap(widgetLines))); }) : console.log("(no desk: this persona holds none of its positions)"));
  }
  if (command === "submit") {
    const result = await me.submit(installId, where(flags), Number(flags.index), JSON.parse(flags.values ?? "{}"));
    return out(result, () => console.log(`Saved record #${result.id}.${result.notices?.length ? ` Notices: ${result.notices.join(" / ")}` : ""}`));
  }
  if (command === "press") {
    const result = await me.press(installId, where(flags), Number(flags.index));
    return out(result, () => console.log(`Pressed. ${JSON.stringify(result)}`));
  }
  throw new Error(`Unknown command "${command}". Run help.`);
}

run().catch(error => {
  if (error instanceof ApiError) console.error(`Eagle Bot said ${error.status}: ${error.body?.error ?? JSON.stringify(error.body)}`);
  else if (error?.cause?.code === "ECONNREFUSED") console.error("Can't reach the sandbox server. Start it with: testing/sandbox up");
  else console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
