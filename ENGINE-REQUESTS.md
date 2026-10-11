# Engine requests

Requests for Eagle Bot's maintainers, from Tac-On authors. Newest at the bottom.
Each entry was checked against the engine source on `origin/main` at
`5e4baff` (`shared/tacons/*.ts`, `server/tacons/runtime.ts`,
`server/routes/tacons.ts`, `server/routes/calendar.ts`), October 2026.

## ER-001: Document `id` and `byId` on every record, and keep them stable

- **Status:** open
- **Kind:** docs
- **Priority:** blocks a Tac-On (ap-calls depends on both today)
- **Needed by:** ap-calls, and any Tac-On with "my records" or "this week"

**The problem.** Every store row already has `id` and `byId`
(`runtime.ts`, `rowFrom`), and both work in `where`, in totals and in
`calendar` blocks. They aren't in the TacScript reference, so authors don't
know about them, and a future engine could drop them without warning. `byId` is
the only trustworthy way to say "rows this person saved", because `by` is a
display name and isn't unique. The reference's own workaround is a `person`
field the user picks, which they can set to anyone.

**What I tried.**

    ask my_steps sum of core_log.steps where core_log.byId is me.id
    ask week_floor highest of week_start.id
    list ap_call { where ap_call.id above my.week_floor }
    calendar ap_call { on created  where ap_call.byId is me.id }

