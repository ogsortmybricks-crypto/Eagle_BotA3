# Tac-On testing environment

This runs **the real Eagle Bot**: the same server, compiler, permissions and
database code as the live site. It runs on your machine against a throwaway
database with a ready-made academy full of test people. You publish, install
and use your Tac-On through Eagle Bot's own API, as each of those people, and
see exactly what each one gets.

Nothing here touches the live site except `check --live`, which only compiles
and saves nothing.

## Quick start

```sh
testing/sandbox up                                         # start everything (about 10 s)
node testing/tacon-test.mjs try tacons/my-tacon/my-tacon.tacon
```

`try` compiles the file on the sandbox server, publishes it as the sandbox dev,
installs it (or updates the existing install) as the sandbox admin, and prints
what **every persona** sees: their sidebar, every page, panels on Eagle Bot's
pages, and position desks. That one report answers most "does this work and
who can see it?" questions.

```
=== learner2 (Leo Learner, learner) ===
  sidebar: ledger
  page ledger "Smoke Ledger":
    note: You're holding 15 points. The Treasurer is Lia Learner.
    form [index 2] "Log points" DENIED (Only admins and the Treasurer can add to this.)
    list entry: 2 row(s) [hero, amount, reason, by]
  page staff: 403 This page isn't open to your role or your positions.
```

Run `testing/examples/sandbox-smoke.tacon` first to check the sandbox works.

## The sandbox academy

`Tac-On Sandbox`, with two studios, **launchpad** and **middle**:

| Persona | Role | Studio | Why it's there |
| --- | --- | --- | --- |
| `admin` | admin | (all) | Installs, configures, appoints. Has dev status. |
| `learneradmin` | admin, learner admin | launchpad | A learner who runs Eagle Bot |
| `guide` | guide | launchpad | Adults: should *not* be the keepers of the rules |
| `secretary` | secretary | launchpad | Town Hall's learner secretary |
| `learner1`, `learner2` | learner | launchpad | Ordinary learners, for pairs and "can't see the other's" checks |
| `learner3` | learner | middle | Another studio. A Launchpad install must be invisible to them |
| `dev` | learner with dev status | launchpad | Publishes your Tac-Ons, like a learner dev would |

`node testing/tacon-test.mjs personas` prints them. All share the password in
`SANDBOX_PASSWORD` (default `sandbox-password`).

## Commands

### `testing/sandbox` (server and database)

| Command | Does |
| --- | --- |
| `up` | Start the database, apply the engine's schema, (re)start the server on the **current engine code**, seed personas. Run it again after the engine changes. |
| `down` / `status` / `logs [n]` | Stop it, check it, read the server log |
| `reset` | Delete the sandbox academy (every Tac-On, install, record, position) and re-seed. Use it for a clean slate. |
| `fire <event> [--studio s] [--actor p] [--winner p] [--votes n] [--summary "..."] [--metadata '{}']` | Fire a real Eagle Bot event, so your `when` blocks run exactly as they would live. Example: `fire election.certified --winner learner2` |
| `records <slug>` | Dump every stored record of your Tac-On, including the raw `data` |

### `node testing/tacon-test.mjs` (using a Tac-On)

| Command | Does |
| --- | --- |
| `check <file>` | Compile on the sandbox server |
| `check <file> --live` | Compile on the **live** site. Read-only. Needs `LIVE_*` in `sandbox.env`. |
| `try <file> [--studio launchpad\|middle\|academy] [--setting k=v] [--hold position=persona] [--as p1,p2]` | Deploy and report what everyone sees |
| `view <slug> <page> --as p` | One page as one persona |
| `panel <slug> <host> --as p` / `desk <slug> --as p` | Panels on a base page / position desks |
| `submit <slug> --as p --page <name> --index <n> --values '<json>'` | Fill in a form. The index is printed next to each form. `person` fields take a user id. |
| `press <slug> --as p --page <name> --index <n>` | Press a button |
| `remove <slug> [--studio s]` | Uninstall, which deletes its records, as on the live site |
| `api <METHOD> <path> --as p [--body '<json>']` | Any Eagle Bot API call, such as an extension's routes or `/api/positions` |

Add `--json` to anything for the raw response. The last result is always in
`testing/out/last.json`.

**Published versions are frozen, in the sandbox too.** If your source's
version is already published there, `try` publishes it as the next free patch
and says so. Your file isn't changed. `reset` starts the numbering over.

## Scenario tests

For anything you'll want to re-check later, especially after an engine change,
write a scenario test instead of one-off commands. Copy
[`examples/sandbox-smoke.scenario.test.mjs`](examples/sandbox-smoke.scenario.test.mjs)
to `tacons/<slug>/sandbox.test.mjs`:

```js
import { sandbox } from "../../testing/client.mjs";
const sb = sandbox();
const { install } = await sb.deploy("tacons/my-tacon/my-tacon.tacon", { holders: { treasurer: "learner1" } });
const view = await sb.as("learner2").view(install.id, "ledger");
```

Run it with `node --test tacons/<slug>/sandbox.test.mjs`. Assert the things
that matter: who is denied (expect a 403 `ApiError`), what each persona's
numbers are, and that a studio install is invisible from the other studio.

Test the API directly as well as through the view. A form that *shows* as
denied but accepts a direct `submit` is a security bug.

## What the sandbox can't do yet

- Upload files (screenshots and so on) from the CLI. Use `api` with a route
  that takes JSON, or request support in `ENGINE-REQUESTS.md`.
- Run real elections or Town Halls end to end. Use `fire` to trigger their
  events instead.
- Show you the rendered React UI. It reports the data the UI is built from. For
  visual checks, sign in at `http://localhost:5199` as a persona (email
  `<persona>@tacon-sandbox.invalid`).

If something here gets in your way, that's an engine/tooling request. Put it in
`ENGINE-REQUESTS.md` (see [../docs/04-engine-requests.md](../docs/04-engine-requests.md)).

## Setup and configuration

Requirements: Docker, Node 20+, and an Eagle Bot checkout with `npm install`
done.

Copy `sandbox.env.example` to `sandbox.env` (gitignored) and adjust:

- `EAGLE_BOT_ENGINE`: the Eagle Bot checkout. While this folder lives inside
  the Eagle Bot repo it defaults to the repo root. **In a separate Tac-Ons repo
  you must set it**, for example `/workspaces/Eagle_BotA3`, and `git pull`
  there to pick up engine changes.
- `SANDBOX_PORT` (5199), database container settings, `SANDBOX_PASSWORD`.
- `LIVE_URL` plus either `LIVE_PORTAL_EMAIL`/`LIVE_PORTAL_PASSWORD` (dev portal)
  or `LIVE_EMAIL`/`LIVE_PASSWORD` (an academy account with dev status), only
  for `check --live`. Ask the user for these. Never commit them.

Safety rails, so don't work around them:

- The sandbox database must be local and have "sandbox" in its name, or
  `testing/sandbox` refuses to touch it.
- The HTTP client refuses non-local servers unless `SANDBOX_ALLOW_REMOTE=1`.
  That's only for a throwaway staging server, never the live site: publishing
  there would claim real slugs and create real records.
