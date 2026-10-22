# Engine requests

You can't change the engine. The user passes your requests to whoever
maintains Eagle Bot. Keep them in **one file, `ENGINE-REQUESTS.md`**, in your
workspace. Create it the first time you need it.

## What to put in it

Anything that would make Tac-Ons better, possible or easier:

- **Bugs:** Eagle Bot behaves differently from this guide, or an SDK call does
  the wrong thing.
- **SDK features:** a call that doesn't exist yet (read Town Hall meetings,
  cast a vote, add to the calendar), or an option on one that does (filter
  records on the server).
- **Format features:** a new setup action, a manifest field, something the
  sandbox blocks that it could safely allow.
- **Things TacScript could do that apps can't:** panels on Eagle Bot's pages,
  calendar entries, reactions to events, private records. Say what you'd build.
- **Display:** icons, layout, full screen.
- **Docs:** something here that was wrong or missing.

Good requests are **generic**: something every Tac-On author could use, not a
feature for one Tac-On. "Let an app react when an election is certified" is
better than "remind the Agenda Keeper on Fridays".

The limits in [06-limits-and-workarounds.md](06-limits-and-workarounds.md) are
a good start. Request the ones that actually cost you something, and say what
you'd build with them.

## Format

Number every entry, carrying on from the last number in the file. Newest at
the bottom.

```markdown
## ER-020: Let an app read Town Hall meetings

- **Status:** open
- **Kind:** SDK feature
- **Priority:** blocks a Tac-On | workaround exists | nice to have
- **Needed by:** promise-log (and any Tac-On built around Town Hall)

**The problem.** Promises are made at Town Hall, but the SDK can't read
meetings, so a learner has to type which meeting each promise came from.

**What I tried.** Smallest snippet and what happened:

    const meetings = await EagleBot.meetings.list();
    // TypeError: Cannot read properties of undefined (reading 'list')

**What would fix it.** `EagleBot.meetings.list()` returning each meeting's id,
title, date and status, for the studios the person can see.

**What it unlocks.** Promise logs, action-item trackers and attendance boards
that link to the meeting they came from.

**How to verify.** The snippet returns this studio's meetings, newest first.
```

## Status values

| Status | Set by | Meaning |
| --- | --- | --- |
| `open` | you | Written, not yet handed over |
| `shipped`, plus a note | maintainer | Done. The note says what changed if it differs from the request. |
| `declined: <reason>` | maintainer | Won't be done. Design around it. |
| `verified` | you | You re-tested and it works |
| `reopened: <what failed>` | you | Re-tested, and it doesn't work. Add what you saw. |

ER-001 to ER-019 were requests for TacScript, all shipped in October 2026.
TacScript has since been retired; read those entries as history.

## When the user says the engine changed

1. The change is only live once Eagle Bot has been published. Ask if you're
   not sure.
2. For each `shipped` entry, run its **How to verify** steps.
3. Mark each one `verified` or `reopened`.
4. Remove workarounds that are no longer needed, raise those Tac-Ons'
   versions, and republish.
5. Update your copy of this guide if the format or the SDK changed.

Write every entry so someone with the engine code, but not your conversation,
can act on it without asking you anything.
