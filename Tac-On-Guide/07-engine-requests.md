# Engine requests

You can't change the engine. The user passes your requests to whoever
maintains Eagle Bot. Keep them in **one file, `ENGINE-REQUESTS.md`**, in your
workspace. Create it the first time you need it.

## What to put in it

Anything that would make Tac-Ons better, possible or easier:

- **Bugs:** the engine behaves differently from the reference, or something
  compiles but does the wrong thing.
- **Language features:** actions (edit a record?), expressions (`or`, dates),
  field types (uploads?), widgets, form options (fill in `me`), validation.
- **Events and data:** a `when` event or a `list from` source that doesn't
  exist yet.
- **Display:** icons, links, layout.
- **Docs:** something here that was wrong or missing.

Good requests are **generic**: something every Tac-On author could use, not a
feature for one Tac-On. "Let a reaction run on a schedule" is better than
"remind the Agenda Keeper on Fridays".

The limits in [05-limits-and-workarounds.md](05-limits-and-workarounds.md) are
a good start. Request the ones that actually cost you something, and say what
you'd build with them.

## Format

Number every entry. Newest at the bottom.

```markdown
## ER-001: Let a form fill a field with the person submitting

- **Status:** open
- **Kind:** language feature
- **Priority:** blocks a Tac-On | workaround exists | nice to have
- **Needed by:** promise-log (and any "my own records" Tac-On)

**The problem.** Forms can only offer fields for the user to fill in. A
`person` field can be set to anyone, so "my promises" can't be trusted. `by`
holds a name, which isn't unique.

**What I tried.** Smallest snippet and what the Dev menu showed:

    form "Make a promise" {
      into promise
      ask text
    }

**What would fix it.** For example `set who me.id` inside a form, or a `by_id`
column on every record.

**What it unlocks.** Trustworthy personal records: promises, check-ins,
appeals.

**How to verify.** The snippet compiles, and a learner's record shows their
own name in `who` whatever they send.
```

## Status values

| Status | Set by | Meaning |
| --- | --- | --- |
| `open` | you | Written, not yet handed over |
| `shipped`, plus a note | maintainer | Done. The note says what changed if it differs from the request. |
| `declined: <reason>` | maintainer | Won't be done. Design around it. |
| `verified` | you | You re-tested in the Dev menu and it works |
| `reopened: <what failed>` | you | Re-tested, and it doesn't work. Add what you saw. |

## When the user says the engine changed

1. The change is only live once Eagle Bot has been published. Ask if you're
   not sure.
2. For each `shipped` entry, run its **How to verify** steps in the Dev menu.
3. Mark each one `verified` or `reopened`.
4. Remove workarounds that are no longer needed, bump those Tac-Ons' versions,
   and republish.
5. Update your copy of the reference if the language changed.

Write every entry so someone with the engine code, but not your conversation,
can act on it without asking you anything.
