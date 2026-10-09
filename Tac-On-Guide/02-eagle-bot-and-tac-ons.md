# Eagle Bot and Tac-Ons

## What Eagle Bot does

Eagle Bot is where a studio's self-government lives:

- **Wiki.** The studio's Contract: sections and rules, each one created,
  amended or repealed over time.
- **Town Hall.** Meetings with agendas, attendance and a Secretary. Notes can
  be processed into rule changes.
- **Elections.** Nominations, votes and certified results.
- **Positions.** Jobs the studio fills by election or appointment, with terms
  and history.
- **People.** The academy's roster, by role and studio.
- **Activity log.** A record of everything that happened.

An **academy** has several **studios** (Spark, Middle Studio, Launchpad and so
on). Studios can be grouped so they share things. Everyone has a **role**:
`admin`, `guide`, `secretary` or `learner`. Some admins are **learner admins**:
learners the studio trusts to run Eagle Bot. They have admin powers but are
still learners.

## What a Tac-On is

An add-on, like a browser extension. One `.tacon` file, written in TacScript,
can add:

| It can add | Where it shows up |
| --- | --- |
| **Pages** | The sidebar, under a separate *Tac-Ons* heading |
| **Panels** | Cards at the bottom of Eagle Bot's own pages: `wiki`, `town-hall`, `elections`, `positions`, `people`, `admin` |
| **Positions** | Real positions on the Positions page, elected or appointed like any other, each with a private **desk** for whoever holds it |
| **Reactions** (`when`) | Run by themselves when something happens, such as an election being certified |
| **Stores** | Its own tables of records |
| **Settings** | Questions the installing admin answers, such as a number or a choice |

It can **read** Eagle Bot's wiki rules and sections, positions, elections,
meetings, people and activity log. It can **write** only to its own stores and
to the activity log.

## The safety model

This is why an academy can install a Tac-On written by a fourteen-year-old at
another school. The engine enforces every rule. Don't design anything that
depends on getting around one.

- **Nothing executes.** A Tac-On describes what to show and record. The server
  compiles and renders it. No code from a Tac-On ever runs.
- **Reads are scoped to the viewer.** Every read uses the permissions and
  studio of the person looking, not the author's or the installer's. A learner
  who can't see the activity log gets an empty list with a note saying why.
- **Writes are limited to its own records.** A Tac-On can't edit the wiki,
  create elections, change people, send email or reach another academy.
- **Reach is declared.** Every Eagle Bot source a Tac-On lists is shown to the
  admin before they install it.
- **Failures are quiet.** A broken reaction fails silently and never breaks
  somebody's election.
- **Borrowing is read-only.** One Tac-On can read what another `provides`, in
  the same academy. If the other isn't installed, its lists come back empty and
  its numbers read zero.

## Who's who

| Person | What they do with Tac-Ons |
| --- | --- |
| **Learner with dev status** | Writes and publishes Tac-Ons in the **Dev menu**. An admin grants dev status from the person's profile. It's not a role and changes nothing about voting or reading. |
| **Admin** | Browses **Tac-Ons → Market**, installs, configures, updates and removes them |
| **Everyone else** | Uses installed Tac-Ons' pages, panels, forms and desks |
| **Portal devs** | Eagle Bot's maintainers. They publish **official** Tac-Ons (with a badge) from the dev portal (Ctrl+D). |

## Lifecycle

**Publish.** From the Dev menu (or the dev portal for official ones), choose:

- **Draft:** only your own academy sees it in the market.
- **Unlisted:** anyone with the link.
- **Public:** every academy on this Eagle Bot.

The `version` line decides the version. **A published version is frozen:**
publishing the same version again is refused. The slug (`tacon my-slug`)
belongs to whoever publishes it first.

**Install.** An admin installs it **for one studio** or **academy-wide**.
Two studio installs keep completely separate records. Studios in a group share
one install's records. Settings are filled in at install and can be changed
later.

**Update.** Nothing changes for an academy until its admin presses **Update**.
A Town Hall must never find a page changed mid-meeting. So **every new version
must work with records saved by older versions.**

**Turn off / remove.** *Turn off* hides it and keeps its records. *Remove*
**deletes every record it made**. Positions it added are archived, and their
history is kept.

**Stats.** The Dev menu shows installs over time and which versions academies
are running.