These compile and evaluate correctly. `columns byId` is refused ("There's no
"byId" to show here").

**What would fix it.** Add `id` and `byId` to the reference next to `created`
and `by`, promise to keep them, and say that `id` only ever goes up. Optionally
allow `id` as a column.

**What it unlocks.** Trustworthy personal records (goals, check-ins, appeals)
without a "who are you?" field. It also gives "since X happened" filters
without date logic.

**How to verify.** The reference lists `id` and `byId`. The snippets above
compile and filter to the viewer's own rows.

## ER-002: `{my.value}` is always blank inside `notify` and `calendar` blocks

- **Status:** open
- **Kind:** bug
- **Priority:** workaround exists
- **Needed by:** ap-calls (any Tac-On that writes useful activity-log lines or filters its calendar by a computed value)

**The problem.** Two places evaluate expressions without resolving the `ask`
values first:

- **`notify`**, in `runActions`. A button or form `then` starts with an empty
  `runtime.computed`, and an `add` that runs earlier clears it.
- **`calendar` blocks**, in `calendarFeed`. `server/routes/calendar.ts` builds
  a fresh runtime and calls `calendarFeed`, which never calls
  `resolveComputes`.

So `{my.week}` prints as nothing, and `where row.partner is my.my_ap` matches
nothing.

**What I tried.**

    button "Start a new week" {
      add week_start { week: my.week plus 1 }
      notify "Week {my.week} started."      # log reads "Week  started."
    }
    calendar ap_call {
      on created
      where ap_call.byId is my.my_ap         # always empty
    }

ap-calls uses `me.id` in its calendar blocks and leaves `my.*` out of notify
text.

**What would fix it.** Call `resolveComputes(runtime)` before evaluating a
`notify`, and at the start of `calendarFeed`.

**What it unlocks.** Activity-log lines with real numbers in them. Calendars
that show "my partner's deadlines" or "my team's events".

**How to verify.** Press the button above: the log reads "Week N started". The
calendar block shows the partner's calls.

## ER-003: `plus` / `minus` / `times` / `divided` group right-to-left, not left-to-right

- **Status:** open
- **Kind:** bug (or docs)
- **Priority:** workaround exists
- **Needed by:** anyone doing arithmetic

**The problem.** The reference says arithmetic reads "left to right". In
`expr.ts` (`parseExprFrom`), the right-hand side is parsed by calling the
function again, so `a minus b plus c` becomes `a minus (b plus c)`.

**What I tried.**

    ask a 10 minus 3 plus 2          # gives 5, the docs suggest 9
    ask b 12 divided by 2 times 3    # gives 2, the docs suggest 18

**What would fix it.** Parse one operand at a time inside the loop, so it
really reads left to right. Any Tac-On that depends on the current behaviour
would need a check first. Otherwise, fix the reference to say how it really
groups.

**What it unlocks.** Totals like `goal minus done plus bonus` that mean what
they say.

**How to verify.** The two asks above give 9 and 18.

## ER-004: Allow `{...}` in page titles, list titles and stat labels, and show names for person ids

- **Status:** open
- **Kind:** display
- **Priority:** nice to have
- **Needed by:** ap-calls (the spec wants the partner tab named after your AP)

**The problem.** Notes, headings, stat *values* and calendar titles accept
`{...}`. Page titles, list titles and stat labels are plain text, so a page
can't say "Ben" or "Week 7" in its title. A `person` id in text also shows as
a number, so `{ap_call.partner}` in a calendar title shows "42", not a name.

**What would fix it.** Evaluate those strings as templates for each viewer,
and add `{name of <person>}`.

**What it unlocks.** A tab titled with your partner's name, list titles like
"Posted for Week 7", and calendar entries like "You called Ben".

**How to verify.** `page x { title "{name of my.my_ap}" }` shows the name in the
sidebar.

## ER-005: Let a Tac-On use the studio's existing positions as an audience

- **Status:** open
- **Kind:** language feature
- **Priority:** workaround exists
- **Needed by:** ap-calls (appeals go to the MS Town Hall Leader)

**The problem.** `show to` and `allow` accept roles and the Tac-On's own
positions. A studio that already elects a Town Hall Leader has to appoint the
same person again to a second, Tac-On-made seat.

**What would fix it.** For example `show to position "Town Hall Leader"`,
matched by title within the install's studio and shown to the admin at
install time.

**What it unlocks.** Tac-Ons that give an existing elected job new tools
without duplicating the seat.

**How to verify.** The current Town Hall Leader sees the page without any extra
appointment, and loses it when their term ends.

## ER-006: Grouped lists (folders)

- **Status:** open
- **Kind:** widget
- **Priority:** nice to have
- **Needed by:** ap-calls (the CFS should look like a file explorer)

**The problem.** A `calendar` block now lets people browse dated records by
day, week, month and year, which ap-calls uses. Inside a page, a list is still
one flat table, and folders need one hand-written list per folder. Records
also can't be grouped by anything except a date ("by pair", "by block").

**What would fix it.** `group by <field>` on a list (nested groups optional),
shown as collapsible folders, with `created` groupable by year, month, week or
day.

**What it unlocks.** Record browsers (CFS, ledgers, meeting archives) in
dozens of Tac-Ons.

**How to verify.** `list ap_call { group by created.week, day }` shows
collapsible week folders with day folders inside.

## ER-007: Dates you can compare: `today`, `this week`, `created` comparisons

- **Status:** open
- **Kind:** language feature
- **Priority:** workaround exists (week markers plus `id above`, see ER-001)
- **Needed by:** ap-calls, and any weekly or per-session Tac-On

**The problem.** Dates still compare as 0. The calendar can *draw* records on
dates, and `calendar.sessions` gives a `status`, but a Tac-On can't ask "was
this saved this week?" or "this session?". ap-calls gets "this week" by
having a guide press *Start a new week* and filtering `id above` the newest
marker. That works, but it depends on someone pressing the button and on `id`.

**What would fix it.** `today`, `this_week_start` and `session_start` (from
the running session on the calendar), with dates comparable using `above` and
`below`. A `weekday` value would also let a form record the day itself instead
of asking.

**What it unlocks.** "This week" and "this session" with no button, and
check-ins that can't be backdated.

**How to verify.** `where ap_call.created above this_week_start` filters
correctly.

## ER-008: Show widgets conditionally, plus a celebration widget

- **Status:** open
- **Kind:** widget
- **Priority:** nice to have
- **Needed by:** ap-calls (the spec asks for confetti when Fun Friday is earned)

**The problem.** Every widget always shows. A page can't say "Congratulations"
only when it's true. ap-calls shows the numbers and explains what "2 of 2"
means instead.

**What would fix it.** `show if <condition>` on any widget, and a
`celebrate "message"` widget that plays confetti once per viewer.

**What it unlocks.** Milestone messages, warnings that only show when
something's wrong, and empty states that depend on a value.

**How to verify.** `celebrate "You've both earned Fun Friday!" { show if my.ff_pair above 1 }`
appears only at 2 of 2.

## ER-009: `allow remove own`: let people remove only rows they saved

- **Status:** open
- **Kind:** language feature (and a safety note)
- **Priority:** workaround exists
- **Needed by:** ap-calls, and any Tac-On where learners fix their own typos

**The problem.** The remove route (`server/routes/tacons.ts`, DELETE
`/view/:installId/records/:recordId`) only checks that *some* list on that
store lets this role remove. It doesn't check which rows that list shows. So a
list like this lets any learner delete **anyone's** goal by sending the row id
directly:

    list core_goal { where core_goal.byId is me.id  allow remove learner }

Because a removed row also disappears from the calendar, it can erase someone
else's calendar entries. ap-calls doesn't let learners remove anything because
of this.

**What would fix it.** `allow remove own` (where `byId` is the viewer), and
check the list's `where` against the row on removal. At least, add a warning
to the reference.

**What it unlocks.** Learners can safely fix their own mistakes.

**How to verify.** With `allow remove own`, deleting another person's row id
returns 403.

## ER-010: Forms with a confirm step, and an optional "confirm with your code"

- **Status:** open
- **Kind:** language feature
- **Priority:** nice to have
- **Needed by:** ap-calls (the spec wants a six-digit code to sign each AP Call)

**The problem.** Buttons have `confirm`. Forms don't, so the most important
moment, signing a record, has no "are you sure?".

**What would fix it.** `confirm "..."` on forms, and `confirm with code` to
check the viewer's own account confirmation code before saving.

**What it unlocks.** Signed records: AP Calls, ledger entries and votes.

**How to verify.** A form with `confirm with code` refuses to save without the
right code.

## ER-011: A shareable link to one record

- **Status:** open
- **Kind:** display
- **Priority:** nice to have
- **Needed by:** ap-calls (a verification link for each confirmed piece of work)

**The problem.** There's no way to point someone at a single record. A
calendar entry's `open` goes to a whole page, not to the record. Learners want
to paste "Ben confirmed Ava did this with Excellence" into Journey Tracker.

**What would fix it.** A `link` column on a list, and an `open record` choice
on `calendar` blocks. Either opens a read-only page for that one row, showing
the columns the author chose. Its audience follows the page's `show to`, and
an author can opt in to "anyone with the link".

**What it unlocks.** Verification and receipts, and links between Eagle Bot
and Journey Tracker.

**How to verify.** Clicking the link or calendar entry shows only that row.

## ER-012: Choices filled from a store

- **Status:** open
- **Kind:** language feature
- **Priority:** nice to have
- **Needed by:** ap-calls (pick which posted assignment you finished)

**The problem.** `choice` options are fixed in the source. Learners mark work
by block and day and type the name, so their marks can't be matched exactly to
the posted assignments.

**What would fix it.** `field assignment choice from assignment.title where ...`,
shown as a dropdown of matching rows, with the row's id stored.

**What it unlocks.** Exact "done or not" per assignment, and any
pick-from-a-list form.

**How to verify.** The dropdown shows this week's posted titles only.

## ER-013: `if`, `min` and `max` in expressions

- **Status:** open
- **Kind:** language feature
- **Priority:** workaround exists
- **Needed by:** ap-calls

**The problem.** There's no way to cap a number. "Days with a call" needs
"1 if any call on Monday, else 0". ap-calls uses
`highest of ap_call.id where … divided by highest of ap_call.id where …`, which
works only because the engine reads 0 ÷ 0 as 0. "Calls still needed" would go
negative, so ap-calls shows "2 of 3" instead.

**What would fix it.** `min`, `max` and `any of <store> where …` (1 or 0).

**What it unlocks.** Readable "how many left" numbers, and yes/no counts.

**How to verify.** `ask left max of 0 and setting.calls_needed minus my.days`
never shows a negative number.

## ER-014: A `required` checkbox accepts "No"

- **Status:** open
- **Kind:** bug
- **Priority:** nice to have
- **Needed by:** any Tac-On with an "I agree" box

**The problem.** In `addRecord`, a required field fails only if it's null or
empty. An unticked `boolean` is `false`, so it passes. A required "I saw the
proof" box can't be enforced.

**What would fix it.** A `required` boolean must be true.

**What it unlocks.** Pledges and "I agree" boxes.

**How to verify.** Submitting with the box unticked shows "… is needed."

## ER-015: A progress-bar widget

- **Status:** open
- **Kind:** widget
- **Priority:** nice to have
- **Needed by:** ap-calls (the spec wants a graph of check-ins done and still to go)

**What would fix it.** `progress "Calls this week" my.days_called of setting.calls_needed`,
shown as a bar.

**What it unlocks.** Goals, quotas and countdowns in many Tac-Ons.

**How to verify.** The bar fills to 2/3 when `days_called` is 2.

## ER-016: Calendar entries use the UTC date for `created` and timestamps

- **Status:** open
- **Kind:** bug
- **Priority:** nice to have
- **Needed by:** ap-calls (AP Calls drawn `on created`)

**The problem.** `calendarFeed` turns any value that isn't `YYYY-MM-DD` into a
day with `new Date(text).toISOString().slice(0, 10)`, which is the **UTC**
date. The calendar's own "today" uses `localToday()`, which is server-local.
In US Eastern time, a record saved after 8pm shows on the next day.

**What I tried.**

    calendar ap_call { on created }

A call saved at 21:00 EDT on 2026-10-12 is drawn on 2026-10-13.

**What would fix it.** Convert `created` and other timestamps to a day in the
academy's time zone (or the same local time as `localToday`).

**What it unlocks.** Correct days for anything drawn `on created`: check-ins,
logs and sign-ups.

**How to verify.** A record saved in the evening shows on the day it was
saved.

## ER-017: Docs: a `calendar` block's `where` is one line, not "one test per line"

- **Status:** open
- **Kind:** docs
- **Priority:** nice to have
- **Needed by:** anyone writing a `calendar` block

**The problem.** The reference's `calendar` table says `where` is "One test
per line, like a list". In `compileCalendar`, each `where` line *replaces* the
previous one, so

    calendar outing {
      on day
      where outing.kind is "overnight"
      where outing.place contains "camp"
    }

silently keeps only the last test. (Lists behave the same way.)

**What would fix it.** Change the reference to "one `where` line, tests joined
with `and`". Or make repeated `where` lines combine with `and`, or warn on a
second one.

**What it unlocks.** No silent surprises.

**How to verify.** The snippet either keeps both tests or shows a warning.
