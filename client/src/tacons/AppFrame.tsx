/**
 * Running a Tac-On app.
 *
 * The app's HTML runs in a sandboxed frame (`sandbox="allow-scripts ..."`,
 * no `allow-same-origin`), so it has an opaque origin: no Eagle Bot cookies,
 * no storage, no way to read this page. A Content-Security-Policy in the
 * frame blocks every network request, outside scripts and outside images.
 *
 * Everything an app does in Eagle Bot goes through `window.EagleBot`, which
 * posts a message here. This side only answers the calls listed in `METHODS`,
 * by calling Eagle Bot's ordinary API as the person looking - so the server
 * checks every one against their role exactly as it would if they'd clicked
 * the button themselves. There is no token to steal and no way to act as
 * anyone else.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Minimize2 } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { Banner } from "@/components/ui";
import type { ViewApp } from "@shared/tacons/view";

/* -------------------------------------------------------------------------- */
/*  What the frame is allowed to ask for                                       */
/* -------------------------------------------------------------------------- */

type Json = unknown;

/** What the host page does for a call that needs more than the API. */
type Host = {
  /** Shows Eagle Bot's own code box; resolves with the code, or rejects if cancelled. */
  askCode: (prompt: string) => Promise<string>;
  /** The app page's address with these parameters. */
  link: (params: Record<string, string>) => string;
  navigate: (params: Record<string, string>) => void;
};
type Call = (args: Json[], app: ViewApp, host: Host) => Promise<Json>;

/** `{ record: 42 }` -> `{ record: "42" }`: link parameters are always text. */
function linkParams(value: Json): Record<string, string> {
  if (value === undefined || value === null) return {};
  const input = object(value, "The link's parameters");
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(input)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(key)) throw new Error(`"${key}" can't be a link parameter.`);
    if (entry === undefined || entry === null) continue;
    out[key] = String(entry).slice(0, 200);
  }
  if (Object.keys(out).length > 10) throw new Error("A link can carry at most 10 parameters.");
  return out;
}

const base = (app: ViewApp) => `/tacons/app/${app.identity.tacon.installId}/records`;
const object = (value: Json, what: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${what} must be an object.`);
  return value as Record<string, unknown>;
};
const id = (value: Json, what = "id"): number => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${what} must be a whole number.`);
  return number;
};

type Person = { id: number; name: string; email: string | null; role: string; studioId: number | null; currentPositions: string[] };
type PositionRow = {
  id: number;
  title: string;
  description: string | null;
  seats: number;
  elected: boolean;
  studioId: number | null;
  studioName: string | null;
  current: { userId: number; name: string }[];
};
type Section = { id: number; title: string; summary: string | null; studioName: string | null; rules: { id: number; title: string; body: string; status: string }[] };

const members: Call = async () => {
  const { people } = await apiGet<{ people: Person[] }>("/profiles");
  return people.map((person) => ({
    id: person.id,
    name: person.name,
    email: person.email,
    role: person.role,
    studio_id: person.studioId,
    positions: person.currentPositions,
  }));
};

function positionShape(position: PositionRow) {
  return {
    id: position.id,
    title: position.title,
    description: position.description,
    seats: position.seats,
    elected: position.elected,
    studio_id: position.studioId,
    studio_name: position.studioName,
    holders: position.current.map((holder) => ({ id: holder.userId, name: holder.name })),
    holder_id: position.current[0]?.userId ?? null,
    holder_name: position.current[0]?.name ?? null,
  };
}

async function listPositions() {
  const { positions } = await apiGet<{ positions: PositionRow[] }>("/positions");
  return positions.map(positionShape);
}

function pageShape(section: Section) {
  const rules = section.rules.filter((rule) => rule.status === "active");
  return {
    id: section.id,
    title: section.title,
    summary: section.summary ?? "",
    content: rules.map((rule) => rule.body).join("\n\n"),
    rules: rules.map((rule) => ({ id: rule.id, title: rule.title, body: rule.body })),
    studio_name: section.studioName,
  };
}

async function listWiki() {
  const { sections } = await apiGet<{ sections: Section[] }>("/wiki");
  return sections.map(pageShape);
}

