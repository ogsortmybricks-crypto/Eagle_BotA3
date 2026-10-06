---
name: Git state after approval
description: Recheck Git operation state after waiting for user approval.
---

Re-read Git status, operation markers and branch history after the user approves
a Git repair. Do not assume a previously observed merge is still in progress.

**Why:** An unfinished merge disappeared while waiting for approval and a new
local commit appeared, but the local and upstream histories still diverged.
The cause was not established; do not attribute it to a particular actor.

**How to apply:** Check status, unmerged entries, MERGE_HEAD/rebase markers and
upstream divergence before aborting, restarting or completing an operation.
Resolve against the current tree and preserve any externally added work.
