# What you're working on

## Eagle Bot, in one paragraph

Acton Academies are learner-driven schools. There are no teachers. Adults are
**Guides**, who ask questions instead of giving answers. Learners (called
**Heroes** or **Eagles**) govern their own **Studio**: they write and vote on a
**Contract** of rules, hold **Town Halls**, run **elections** for **positions**,
and hold each other accountable. Eagle Bot is the software for that
self-government: a wiki of the Contract, Town Hall meetings, elections,
positions, people and an activity log, scoped per academy and per studio.

The product helps **learners** organize their own rules. It does not help adults
remember rules for them. Keep that in mind for every design choice.

## What a Tac-On is

A Tac-On is an add-on for Eagle Bot, like a Chrome extension or a Minecraft
data pack. It can add:

- **pages** in the sidebar (under a separate *Tac-Ons* heading),
- **panels** at the bottom of Eagle Bot's own pages (wiki, town-hall, elections,
  positions, people, admin),
- **positions** on the Positions page, each with a private *desk* for whoever
  holds the seat,
- **reactions** (`when`) that run when something happens, such as an election
  being certified,
- its own **stores** (tables), **settings** the installing admin fills in, and
  computed values (`ask`).

Two things make this different from a feature request:

1. **The academy decides what runs.** Nothing is installed until an admin
   installs it, either in one studio or academy-wide.
2. **Learners write them.** An admin gives a learner *dev status*. That learner
   can then write a Tac-On in the Dev menu, publish it to the market, and see
   other academies install it. That's the point of the whole system.

## The safety model

Eagle Bot lets a fourteen-year-old ship code to every academy on the server.
That only works because of these rules. Each one is enforced by the engine.
Don't design a Tac-On that relies on breaking one.

| Rule | What it means for you |
| --- | --- |
| **Nothing executes.** | A `.tacon` file is a description. The server compiles it to a manifest and renders it. No uploaded JS/TS ever runs. |
| **Viewer-scoped reads.** | Every read uses the permissions and studio of the *person looking*, not the author or installer. A learner who can't see the activity log sees an empty list. |
| **Own records only.** | A Tac-On can't edit the wiki, create elections, send email, edit people, or touch another academy. It writes only to its own stores. |
| **Declared reach.** | Every Eagle Bot source a Tac-On lists (`wiki.rules`, `people`, `activity`...) is shown to the admin before install. Listing a source never grants access. |
| **Quiet failure.** | A broken reaction fails silently. A Tac-On must never break somebody's election. |
| **Read-only borrowing.** | `use other-tacon as x` reads only what that Tac-On `provides`, in the same academy. If it isn't installed, lists come back empty and numbers read zero. |

Engine extensions (see [03](03-engine-extensions.md)) are the one exception to
"nothing executes". They're trusted code that ships *inside* Eagle Bot's build,
reviewed like the rest of the engine. They follow the same viewer-scope and
own-records rules.

## Lifecycle you're designing for

- **Publish:** Draft (own academy only), Unlisted (link), or Public (every
  academy on the deployment). A version, once published, is frozen. The slug
  (`tacon my-name`) belongs to whoever first publishes it.
- **Official Tac-Ons** are published from the **dev portal** (Ctrl+D) by Eagle
  Bot maintainers. The portal imports a folder and publishes **only** its single
  `.tacon` file. READMEs and tests are ignored.
- **Install:** studio or academy-wide. Two studio installs keep separate records.
  Studios in a *studio group* share one install's records.
- **Update:** nothing changes for an academy until its admin presses *Update*.
  A Town Hall should never find a page changed in the middle of a meeting.
- **Turn off:** hides the Tac-On and keeps its records. **Remove:** deletes every
  record it made. Positions it added are archived, and their holder history stays.

So every new version must work against **existing records** from earlier
versions. Renaming or dropping a store field is a migration problem, not a
cleanup.

## Runtime limits worth knowing

- Totals (`sum`, `count`...) are computed over a store's most recent **2,000
  rows**. If a design could pass that, it needs a different shape or a built-in
  engine feature (the `market` ledger uses the full history for this reason).
- Reactions run *as the Tac-On*, with no viewer, so `me.*` means nothing inside
  `when`.
- There is no `or` in conditions, and no loops or variables. Two lists usually
  read better than one clever condition.

## Who you're writing for

- **Learners** use most screens. Short sentences, concrete labels, no jargon.
  Think about a busy learner on a Friday afternoon. What would actually help?
- **Admins and Guides** install, configure and oversee. Admins can be learners
  too (*learner admins*). Secretaries are almost always learners.
- **Learner devs** read your source to learn TacScript. Comment `.tacon` files
  the way you'd want a curious kid to find them.

## Things that already exist

| Package | What it shows |
| --- | --- |
| `eagle-buck-market` | A pure `.tacon` using the built-in `market` declaration: a points ledger, catalog, Shopkeeper position, academy-wide scope. Example only. Eagle Bucks isn't part of the product. |
| `accountability-partners` | An **engine-extension** package: pairing learners, weekly check-ins (3 days a week, Friday required), screenshot evidence, certified work, public verification links. All its code is package-owned. Eagle Bot Main only supplies generic dispatch and shared services. |

Earlier starters (Hero Bucks, Quest Board, Gratitude Wall, Buck Shop) were
retired. Don't bring them back unless asked.
