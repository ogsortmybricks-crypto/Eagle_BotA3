# Tac-On Guide

You're building **Tac-Ons**: add-ons for **Eagle Bot**, a web app that helps
learners at Acton Academies run their own studio. That means their Contract
(rules), Town Halls, elections and positions. A Tac-On adds pages, panels,
positions and automatic reactions to Eagle Bot. It's written in a small,
safe language called **TacScript**.

## Your job

1. **Build the best Tac-Ons you can with the engine as it is today.** TacScript
   is deliberately small. Most good ideas fit inside it if you design around
   its limits instead of fighting them. [05-limits-and-workarounds.md](05-limits-and-workarounds.md)
   shows how.
2. **Tell us what's missing.** When the engine stops you from building
   something worthwhile, or a small addition would make a whole class of
   Tac-Ons possible, write it down in `ENGINE-REQUESTS.md`. See
   [07-engine-requests.md](07-engine-requests.md). Don't wait for the
   addition. Ship the best version you can now, and note what the request would
   improve.

## Read in this order

| File | What it gives you |
| --- | --- |
| [01-acton-philosophy.md](01-acton-philosophy.md) | Who the users are and what they believe. Every design decision starts here. |
| [02-eagle-bot-and-tac-ons.md](02-eagle-bot-and-tac-ons.md) | What Eagle Bot does, what a Tac-On is, the safety rules, and the publish/install/update lifecycle |
| [03-tacscript-reference.md](03-tacscript-reference.md) | The whole language |
| [04-designing-great-tac-ons.md](04-designing-great-tac-ons.md) | How to decide what to build, patterns that work, a complete worked example |
| [05-limits-and-workarounds.md](05-limits-and-workarounds.md) | What the engine can't do yet, and how to build around each gap |
| [06-testing-and-publishing.md](06-testing-and-publishing.md) | Checking, testing as different people, versioning, publishing |
| [07-engine-requests.md](07-engine-requests.md) | How to ask for engine additions |

## Ground rules

- **Learners are the users.** Kids aged about 8 to 18 run their own studio.
  Many Tac-On authors are learners too. Write every label and note so a
  twelve-year-old understands it on first read.
- **Learners own it, not adults.** Don't build anything that turns Guides into
  the keepers of the rules. Give the job to the studio: a position it elects,
  a form any learner can use, a record anyone can read.
- **Fit next to Journey Tracker, don't copy it.** Most academies already use
  the network's Journey Tracker for goals, points, badges, Quest progress,
  Hero/Eagle Bucks and peer reviews. Eagle Bot covers self-government. Build
  there.
- **The engine is the only authority on what compiles.** This guide describes
  the engine as of October 2026. If the Dev menu's compiler disagrees with
  anything here, the compiler is right. Note the difference in
  `ENGINE-REQUESTS.md`.
- **Tac-Ons live in the app.** A Tac-On exists only once it's published through
  Eagle Bot's Dev menu or dev portal. Keep your `.tacon` source files in your
  own workspace. They're never added to Eagle Bot's code.
