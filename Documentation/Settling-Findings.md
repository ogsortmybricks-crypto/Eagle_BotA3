# Settling what the AI flags

*For admins and secretaries.*

When the AI builds a studio's wiki from its documents, it also lists what it
couldn't sort out on its own: two documents that disagree (**contradictions**),
things the rules never cover (**gaps**), wording that could mean two things
(**unclear**), and things that need a vote. These show up in the amber box at
the top of the **Wiki** page.

The AI doesn't just list them. It writes a fix for each one, and you decide.

---

## What happens after a build

1. The wiki is built and the problems are listed.
2. Straight away, the AI drafts a fix for each problem. The card says *The AI is
   writing this up…* while it works, and the fix appears on its own, usually
   within a minute.
3. Each fix is shown as the actual edits it would make:
   - **Adds**: a new rule, and the section it goes in.
   - **Changes**: the rule's text **now** next to what it would say **after**.
   - **Strikes out**: the rule it would repeal.
   - **New section** or **Moves**: where things would go.

Nothing touches the wiki until someone acts on it.

## Your three choices

**Approve fix.** The edits go into the wiki exactly as shown, and the problem is
marked settled. If the fix changes nothing (usually because the problem needs a
studio vote first), the button reads *Approve and mark settled*.

**Propose something different.** Type how the studio actually wants it settled,
for example *"Quorum is two-thirds, as Town Hall voted on the 12th. Strike the
older rule."* The AI writes exactly that into the wiki. It doesn't soften it or
add its own ideas, and it doesn't wait for a second approval, because the
decision is already yours. If it can't tell what you mean, nothing changes and
the card tells you what it needs to know.

**Settle without changing the wiki.** Records a note (or *Not a problem*) and
leaves every rule as it is.

Problems raised by a Town Hall or an election don't get a fix automatically.
Press **Suggest a fix** on any of them to ask for one.

## Taking it back

**Settled lately**, under the problems box, lists what was settled in the last
two weeks. **Undo** puts the wiki back the way it was before that fix and
reopens the problem with its fix still attached, so you can approve it again or
propose something else.

Undo refuses if one of those rules has been changed again since, for example by
a later Town Hall. Undoing would quietly throw that later decision away. Edit the
rule by hand instead.

## Safety rails

- **Stale fixes aren't applied.** If a rule a fix mentions has been repealed or
  deleted since the fix was drafted, *Approve* is refused and nothing changes.
  The card asks you to request a new fix.
- **Everything is in the history.** Every edit a fix makes is a normal wiki
  revision, credited to the person who approved it, with the reason attached.
  The activity log records each approval, each "settled their own way", and
  each undo.
- **Who can do it.** Anyone who can both settle findings and edit the wiki:
  admins and secretaries by default. Everyone else sees the problems and the
  suggested fixes, but not the buttons.
- **AI switched off?** Fixes need the Claude API key and AI turned on in
  Settings. Without them, *Settle without changing the wiki* still works.

---

## Setting it up

This adds three columns to `ai_findings` (`proposal`, `proposal_state`,
`proposal_error`). After pulling:

```sh
npm run db:push
```
