# Tac-On Guide

You're building **Tac-Ons**: add-ons for **Eagle Bot**, a web app that helps
learners at Acton Academies run their own studio — their Contract (rules),
Town Halls, elections and positions.

A Tac-On is a **small web app**. It's a folder with a `manifest.json` and an
`index.html`, plus any CSS and JavaScript you like. An academy installs it from
the Tac-On Market, and it appears in that studio's sidebar. It runs in a
sandbox and works with Eagle Bot through the **`EagleBot` SDK**: its own
records, people, positions, the wiki, elections and the calendar.

> **TacScript has been retired.** Tac-Ons used to be written in a small
> language called TacScript (`.tacon` files). New Tac-Ons, and new versions of
> old ones, are apps. Tac-Ons already installed keep working until their
> author publishes the app version, and their records carry over. See
> [08-moving-from-tacscript.md](08-moving-from-tacscript.md).

## Your job

1. **Build the best Tac-Ons you can with the engine as it is today.** Most
   good ideas fit. [06-limits-and-workarounds.md](06-limits-and-workarounds.md)
   shows how to design around what doesn't.
2. **Tell us what's missing.** When the engine stops you building something
   worthwhile, write it in `ENGINE-REQUESTS.md`. See
   [09-engine-requests.md](09-engine-requests.md). Don't wait for it: ship the
   best version you can now, and note what the request would improve.

## Read in this order

| File | What it gives you |
| --- | --- |
| [01-acton-philosophy.md](01-acton-philosophy.md) | Who the users are and what they believe. Every design decision starts here. |
| [02-eagle-bot-and-tac-ons.md](02-eagle-bot-and-tac-ons.md) | What Eagle Bot does, what a Tac-On is, the sandbox, and the publish / install / update lifecycle |
| [03-app-format.md](03-app-format.md) | The folder, `manifest.json`, install-time setup, full screen, and what the sandbox allows |
| [04-sdk-reference.md](04-sdk-reference.md) | Everything `window.EagleBot` can do, and who is allowed to do it |
| [05-designing-great-tac-ons.md](05-designing-great-tac-ons.md) | How to decide what to build, patterns that work, and a complete worked example |
| [06-limits-and-workarounds.md](06-limits-and-workarounds.md) | What the engine can't do yet, and how to build around each gap |
| [07-testing-and-publishing.md](07-testing-and-publishing.md) | Testing as different people, versions, publishing, exporting |
| [08-moving-from-tacscript.md](08-moving-from-tacscript.md) | Rebuilding a TacScript Tac-On as an app without losing its records |
| [09-engine-requests.md](09-engine-requests.md) | How to ask for engine additions |

## Ground rules

- **Learners are the users.** Kids aged about 8 to 18 run their own studio.
  Many Tac-On authors are learners too. Write every label and message so a
  twelve-year-old understands it on first read.
- **Learners own it, not adults.** Don't build anything that turns Guides into
  the keepers of the rules. Give the job to the studio: a position it elects,
  a form any learner can use, a record anyone can read.
- **Fit next to Journey Tracker, don't copy it.** Most academies already use
  the network's Journey Tracker for goals, points, badges, Quest progress,
  Hero/Eagle Bucks and peer reviews. Eagle Bot covers self-government. Build
  there.
- **The engine is the only authority.** This guide describes Eagle Bot as of
  October 2026. If the Dev menu's checklist or the SDK disagrees with anything
  here, they're right. Note the difference in `ENGINE-REQUESTS.md`.
- **Tac-Ons live in the app.** A Tac-On exists only once it's published through
  Eagle Bot's Dev menu or dev portal. Keep your app folders in your own
  workspace. They're never added to Eagle Bot's code.