const METHODS: Record<string, Call> = {
  /* Records: this app's own data store. */
  "api.getRecords": async ([options], app) => {
    const store = options && typeof options === "object" ? (options as { store?: unknown }).store : undefined;
    const query = typeof store === "string" ? `?store=${encodeURIComponent(store)}` : "";
    return (await apiGet<{ records: Json[] }>(`${base(app)}${query}`)).records;
  },
  "api.createRecord": async ([data, options], app, host) => {
    const input = (options && typeof options === "object" ? options : {}) as { store?: unknown; sign?: unknown; prompt?: unknown };
    const store = typeof input.store === "string" ? input.store : "records";
    // Signing asks for the person's code in Eagle Bot's own box: the app never sees it.
    const sign = app.stores[store]?.sign || input.sign === true;
    const code = sign
      ? await host.askCode(typeof input.prompt === "string" ? input.prompt.slice(0, 200) : `Sign this for ${app.identity.tacon.name}.`)
      : undefined;
    return (await apiPost<{ record: Json }>(base(app), { data: object(data, "data"), store: input.store, sign: input.sign === true, code })).record;
  },
  "api.updateRecord": async ([recordId, data], app) =>
    (await apiPatch<{ record: Json }>(`${base(app)}/${id(recordId, "The record id")}`, { data: object(data, "data") })).record,
  "api.deleteRecord": async ([recordId], app) => {
    await apiDelete(`${base(app)}/${id(recordId, "The record id")}`);
    return { ok: true };
  },

  "messages.list": async ([options], app) => {
    const input = options && typeof options === "object" ? (options as { from?: unknown }) : {};
    const query = typeof input.from === "string" ? "?from=" + encodeURIComponent(input.from) : "";
    return (await apiGet<{ messages: Json[] }>(base(app).slice(0, -8) + "/messages" + query)).messages;
  },
  "messages.send": async ([message], app) =>
    apiPost(base(app).slice(0, -8) + "/messages", object(message, "message")),
  "market.wallet": async (_args, app) =>
    apiGet(base(app).slice(0, -8) + "/market/wallet"),
  "market.people": async (_args, app) =>
    apiGet(base(app).slice(0, -8) + "/market/people"),
  "market.adjust": async ([input], app) =>
    apiPost(base(app).slice(0, -8) + "/market/adjust", object(input, "adjustment")),
  "market.purchase": async ([input], app) =>
    apiPost(base(app).slice(0, -8) + "/market/purchase", object(input, "purchase")),

  /* People. */
  "members.list": members,

  /* Positions. Writing needs positions.manage (admins); the server checks. */
  "positions.list": listPositions,
  "positions.create": async ([body]) => {
    const input = object(body, "The position");
    const { position } = await apiPost<{ position: PositionRow }>("/positions", {
      title: input.title,
      description: input.description,
      seats: input.seats,
      elected: input.elected,
      termLength: input.term,
    });
    return positionShape({ ...position, studioName: null, current: [] });
  },
  "positions.update": async ([positionId, body]) => {
    const input = object(body, "The change");
    const target = id(positionId, "The position id");
    const { holder_id: holder, ...fields } = input;
    if (Object.keys(fields).length > 0) {
      await apiPatch(`/positions/${target}`, {
        title: fields.title,
        description: fields.description,
        seats: fields.seats,
        elected: fields.elected,
      });
    }
    if (holder !== undefined && holder !== null) await apiPost(`/positions/${target}/holders`, { userId: id(holder, "holder_id") });
    return (await listPositions()).find((position) => position.id === target) ?? null;
  },
  "positions.assign": async ([userId, positionIds]) => {
    if (!Array.isArray(positionIds)) throw new Error("positions.assign takes a person's id and a list of position ids.");
    for (const positionId of positionIds) {
      await apiPost(`/positions/${id(positionId, "A position id")}/holders`, { userId: id(userId, "The person's id") });
    }
    return { ok: true };
  },
  "positions.delete": async ([positionId]) => {
    await apiDelete(`/positions/${id(positionId, "The position id")}`);
    return { ok: true, archived: true };
  },
  "exists.position": async ([title]) => {
    const wanted = String(title ?? "").trim().toLowerCase();
    const match = (await listPositions()).find((position) => position.title.toLowerCase() === wanted);
    return { exists: Boolean(match), position: match ?? null };
  },

  /* The wiki: each section of the Contract is a "page". Writing needs wiki.edit. */
  "wiki.list": listWiki,
  "wiki.get": async ([pageId]) => (await listWiki()).find((page) => page.id === id(pageId, "The page id")) ?? null,
  "wiki.search": async ([query]) => {
    const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    return (await listWiki()).filter((page) => {
      const text = `${page.title} ${page.summary} ${page.content}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
  },
  "wiki.create": async ([body], app) => {
    const input = object(body, "The page");
    const title = String(input.title ?? "").trim();
    const content = String(input.content ?? "").trim();
    if (!title || !content) throw new Error("A wiki page needs a title and content.");
    const { section } = await apiPost<{ section: { id: number } }>("/wiki/sections", { title, summary: input.summary });
    await apiPost("/wiki/rules", {
      sectionId: section.id,
      title,
      body: content,
      rationale: typeof input.rationale === "string" ? input.rationale : `Added through the Tac-On "${app.identity.tacon.name}".`,
    });
    return (await listWiki()).find((page) => page.id === section.id) ?? null;
  },
  "wiki.update": async ([pageId, body], app) => {
    const input = object(body, "The change");
    const target = id(pageId, "The page id");
    const page = (await listWiki()).find((entry) => entry.id === target);
    if (!page) throw new Error("There's no wiki page with that id here.");
    if (typeof input.title === "string" || typeof input.summary === "string") {
      await apiPatch(`/wiki/sections/${target}`, { title: input.title, summary: input.summary });
    }
    if (typeof input.content === "string") {
      const rationale = typeof input.rationale === "string" ? input.rationale : `Updated through the Tac-On "${app.identity.tacon.name}".`;
      const first = page.rules[0];
      if (first) await apiPatch(`/wiki/rules/${first.id}`, { title: first.title, body: input.content, rationale });
      else await apiPost("/wiki/rules", { sectionId: target, title: page.title, body: input.content, rationale });
    }
    return (await listWiki()).find((entry) => entry.id === target) ?? null;
  },
  "exists.wikiPage": async ([title]) => {
    const wanted = String(title ?? "").trim().toLowerCase();
    const match = (await listWiki()).find((page) => page.title.toLowerCase() === wanted);
    return { exists: Boolean(match), page: match ?? null };
  },

  /* Elections. Creating needs elections.manage. */
  "elections.list": async () => {
    type Row = { election: Record<string, unknown>; positionTitle: string | null; candidateCount: number; hasVoted: boolean; canVote: boolean };
    const { elections } = await apiGet<{ elections: Row[] }>("/elections");
    return elections.map((row) => ({
      ...row.election,
      position_title: row.positionTitle,
      candidate_count: row.candidateCount,
      has_voted: row.hasVoted,
      can_vote: row.canVote,
    }));
  },
  "elections.get": async ([electionId]) => {
    type Detail = {
      election: Record<string, unknown>;
      candidates: { id: number; userId: number | null; label: string | null; userName: string | null; statement: string | null; votes: number | null }[];
      myVotes: number[];
      canVote: boolean;
    };
    const detail = await apiGet<Detail>(`/elections/${id(electionId, "The election id")}`);
    return {
      ...detail.election,
      candidates: detail.candidates.map((candidate) => ({
        id: candidate.id,
        user_id: candidate.userId,
        display_name: candidate.userName ?? candidate.label,
        statement: candidate.statement,
        vote_count: candidate.votes,
      })),
      userVotes: detail.myVotes,
      can_vote: detail.canVote,
    };
  },
  "elections.create": async ([body]) => {
    const input = object(body, "The election");
    const { election } = await apiPost<{ election: Json }>("/elections", {
      title: input.title,
      description: input.description,
      type: input.type ?? (input.options ? "rule" : "position"),
      positionId: input.position_id ?? input.positionId,
      proposalBody: input.proposal ?? input.proposalBody,
      seats: input.seats ?? input.votes_per_learner,
      options: input.options,
      closesAt: input.closes_at ?? input.closesAt,
    });
    return election;
  },

  /* Links to a place in the app: `?record=42`. */
  "link.to": async ([params], _app, host) => host.link(linkParams(params)),
  "link.navigate": async ([params], _app, host) => {
    host.navigate(linkParams(params));
    return { ok: true };
  },
  "link.copy": async ([params], _app, host) => {
    const link = host.link(linkParams(params));
    try {
      await navigator.clipboard.writeText(link);
      return { ok: true, link };
    } catch {
      // Some browsers only let the page copy right after a click on the page itself.
      return { ok: false, link };
    }
  },

  /* The studio calendar, read-only. */
  "calendar.list": async ([options]) => {
    const input = (options && typeof options === "object" ? options : {}) as { from?: unknown; to?: unknown };
    const today = new Date();
    const day = (date: Date) => date.toISOString().slice(0, 10);
    const from = typeof input.from === "string" ? input.from : day(today);
    const to = typeof input.to === "string" ? input.to : day(new Date(today.getTime() + 60 * 86_400_000));
    const { items } = await apiGet<{ items: Json[] }>(`/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    return items;
  },
  "calendar.currentSession": async (_args, app) => {
    const today = app.identity.clock.today;
    type Item = { kind: string; title: string; quest: string | null; occurrenceStart: string; occurrenceEnd: string };
    const { items } = await apiGet<{ items: Item[] }>(`/calendar?from=${today}&to=${today}`);
    const session = items.find((item) => item.kind === "session");
    return session
      ? { title: session.title, quest: session.quest ?? "", starts: session.occurrenceStart, ends: session.occurrenceEnd }
      : null;
  },
};

/* -------------------------------------------------------------------------- */
/*  The SDK, as it runs inside the frame                                       */
/* -------------------------------------------------------------------------- */

/** Runs inside the sandbox. Plain ES2020; keep it free of anything this file imports. */
function sdkBoot(init: {
  channel: string;
  identity: ViewApp["identity"];
  display: string;
  place: string;
  params: Record<string, string>;
  stores: ViewApp["stores"];
}) {
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let sequence = 0;
  const post = (message: Record<string, unknown>) => parent.postMessage({ ...message, channel: init.channel }, "*");
  const call = (method: string) => (...args: unknown[]) =>
    new Promise((resolve, reject) => {
      const callId = ++sequence;
      pending.set(callId, { resolve, reject });
      let payload: unknown;
      try {
        payload = JSON.parse(JSON.stringify(args));
      } catch {
        reject(new Error(`${method}: arguments must be plain data (objects, lists, text, numbers).`));
        return;
      }
      post({ type: "call", id: callId, method, args: payload });
      setTimeout(() => {
        if (pending.delete(callId)) reject(new Error(`${method} took too long. Try again.`));
      }, 20_000);
    });
  window.addEventListener("message", (event) => {
    if (event.source !== parent) return;
    const message = event.data;
    if (!message || message.channel !== init.channel || message.type !== "result") return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.ok) request.resolve(message.value);
    else request.reject(new Error(message.error || "That didn't work."));
  });

  const members = { list: call("members.list") };
  const sdk = {
    user: Object.freeze({ ...init.identity.user }),
    academy: Object.freeze({ ...init.identity.academy }),
    studio: init.identity.studio ? Object.freeze({ ...init.identity.studio }) : null,
    tacon: Object.freeze({ ...init.identity.tacon }),
    clock: Object.freeze({ ...init.identity.clock }),
    display: init.display,
    place: init.place,
    params: Object.freeze({ ...init.params }),
    stores: Object.freeze(Object.fromEntries(Object.entries(init.stores).map(([name, rule]) => [name, Object.freeze({ ...rule })]))),
    linkTo: call("link.to"),
    navigate: call("link.navigate"),
    copyLink: call("link.copy"),
    // There is deliberately no `token`: an app never holds the viewer's login.
    api: {
      getRecords: call("api.getRecords"),
      createRecord: call("api.createRecord"),
      updateRecord: call("api.updateRecord"),
      deleteRecord: call("api.deleteRecord"),
      getRoster: members.list,
    },
    messages: { list: call("messages.list"), send: call("messages.send") },
    market: { wallet: call("market.wallet"), people: call("market.people"), adjust: call("market.adjust"), purchase: call("market.purchase") },
    members,
    users: members,
    roster: { list: members.list, get: members.list },
    positions: {
      list: call("positions.list"),
      create: call("positions.create"),
      update: call("positions.update"),
      assign: call("positions.assign"),
      delete: call("positions.delete"),
    },
    wiki: {
      list: call("wiki.list"),
      get: call("wiki.get"),
      search: call("wiki.search"),
      create: call("wiki.create"),
      update: call("wiki.update"),
    },
    elections: { list: call("elections.list"), get: call("elections.get"), create: call("elections.create") },
    calendar: { list: call("calendar.list"), currentSession: call("calendar.currentSession") },
    exists: { position: call("exists.position"), wikiPage: call("exists.wikiPage") },
  };
  Object.defineProperty(window, "EagleBot", { value: Object.freeze(sdk), writable: false, configurable: false });

  // Tell the host how tall the app is, so an inline app never scrolls twice.
  const measure = () => post({ type: "height", height: Math.ceil(document.documentElement.scrollHeight) });
  window.addEventListener("load", measure);
  new ResizeObserver(measure).observe(document.documentElement);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") post({ type: "escape" });
  });
  const report = (text: unknown) => post({ type: "error", error: String(text).slice(0, 500) });
  window.addEventListener("error", (event) => report(event.message || event.error));
  window.addEventListener("unhandledrejection", (event) => report(event.reason?.message ?? event.reason));
}

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "worker-src blob:",
].join("; ");

