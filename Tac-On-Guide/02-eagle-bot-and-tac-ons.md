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
- **People.** The academy's roster, by role and studio. Each studio lists
  its assigned guides.
- **Calendar.** The studio's year: sessions (runs of weeks, each with a
  Quest), breaks, field trips, Exhibitions, Launches and deadlines. Guides and
  admins keep it; everyone reads it.
- **Activity log.** A record of everything that happened.

An **academy** has several **studios** (Spark, Middle Studio, Launchpad and so
on). Studios can be grouped so they share things. Everyone has a **role**:
`admin`, `guide`, `secretary` or `learner`. Some admins are **learner admins**:
learners the studio trusts to run Eagle Bot. They have admin powers but are
still learners.

## What a Tac-On is

A Tac-On is a small web app that adds something to Eagle Bot — like a VS Code
extension, or a Minecraft data pack. It's a folder:

```
sign-in-sheet/
  manifest.json      ← required: name, title, version, icon...
  index.html         ← required: the app
  style.css          ← optional, any depth of folders
  app.js
```

Once an admin installs it, it gets:

| It gets | Where it shows up |
| --- | --- |
| **A page** | The sidebar, under a separate *Tac-Ons* heading, for everyone or only its `audience`. It opens inside the page, or full screen if it asks to. |
| **Its own records** | Stores of records for this install, with rules about who reads, writes and signs each one |
| **Panels** | The same app as a card on Eagle Bot's own pages: Town Hall, the wiki, elections... |
| **Calendar entries** | Its dated records drawn on the studio calendar, opening the app at that record |
| **Reactions** | Records it saves by itself when something happens, such as an election being certified |
| **The SDK** | Read people, positions, the wiki, elections and the calendar; write to them when the person using it is allowed to |
| **Setup at install** | Positions and wiki pages it creates when installed, some of them as questions the admin answers |

## The sandbox

This is why an academy can install a Tac-On written by a fourteen-year-old at
another school. Eagle Bot enforces every rule. Don't design anything that
depends on getting around one.

- **The app runs in a sandbox.** Its HTML runs in a frame with no access to
  Eagle Bot's page, cookies or login. It can't make network requests, load
  scripts or images from the internet, open pop-ups, or navigate away (an app
  that tries is stopped).
- **Everything goes through the SDK.** `window.EagleBot` is the app's only way
  into Eagle Bot. There is **no token**: an app never holds anyone's login.
- **Every call is made as the person using it.** Eagle Bot checks each SDK call
  against that person's role and studio, exactly as if they'd clicked the
  button themselves. A learner using your app can't create a position, however
  the app is written; an admin can.
- **Rules about records are Eagle Bot's, not the app's.** The manifest says
  who may read, add to and sign each store, and the server enforces it. People
  change and delete only the records they saved (admins and guides can change
  any); nobody changes a signed record. Admins can always read everything.
- **Setup is shown first.** The admin sees what an app will create before
  installing it, and can untick anything marked optional.

## Who's who

| Person | What they do with Tac-Ons |
| --- | --- |
| **Learner with dev status** | Builds and publishes Tac-Ons in the **Dev menu**. An admin grants dev status from the person's profile. It's not a role and changes nothing about voting or reading. |
| **Admin** | Browses **Tac-Ons → Market**, installs, answers setup questions, updates, exports and removes them |
| **Everyone else** | Opens installed Tac-Ons from the sidebar and uses them |
| **Portal devs** | Eagle Bot's maintainers. They publish **official** Tac-Ons (with a badge) from the dev portal (Ctrl+D). |

## Lifecycle

**Publish.** In the Dev menu choose **New Tac-On**, then **Choose folder** (or
open a `.taconapp` file). Eagle Bot bundles the folder and shows a checklist.
Once it passes, choose who can find it:

- **Draft:** only your own academy sees it in the market.
- **Unlisted:** anyone with the link.
- **Public:** every academy on this Eagle Bot.

The manifest's `version` decides the version. **A published version is
frozen:** publishing the same version again is refused. The `name` belongs to
whoever publishes it first.

**Install.** An admin installs it **for one studio** or **academy-wide**, and
answers its setup questions. Two studio installs keep completely separate
records. Studios in a group share one install's records.

**Update.** Nothing changes for an academy until its admin presses **Update**.
A Town Hall must never find a page changed mid-meeting. So **every new version
must read records saved by older versions.** Updating runs the setup again,
with the answers the admin gave last time.

**Turn off / remove.** *Turn off* hides it and keeps its records. *Remove*
**deletes every record it made**. Positions it created are archived, and their
history is kept.

**Export.** An installed app can be exported as a `.taconapp` file from its
Market page, to share with a dev somewhere else.

**Stats.** The Dev menu shows installs over time and which versions academies
are running.
