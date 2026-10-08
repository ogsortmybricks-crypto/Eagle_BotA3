# Tac-Ons repo

This repo holds **Tac-Ons**: add-ons for **Eagle Bot**, a self-governance app
for Acton Academy learners. It does not hold Eagle Bot itself. Eagle Bot (the
"engine", or "Eagle Bot Main") lives in a separate repo,
`ogsortmybricks-crypto/Eagle_BotA3`.

Read these before doing anything substantial:

1. [docs/01-what-this-is.md](docs/01-what-this-is.md): who uses this, what a
   Tac-On is, and the safety model you must not break.
2. [docs/02-authoring-playbook.md](docs/02-authoring-playbook.md): how to build,
   check, version and ship a Tac-On.
3. [docs/03-engine-extensions.md](docs/03-engine-extensions.md): only when a
   Tac-On needs something TacScript can't express.
4. [docs/reference/TacScript.md](docs/reference/TacScript.md): the full
   language. This is the source of truth for syntax.
5. [docs/reference/Tac-Ons.md](docs/reference/Tac-Ons.md): the user-facing
   lifecycle (market, install, update, remove, dev portal).
6. [testing/README.md](testing/README.md): the testing environment, a real
   Eagle Bot server with a sandbox academy you drive as test personas. **Test
   every Tac-On here.**
7. [docs/04-engine-requests.md](docs/04-engine-requests.md): how to ask for
   engine changes through `ENGINE-REQUESTS.md`, and how to re-test once they ship.
8. [context/](context/): Acton Academy vocabulary and philosophy. When a prompt
   uses a word you don't know (Guide, Hero, Studio, Contract, Town Hall, AP,
   Quest, NGA...), look it up here before you guess.

## Ground rules

- **Learners are the users.** Kids roughly 8 to 18 run their own studio. They
  write Tac-Ons too. Write UI text a twelve-year-old can follow. Don't build
  things that make adults the keepers of the rules.
- **Declarative first.** A Tac-On is one `.tacon` file in TacScript. Reach for an
  engine extension (executable TypeScript) only when TacScript can't express the
  feature. Say why before you write one.
- **A Tac-On never shows anyone more than they could already see**, writes only
  to its own records, and fails quietly instead of breaking the app. Don't design
  around these rules.
- **Published versions are frozen.** Bump `version` on every publish. Never
  publish over an existing version.
- **Removing an install deletes its records.** Every update must work for
  academies that already have data. Tell users to *Update*, never "uninstall and
  reinstall".
- **The live server's compiler decides what's legal.** If something compiles in
  a local engine checkout but fails on the live site, the live engine is
  probably older. Don't weaken the source to get around it. Ship the engine
  first.
- **Eagle Bucks is not part of Eagle Bot's product.** `eagle-buck-market` exists
  as an example package only. Don't build new Eagle Buck features unless asked.
- **One person builds, sells and supports this, online only.** Keep anything
  you plan (rollouts, onboarding, support) sized for one person.

## Repo layout

```
CLAUDE.md
ENGINE-REQUESTS.md         # you create this: changes you need from the engine
docs/                      # these guides
context/                   # Acton vocabulary
testing/                   # the sandbox: real Eagle Bot + test personas
tacons/<slug>/             # one folder per Tac-On
  <slug>.tacon             # the only file that gets published
  README.md                # what it does, its rules, publish/install steps
  sandbox.test.mjs         # scenario test against the sandbox
```

Packages that need an engine extension use a different layout. See
[docs/03-engine-extensions.md](docs/03-engine-extensions.md).

## Working with the engine

Everything is tested against the real engine through
[testing/](testing/README.md): `testing/sandbox up` runs Eagle Bot from an
engine checkout on a throwaway database. While this folder sits inside the
Eagle Bot repo, that checkout is the repo itself. Once it's a separate repo,
keep Eagle Bot checked out next to it and set `EAGLE_BOT_ENGINE` in
`testing/sandbox.env`:

```
/workspaces/Eagle_BotA3      # engine (npm install done)
/workspaces/<this repo>      # Tac-Ons
```

Don't copy engine code into this repo. Copies drift from what's live.

**For now this folder lives inside the Eagle Bot repo. Only create or edit
files inside this folder.** The rest of the repo is the engine.

**Don't edit the engine.** If a Tac-On needs an engine change (a bug fix, new
keyword, new event, new data source, or something the sandbox can't do), add
an entry to `ENGINE-REQUESTS.md` as described in
[docs/04-engine-requests.md](docs/04-engine-requests.md). The user passes it to
the engine's agent. When they tell you it shipped, run `testing/sandbox up`
again and re-test.

## When you finish something

- `node testing/tacon-test.mjs try <file>` shows every persona seeing what they
  should and nothing more, and the Tac-On's `sandbox.test.mjs` passes.
- `check --live` passes, or you've told the user it needs an engine release
  first.
- The package README says, in plain language, what it adds, who sees what, and
  how to publish, install and update it.
- If you changed an existing Tac-On, bump the version and write down in its
  README what happens to installs that already have data.
