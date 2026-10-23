# Town Hall approvals and the Contract history

When a Town Hall ends, the Secretary sends the notes to the AI. The AI drafts
the changes to the studio's Contract (the wiki): rules to add, amend, repeal or
move. **Those changes don't go into the wiki straight away.** They wait as a
**run**, and the studio checks them first — like a pull request on GitHub.

## How it works

1. **The Secretary processes the meeting.** In the meeting, press **Process
   with AI**. The meeting shows *Waiting for approvals*, and a card appears
   with the run: the AI's summary and every change, with the rule as it is now
   (red) and as it would be (green).
2. **The studio reviews it.** Anyone in the studio except the Secretary who
   submitted it can open the meeting and either:
   - **It's correct — approve**, or
   - **Request changes**, saying what's wrong ("The vote said 40 minutes, not
     45").

   You can change your mind later; your newest answer counts.
3. **The Secretary pushes it.** Once the run has **at least 3 approvals** and
   **nobody is still asking for changes**, the Secretary presses **Push to the
   wiki**. Only then does the Contract change. The meeting then shows *In the
   wiki*, and the usual "What the AI did" panel appears, including any
   elections it suggests and questions for the Secretary.

If something's wrong, the Secretary fixes the notes and presses **Process
again**. The new run **replaces** the old one, and approvals start over. The
Secretary can also **close** a run without pushing it.

## When a run can't be pushed

The card always says why:

- **It needs N more approvals.**
- **N reviewers are still asking for changes.** They can approve once it's
  fixed, or the Secretary processes again.
- **The Contract changed under this run.** A rule it changes was edited after
  the run was made (by another Town Hall, or by hand). Process the meeting
  again so it's checked against the rules as they are now. Changes affected
  are marked *changed since*.

If another Town Hall was pushed in the meantime but didn't touch the same
rules, the run can still be pushed. The card says so.

## Who can do what

| Person | Can |
| --- | --- |
| Anyone in the studio | See runs, approve them, or request changes — except a run they submitted |
| The Secretary (anyone who can process Town Halls) | Process, push an approved run, close a run |
| The Secretary who submitted a run | Close it |
| People in other studios | Nothing: they don't see this studio's runs |

## The Contract history

The **Town Hall** page shows **Contract history**, a graph of every run for
the studio you're looking at, newest at the top:

- **The main line (green)** is the runs pushed into the wiki, in order.
- **Branches** come off the main line at the run that was newest when they
  were made:
  - **amber, filled**: waiting for approvals
  - **red, hollow**: closed without being pushed
  - **grey, hollow**: replaced by a later run of the same meeting
- Each row shows the meeting, `+added ~amended −repealed`, approvals so far,
  and who submitted it. Click it to open the meeting.

Nothing proposed is ever lost: closed and replaced runs stay in the history.

## Settings

**Settings → Town Hall → Approvals before the wiki changes** (admins). The
default is 3, and it can't be set lower; raise it for a bigger studio. A
run keeps the number that was set when it was made.

Undoing a pushed run works as before: **Undo this run** in "What the AI did".

## For Tac-Ons

The `townhall.processed` event (which Tac-On reactions can listen for) now
fires when a run is **pushed**, because that's when the Contract changes. Its
summary says how many approvals it had.
