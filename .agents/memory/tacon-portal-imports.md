---
name: Tac-On portal imports
description: Folder-first publishing preference and the reason compiler compatibility must be checked against the live server.
---

The user asked to change dev portal publishing to folder upload rather than
requiring copied TacScript.

Learners with dev status should also have the option to upload their folder
and edit it in the dev menu.

**Why:** The user asked for folder authoring in the learner dev menu too,
not only the separate developer portal.

**How to apply:** Include the academy learner dev menu when changing folder
upload and editing flows.

**Why:** The copied Eagle Buck source failed in the live portal because the
published bundle did not yet contain the market engine that existed in the
workspace. Importing a folder alone cannot add language features to an old
published engine.

**How to apply:** Keep folder selection as the primary portal publishing path.
Accept one declarative TacScript source, not arbitrary executable folder code.
Keep server compilation authoritative. When new syntax fails only on the live
site, compare the published compiler with the workspace before weakening
validation or rewriting a valid package.