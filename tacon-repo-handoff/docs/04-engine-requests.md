# Engine requests

You can't change Eagle Bot from here. When the engine is in your way, write it
down in **`ENGINE-REQUESTS.md`** at the root of this repo. Create the file the
first time you need it. The user hands that file to the engine's agent, who
makes the changes in Eagle Bot. When the user tells you they've shipped, you
re-test.

## What belongs in it

Anything that would make a Tac-On possible, safer, or easier to build and
test:

- **Bugs:** the engine does something different from what
  [reference/TacScript.md](reference/TacScript.md) says.
- **Language features:** a keyword, field type, expression, widget or option
  TacScript lacks.
- **Events and data sources:** a `when` event or a `list from` source that
  doesn't exist yet.
- **Extension interfaces:** a generic hook or shared service an engine extension
  needs. Never a package-specific one.
- **Sandbox and tooling:** something the testing environment can't do, such as
  uploads, a missing persona, or a missing command.
- **Docs:** a reference page that's wrong or missing something you had to
  discover.

Don't use it for workarounds you can do in TacScript today. Do mention a
workaround if you used one, so it can be removed later.

## Format

One entry per request, newest at the bottom, numbered so you can refer to them.
The user and the engine agent edit the **Status** line. You edit everything
else.

```markdown
## ER-003: Inline `add` blocks drop every field after the first

- **Status:** open
- **Kind:** bug
- **Needed by:** tacons/hero-bucks (works around it, see below)
- **Priority:** blocks a Tac-On | workaround exists | nice to have

**What happens.** Smallest `.tacon` snippet that shows it, the exact command
you ran, and the output:

    add entry { hero: event.winner, amount: 10, reason: "Elected" }

    $ node testing/tacon-test.mjs check tacons/hero-bucks/hero-bucks.tacon
    hero-bucks.tacon:40:37 warning: "amount" here isn't part of the value and was ignored.

**What should happen.** All three fields are saved, as in the Tac-Ons.md example.

**Why TacScript can't do it today.** (For features: what you tried and why it
falls short.)

**Smallest generic change.** What you think the engine needs. A suggestion,
not a design: the engine agent decides.

**How to verify.** Exact commands that pass once it ships:

    testing/sandbox up
    node --test tacons/hero-bucks/sandbox.test.mjs
```

## Status values

| Status | Set by | Meaning |
| --- | --- | --- |
| `open` | you | Written, not yet handed over |
| `shipped in <commit>`, plus a note | engine agent | Done in the engine. The note says what changed if it differs from the request |
| `declined: <reason>` | engine agent / user | Won't be done. Design around it |
| `verified` | you | You re-tested and it works |
| `reopened: <what failed>` | you | You re-tested and it doesn't. Add the new output under the entry |

## Re-testing after the user says the engine changed

1. If this repo is separate from Eagle Bot, `git pull` in the engine checkout
   (`EAGLE_BOT_ENGINE`). If this folder is inside the engine repo, it's already
   current.
2. `testing/sandbox up`. This restarts the server on the new engine code and
   applies any schema changes.
3. For every entry marked `shipped`, run its **How to verify** commands.
4. Mark each one `verified` or `reopened: ...`.
5. Remove any workarounds that are no longer needed, bump those Tac-Ons'
   versions, and re-run their scenario tests.
6. Run `check --live` before telling the user a Tac-On is ready to publish.
   The live site only has the change after the user publishes the engine.

Write each entry so the engine agent can act on it without asking you
anything. They'll have the engine code but not your conversation.