/** The whole document the frame loads. */
function frameDocument(app: ViewApp, channel: string, params: Record<string, string>): string {
  const init = JSON.stringify({
    channel,
    identity: app.identity,
    display: app.display,
    place: app.place,
    params,
    stores: app.stores,
  }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<style>
  html, body { margin: 0; }
  body { font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #172033; padding: 4px 2px 12px; }
  ${app.display === "fullscreen" ? "html, body { height: 100%; } body { padding: 16px; box-sizing: border-box; }" : ""}
  button, input, select, textarea { font: inherit; }
</style>
<script>(${sdkBoot.toString()})(${init});</script>
</head><body>
${app.html}
</body></html>`;
}

/* -------------------------------------------------------------------------- */
/*  The host                                                                   */
/* -------------------------------------------------------------------------- */

const MAX_MESSAGE = 300_000;

const NO_PARAMS: Record<string, string> = {};

export function AppFrame({
  app,
  fullWindow = false,
  onExitFullWindow = () => {},
  params = NO_PARAMS,
  onNavigate,
}: {
  app: ViewApp;
  /** Drawn over the whole window, with a bar and an Exit button. */
  fullWindow?: boolean;
  onExitFullWindow?: () => void;
  /** The page address's parameters (`?record=42`), as `EagleBot.params`. */
  params?: Record<string, string>;
  /** Opens the app's page with these parameters. */
  onNavigate?: (params: Record<string, string>) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const paramsKey = JSON.stringify(params);
  const channel = useMemo(() => crypto.randomUUID(), [app, paramsKey]);
  const srcDoc = useMemo(() => frameDocument(app, channel, params), [app, channel]); // eslint-disable-line react-hooks/exhaustive-deps
  const [codeRequest, setCodeRequest] = useState<{
    prompt: string;
    resolve: (code: string) => void;
    reject: (error: Error) => void;
  } | null>(null);
  const [height, setHeight] = useState(240);
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const loads = useRef(0);

  useEffect(() => {
    setError(null);
    setStopped(false);
    loads.current = 0;
    let calls = 0;
    const started = Date.now();
    const receive = async (event: MessageEvent) => {
      const child = frame.current?.contentWindow;
      if (!child || event.source !== child) return;
      const message = event.data as Record<string, unknown> | null;
      if (!message || message.channel !== channel) return;
      if (message.type === "height") {
        const next = Number(message.height);
        if (Number.isFinite(next)) setHeight(Math.max(120, Math.min(6000, next)));
        return;
      }
      if (message.type === "escape") {
        if (fullWindow) onExitFullWindow();
        return;
      }
      if (message.type === "error") {
        setError(String(message.error ?? "").slice(0, 500));
        return;
      }
      if (message.type !== "call" || typeof message.id !== "number" || typeof message.method !== "string") return;

      const reply = (ok: boolean, value: unknown, problem?: string) =>
        child.postMessage({ type: "result", channel, id: message.id, ok, value, error: problem }, "*");
      try {
        // Generous for a person clicking; a runaway loop runs out fast.
        if (++calls > 120 + Math.floor((Date.now() - started) / 500)) {
          throw new Error("This app is making requests too quickly. Reload the page to start it again.");
        }
        if (JSON.stringify(message).length > MAX_MESSAGE) throw new Error("That request is too large (over 300 KB).");
        const handler = Object.hasOwn(METHODS, message.method) ? METHODS[message.method] : null;
        if (!handler) throw new Error(`EagleBot.${message.method} isn't something an app can do.`);
        const args = Array.isArray(message.args) ? message.args : [];
        const appPath = `/t/${app.identity.tacon.installId}/app`;
        const host: Host = {
          askCode: (prompt) =>
            new Promise<string>((resolve, reject) => setCodeRequest({ prompt, resolve, reject })),
          link: (next) => {
            const query = new URLSearchParams(next).toString();
            return `${window.location.origin}${appPath}${query ? `?${query}` : ""}`;
          },
          navigate: (next) => {
            if (onNavigate) onNavigate(next);
            else {
              const query = new URLSearchParams(next).toString();
              window.history.pushState(null, "", `${appPath}${query ? `?${query}` : ""}`);
              window.dispatchEvent(new PopStateEvent("popstate"));
            }
          },
        };
        reply(true, await handler(args, app, host));
      } catch (failure) {
        reply(false, null, failure instanceof Error ? failure.message : "That didn't work.");
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [app, channel, fullWindow, onExitFullWindow, onNavigate]);

  // Escape works from the host page too, when the frame doesn't have focus.
  useEffect(() => {
    if (!fullWindow) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onExitFullWindow();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullWindow, onExitFullWindow]);

  const iframe = stopped ? (
    <Banner tone="error" title="This app was stopped">
      It tried to leave its sandbox by opening another page, which Tac-On apps aren't allowed to do.
      Tell the person who wrote it.
    </Banner>
  ) : (
    <iframe
      key={channel}
      ref={frame}
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-forms allow-modals"
      allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; usb 'none'"
      referrerPolicy="no-referrer"
      title={app.identity.tacon.name}
      className={fullWindow ? "h-full w-full border-0 bg-white" : "w-full border-0 bg-transparent"}
      style={fullWindow ? undefined : { height }}
      onLoad={() => {
        // The first load is the app. Any other is the frame navigating itself
        // somewhere else, which could carry data out - so it's stopped.
        loads.current += 1;
        if (loads.current > 1) setStopped(true);
      }}
    />
  );

  const problem = error && (
    <div className="mb-2">
      <Banner tone="warning" title="This app hit an error">
        {error}
      </Banner>
    </div>
  );

  const codeBox = codeRequest && (
    <CodeBox
      prompt={codeRequest.prompt}
      onSubmit={(code) => {
        codeRequest.resolve(code);
        setCodeRequest(null);
      }}
      onCancel={() => {
        codeRequest.reject(new Error("Signing was cancelled, so nothing was saved."));
        setCodeRequest(null);
      }}
    />
  );

  if (!fullWindow) {
    return (
      <div>
        {problem}
        {iframe}
        {codeBox}
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white" role="dialog" aria-modal="true" aria-label={app.identity.tacon.name}>
      <div className="flex shrink-0 items-center gap-3 border-b border-gray-200 bg-gray-50 px-4 py-2">
        <span className="text-lg" aria-hidden="true">
          {app.identity.tacon.icon}
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold text-gray-900">{app.identity.tacon.name}</span>
        <button type="button" onClick={onExitFullWindow} className="btn-secondary btn-sm">
          <Minimize2 className="h-4 w-4" /> Exit full screen
        </button>
      </div>
      {problem && <div className="px-4 pt-2">{problem}</div>}
      <div className="min-h-0 flex-1">{iframe}</div>
      {codeBox}
    </div>
  );
}

/**
 * Eagle Bot's own box for a confirmation code. It's drawn by Eagle Bot, not
 * the app, so the code goes straight to the server and the app never sees it.
 */
function CodeBox({ prompt, onSubmit, onCancel }: { prompt: string; onSubmit: (code: string) => void; onCancel: () => void }) {
  const [code, setCode] = useState("");
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="tacon-code-title">
      <form
        className="card-pad w-full max-w-sm space-y-3 bg-white"
        onSubmit={(event) => {
          event.preventDefault();
          if (code.length === 6) onSubmit(code);
        }}
      >
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">Sign with your code</div>
          <h2 id="tacon-code-title" className="mt-1 font-semibold text-gray-900">
            {prompt}
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Your private six-digit confirmation code, from your profile. Eagle Bot checks it; the Tac-On never sees it.
          </p>
        </div>
        <input
          className="input tracking-widest"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          aria-label="Your six-digit confirmation code"
        />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={code.length !== 6}>
            Sign and save
          </button>
        </div>
      </form>
    </div>
  );
}
