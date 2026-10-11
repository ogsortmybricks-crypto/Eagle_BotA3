# TacScript reference

> **Snapshot of Eagle Bot's TacScript reference, October 2026.** The live
> Dev menu's compiler is the authority. If it disagrees with this page, trust
> it and note the difference in `ENGINE-REQUESTS.md`. Known quirks are listed
> in [05-limits-and-workarounds.md](05-limits-and-workarounds.md).

*The language Tac-Ons are written in. For learners with dev status.*

TacScript is small on purpose. There are no loops, no variables you assign to,
and no way to run arbitrary code — a Tac-On *describes* what to show and what to
record, and Eagle Bot does the rest. That is what makes it safe for an academy
to install something a stranger wrote, and it means the whole language fits on
this page.

Everything you write looks like one of two shapes:

```
keyword argument argument

keyword argument {
  more lines in here
}
```

That is it. Commas are optional separators, `#` starts a comment, and
indentation is only for your own eyes.

---

## The outline

```
tacon points-ledger {          # lowercase letters, numbers and hyphens
  name "Points Ledger"          # what people see
  version 1.0.0              # bump this every time you publish
  about "One sentence."      # shown in the Tac-On Market
  icon coins
  category tracking          # general | governance | quests | community | tracking | fun

  setting ...                # questions the installing admin answers
  store ...                  # tables of your own
  ask ...                    # numbers worked out from those tables
  page ...                   # pages in the sidebar
  panel ...                  # cards on Eagle Bot's own pages
  calendar ...               # your dated records, on the studio calendar
  position ...               # positions on the Positions page, and their holder's desk
  when ...                   # things that happen by themselves

  provides entry, balance    # what other Tac-Ons may read
  use points-ledger as points    # what you read from them
}
```

Only `name`, `version` and one of `page` / `panel` / `position` / `calendar` /
`when` are required. The compiler will tell you if something is missing.

---

## `store` — your own records

```
store entry {
  label "Ledger entry"
  field hero person required
  field amount number
  field kind choice earn, spend
  field reason text
  field notes longtext
  field paid boolean
  field due date
}
```

Field types:

| Type | What it holds | Shown as |
| --- | --- | --- |
| `text` | A short line | A text box |
| `longtext` | A paragraph | A bigger text box |
| `number` | A number | A number box |
| `boolean` | Yes or no | A checkbox |
| `choice a, b, c` | One of the options you list | A dropdown |
| `choice from store.field` | One row of another of your stores | A dropdown of that store's rows |
| `person` | Somebody in the academy | A dropdown of names |
| `date` | A day | A date picker |

Add `required` after the type to insist on it. A `required` `boolean` has to be
**ticked** — that's how you make an "I agree" or "I saw the proof" box.

### Choices filled from a store

```
store assignment {
  field title text required
  field week number
}

store mark {
  field assignment choice from assignment.title where assignment.week is my.week required
}
```

The dropdown lists the `assignment` rows that pass the `where`, worked out
for the person filling in the form, shown by their `title`. The record saves
the chosen row's `id`, so it matches that assignment exactly. In lists and on a
record's page it shows as the title again. Someone filling in the form can
only save a row the dropdown offered them. The `where` is optional, and the
store can be declared anywhere in the file (but not be the same store).

### Fields every row has

Every row also gets four fields for free. You can use them in `where`, in
totals, in `calendar` blocks and as columns, like any other field. They are
part of the language and won't change.

| Field | What it holds |
| --- | --- |
| `created` | When it was saved |
| `by` | The name of who saved it — or the Tac-On's name, if a reaction wrote it. A display name, not unique. |
| `byId` | The id of who saved it (empty if a reaction wrote it). **This is the trustworthy "who".** Compare it with `me.id`. As a column it shows the person's name. |
| `id` | The row's number. Unique within the Tac-On, and it **only ever goes up**, so a newer row always has a bigger `id`. |

```
ask my_steps sum of core_log.steps where core_log.byId is me.id
ask week_floor highest of week_start.id
list ap_call { where ap_call.id above my.week_floor }
```

`by` and `byId` can't be faked: whatever a form sends, they're filled in from
who actually pressed the button.

Records belong to one install. Two studios running your Tac-On keep two separate
sets, and uninstalling deletes them.

---

## `setting` — what the admin fills in

```
setting election_award {
  label "Points for winning an election"
  type number          # text | number | boolean | choice
  default 10
  hint "Set it to 0 to turn the award off."
}
```

Read it anywhere as `setting.election_award`.

---

## `ask` — a number with a name

```
ask balance sum of entry.amount where entry.hero is me.id
ask running count of quest where quest.status is "running"
```

Named values are worked out per viewer, so `me.*` inside one means *the person
looking at the page*. Read them back as `my.balance` — including inside text,
`notify` lines and `calendar` blocks:

```
note "You're holding {my.balance} points."
```

A value may be written in terms of another one. List it under `provides` and
other Tac-Ons can read it as `youralias.balance`.

---

## `page` — a page in the sidebar

```
page points {
  title "Points Ledger"
  icon coins
  nav true                        # false hides it from the sidebar
  subtitle "The studio's ledger."
  show to admin, secretary        # leave it out and everybody sees it

  ...widgets...
}
```

A page `title` can hold `{...}`, worked out for each person, in the sidebar
too: `title "Calls with {name of my.my_ap}"`.

### Widgets

**`note`** — a sentence. `info` or `warning` puts it in a coloured box.

```
note "Nothing here is official until the Secretary says so." warning
```

**`heading`** and **`divider`** — structure.

**`stat`** — one big number.

```
stat "In circulation" sum of entry.amount

stat "In circulation" {
  value sum of entry.amount
  hint "Across every entry."
}
```

The label can hold `{...}` too: `stat "Week {my.week}" my.days`.

**`progress`** — a bar filling towards a goal.

```
progress "Calls this week" my.days_called of setting.calls_needed

progress "Calls this week" {
  value my.days_called
  goal setting.calls_needed
  hint "Three days with a call earns Fun Friday."
}
```

It shows "2 of 3" and a bar two-thirds full. It turns green when the goal is
reached and never overflows past full. `out of` reads as well as `of`.

**`celebrate`** — confetti and a message. Each person sees the confetti once
(per browser); after that the message just stays on the page. Almost always
used with `show if`:

```
celebrate "You've both earned Fun Friday!" {
  show if my.ff_pair above 1
}
```

**`list`** — a table, of your own records or of Eagle Bot's.

```
list entry {
  title "The ledger"
  columns hero, amount, reason, created
  where entry.kind is "earn"
  sort newest                 # newest | oldest | az
  limit 50
  empty "Nothing logged yet."
  allow remove admin          # who may delete a row; nobody, if you leave it out
}

list from elections {
  title "Open votes"
  columns title, status, votes
  limit 5
}
```

- `title` can hold `{...}`: `title "Posted for week {my.week}"`.
- More than one `where` line means **all** of them: each line narrows the list
  further, as if joined with `and`.
- `columns` can use `id`, `byId`, `by` and `created`, and the special column
  `link` (see below).

**Folders.** `group by` turns a list into collapsible folders, like a file
explorer. Up to three levels:

```
list ap_call {
  columns partner, note, created
  group by created.week, day      # week folders, with day folders inside
  limit 200
}

list topic {
  group by kind                    # one folder per kind
}
```

Group by any field, or cut a `date` field (or `created`) down to `.year`,
`.month`, `.week` or `.day`. A bare `day`, `week`, `month` or `year` right
after a date level means that part of the same date; to group by a field
that happens to be called `day`, write `ap_call.day`. Folders appear in the
list's sort order, newest first by default. `limit` still counts rows, so
raise it for a browser of old records.

**Links to one record.** Put `link` in `columns` and each row gets an
**Open** link to a read-only page for that one record, showing the list's
columns. Paste it anywhere (Journey Tracker, a message) to point someone at
it.

```
list ap_call {
  columns partner, note, created, link
  link anyone                      # optional: anyone in the academy may open it
}
```

Without `link anyone`, the page only opens for someone who can see that list
**and** whom the list would show that row to (its `where` and `show if`).
With `link anyone`, anyone signed in to the academy can open it. It never
opens for someone who isn't signed in. Only lists of your own stores can have
links.

**Removing rows.** `allow remove <who>` lets those people remove any row the
list shows them. `allow remove own` lets anyone who can see the list remove
**only the rows they saved** (`byId` is them). They combine:

```
list goal {
  where goal.byId is me.id
  allow remove admin, own          # admins: any row shown; everyone else: their own
}
```

Removal always checks the row against the list it came from: a row the list
wouldn't show you can't be removed through it, even by typing its id.

Things you can list from Eagle Bot, and the columns each one gives you:

| Source | Columns |
| --- | --- |
| `wiki.rules` | title, body, status, section, studio, updated |
| `wiki.sections` | title, summary, rules, studio, updated |
| `positions` | title, seats, elected, holders, studio |
| `elections` | title, status, type, votes, opens, closes, studio |
| `meetings` | title, date, status, items, secretary, studio |
| `people` | name, role, studio, nga, positions |
| `activity` | action, summary, actor, when, studio |
| `calendar` | title, kind, starts, ends, time, location, quest, description, studio |
| `calendar.sessions` | title, quest, starts, ends, weeks, status, studio |

`calendar` is what's coming up: everything on the studio calendar that is still
on today or starts in the next six months, soonest first. A session that started
last month and is still running counts. `kind` holds the word people see
(`Field trip`, `Session`, `Break`, `Exhibition`, `Launch`, `Deadline`, `Event`),
`time` is `All day` or `09:00–13:00`, and `studio` is whose calendar it's on
(a studio, a group, or `Whole academy`).

`calendar.sessions` is the sessions from a year back to a year ahead, oldest
first. `weeks` is how long each runs, and `status` is `done`, `running` or
`upcoming`. It's the way to show "this session's Quest":

```
list from calendar.sessions {
  title "Our Quest"
  columns quest, ends
  where row.status is "running"
}
```

Both read the calendar of the studio being looked at (with its group's and the
academy's entries), or everything the viewer can see when no studio is picked.
Tac-Ons' own `calendar` entries aren't in either list.

Listing any of these adds a line to what your Tac-On declares it reads, which
the admin sees before installing. It never grants access: whoever is looking
sees what they were already allowed to see, and nothing else.

**`form`** — how records get in.

```
form "Log some points" {
  into entry
  ask hero "Who?"          # the quoted bit renames the field on this form
  ask amount
  ask reason
  allow admin, secretary   # leave it out and anyone who can open the page may add
  submit "Log it"
  then { notify "A new entry was logged." }
}
```

Forms can also:

| Line | What it does |
| --- | --- |
| `set day weekday` | Fills a field in itself, on the server, instead of asking. Any expression: `set who me.id`, `set week my.week`. Whatever the browser sends for that field is ignored. A field can't be both asked and set. |
| `confirm "Sign this AP Call?"` | Asks "are you sure?" before saving. |
| `confirm with code` | The person types **their own six-digit confirmation code** (set under their profile) to save. A wrong code saves nothing; five wrong tries lock it for 15 minutes. Add text after it for an "are you sure?" too: `confirm with code "Sign this?"`. |

```
form "Sign the AP Call" {
  into ap_call
  ask partner "Who did you call?"
  ask agreed "I saw their work"
  set day weekday
  confirm with code
}
```

**`button`** — does something when pressed.

```
button "Close the week" {
  allow admin
  confirm "Close the week and file the summary?"
  add summary {
    note: "Week closed"
  }
  notify "Week closed."
}
```

**`show if`** — on any widget. It's only drawn while the test passes:

```
note "Something's wrong: two people hold the seat." warning {
  show if position.treasurer.holders above 1
}
stat "Waiting on you" my.waiting {
  show if my.waiting above 0
}
```

Several `show if` lines all have to pass. A form or button hidden by `show if`
can't be used, even by someone sending the request by hand.

---

## `panel` — a card on Eagle Bot's own page

```
panel on town-hall {
  title "Quests running"
  show to secretary, admin
  note "{my.running} quests are running."
  list quest { columns title, status  where quest.status is "running" }
}
```

Panels can attach to `wiki`, `town-hall`, `elections`, `positions`, `people`,
`admin` and `calendar`, and hold the same widgets a page does. A
`panel on calendar` sits under the studio calendar, which makes it a good place
for a `list from calendar.sessions` or a count of what's due.

---

## `calendar` — your records on the studio calendar

Every Eagle Bot academy has a studio calendar that guides keep: sessions and
their Quests, breaks, field trips, Exhibitions. A `calendar` block puts your
own records on it too, as entries next to theirs. Each row with a date becomes
one entry.

```
store outing {
  field place text required
  field day date required
  field back date
  field leaves text
  field kind choice local, overnight
}

page outings {
  form "Plan an outing" { ... }
}

calendar outing {
  title "Outing: {outing.place}"
  on outing.day               # required: the date field it starts on
  until outing.back           # optional: the date field it ends on
  at outing.leaves            # optional: a text field holding "HH:MM"
  kind field_trip
  color "#0ea5e9"
  where outing.kind is "overnight"
  show to everyone
  open outings                # clicking the entry opens this page
}
```

| Line | What it does |
| --- | --- |
| `title` | What the entry says. A quoted line with `{...}`, or an expression. Leave it out and the store's first `text` field is used. |
| `on` | **Required.** The `date` field each entry starts on. `created` works too. Writing `on day` and `on outing.day` mean the same. |
| `until` | A `date` field it ends on, so a three-day camp shows across three days. Empty or earlier than `on` means one day. |
| `at` | A `text` field holding a start time like `09:30`. Only used for one-day entries; anything that isn't a time shows as all day. |
| `kind` | How it's drawn: `event` (the default), `field_trip`, `exhibition`, `launch` or `deadline`. Sessions and breaks are left to guides. |
| `color` | A hex code in quotes. Leave it out to use the kind's colour. |
| `where` | Which rows go on the calendar. Several `where` lines all have to pass, as if joined with `and`. Can use `my.*` values. |
| `show to` | Who sees these entries. Everyone, if you leave it out. |
| `open` | One of your own pages, opened when someone clicks the entry. |
| `open record` | Instead of a page: a read-only page for that one record, showing the fields you list (`open record partner, note, created`), or every field if you list none. Opens only for people the entry is shown to. |

`on created` puts each record on the day it was saved **in the academy's time
zone** (an admin sets it under **Settings → Display**), so something saved at
9pm shows on that day, not the next.

To show a person's name in a title, use `name of`: `title "You called {name of ap_call.partner}"`.

You can write more than one `calendar` block, for example the same store shown
two ways to two audiences:

```
calendar outing {
  on day
  kind deadline
  title "Permission slips due: {outing.place}"
  show to guide, admin
}
```

To show another Tac-On's store, `use` it and name it with its alias. After
`use some-tacon as other`, write `calendar other.entry` with `on created` (or
one of its date fields) inside. It has to be in that Tac-On's
`provides`, and its field names aren't checked until the calendar draws.

**How it looks to people.** Your entries show in every calendar view (day,
week, month, year and schedule) with the Tac-On's name on them, and each
person can hide them under **From Tac-Ons** in the calendar's sidebar. They
are read-only on the calendar: nobody can drag, edit or delete them there.
They change when your records change. Clicking one shows its date and the
Tac-On's name, and an **Open** button if you set `open`.

**Who sees what.** The same rules as your pages: an install in one studio
shows its entries on that studio's calendar (and its group's); an academy-wide
install shows them everywhere. `show to` narrows it further. Entries don't go
into the simple view, the calendar's .ics export, or attendance (only a
guide's break stops attendance).

**Checked when you compile.** The store has to exist, `on` and `until` have to
name `date` fields, `kind` has to be one of the five, `open` has to name one of
your pages, and every line has to be one of the ones above.

---

## `position` — a seat on the Positions page

```
position treasurer {
  title "Treasurer"
  about "Keeps the ledger honest and reports at every Town Hall."
  seats 1                  # 1 to 20
  term "One session"
  elected true             # or `appointed`
  duties "Post every entry the same day", "Report the balance at Town Hall"

  # Everything else in the block is the holder's desk.
  note "{my.waiting} requests are waiting on you."
  form "Post to the ledger" {
    into entry
    ask hero
    ask amount
  }
}
```

When an admin installs the Tac-On, this becomes a real position on the
Positions page, in the studio the Tac-On was installed into. The studio elects
or appoints someone to it exactly as it would any other position.

**The desk.** Any widget inside the block — `note`, `stat`, `list`, `form`,
`button` — is shown at the top of the Positions page to whoever holds the
position right now, under *Your desk*, and to nobody else. Not even admins see
it unless they hold the seat. When their term ends, the desk goes to the next
holder.

**The position as an audience.** A position's name works anywhere a role does:

```
page ledger {
  show to treasurer, admin       # only the Treasurer and admins see the page
  ...
  form "Correct an entry" {
    allow treasurer              # only the Treasurer can submit
    ...
  }
  list entry { allow remove treasurer }
}
```

A page shown only to a position appears in the holder's sidebar and nobody
else's. You can name a position before you declare it, as long as it is
declared somewhere in the file. A position can't share its name with a role
(`admin`, `learner` and so on).

**Who holds it.** `position.treasurer` reads the holders' names, or *nobody
yet*:

```
note "The Treasurer is {position.treasurer}."
```

| | |
| --- | --- |
| `position.treasurer` | The holders' names, joined with commas |
| `position.treasurer.holder` | The first holder's id (for a `person` field, or `is me.id`) |
| `position.treasurer.holders` | How many people hold it |

These work inside `when` reactions too. A Tac-On can only read its own
positions this way.

**Updates and removal.** Publishing a new version doesn't change anybody's
position until their admin presses Update. Then the title, duties, seats and
term are reset to what the new version declares. A position you drop from the
source is archived; its history stays. Turning the Tac-On off archives its
positions, turning it on brings them back with the same holders, and removing
it archives them for good.

---

## `when` — reacting on its own

```
when election.certified {
  only if event.winner above 0
  add entry {
    hero: event.winner
    amount: setting.election_award
    kind: "earn"
    reason: "Elected"
  }
  notify "Awarded points for a certified election."
}
```

Things that happen:

`townhall.created`, `townhall.processed`, `election.created`,
`election.nomination`, `election.vote.cast`, `election.closed`,
`election.certified`, `wiki.built`, `wiki.rule.created`, `wiki.rule.amended`,
`wiki.rule.repealed`, `position.created`, `position.appointed`,
`position.term_ended`, `document.uploaded`, `invite.accepted`, `auth.login`,
`calendar.event.created`, `calendar.event.updated`, `calendar.event.removed`.

The three `calendar.*` events fire when a guide or admin adds, changes or
removes something on the studio calendar. Your own `calendar` entries never
fire them.

What a reaction knows about, as `event.*`:

| Field | What it is |
| --- | --- |
| `event.actor` | Who did it (use this in a `person` field) |
| `event.actorName` | Their name |
| `event.summary` | The sentence in the activity log |
| `event.winner` | Who won, on a certified election |
| `event.winnerName` | Their name on the ballot |
| `event.votes` | How many votes they got |
| `event.entityId` | Which thing it happened to |
| `event.studioId` | Which studio it happened in |
| `event.title` | On a calendar event: the entry's title |
| `event.kind` | On a calendar event: `event`, `session`, `break`, `field_trip`, `exhibition`, `launch` or `deadline` |
| `event.starts`, `event.ends` | On a calendar event: its first and last day, as `2026-10-14` |
| `event.quest` | On a calendar event: a session's Quest, or empty |

```
when calendar.event.created {
  only if event.kind is "session"
  add quest_log {
    quest: event.quest
    starts: event.starts
  }
  notify "Logged the Quest for {event.title}."
}
```

Removing one day of a repeating entry gives that day as both `event.starts`
and `event.ends`. Changing one day (or the rest) of a repeating entry fires
`calendar.event.updated` for the new entry it splits off.

`event.actor` and `event.winner` are different people: the first certified the
election, the second won it.

A reaction can `add` to your own stores and `notify` (which writes a line to the
academy's activity log). It cannot do anything else, and if it fails it fails
quietly.

---

## Expressions

**Values you can refer to**

| | |
| --- | --- |
| `me.id`, `me.name`, `me.role` | The person looking |
| `my.balance` | One of your own `ask` values |
| `setting.rate` | What the admin filled in |
| `event.winner` | Inside a `when` only |
| `position.treasurer` | Who holds one of your positions |
| `entry.amount` | A field of the row being tested |
| `entry.id`, `entry.byId` | The row's number, and who saved it (see *Fields every row has*) |
| `points.balance` | Another Tac-On's, via `use` |

**The clock**, worked out in the academy's time zone:

| | |
| --- | --- |
| `today` | Today, as a day like `2026-10-12` |
| `this_week_start` | The Sunday this week started on |
| `session_start` | The first day of the session running today on the studio calendar, or empty between sessions |
| `weekday` | Today's name: `Monday` ... `Sunday` |

A field of the row being tested wins over these, so a store with a field
called `weekday` still reads its own field.

**Totals**

```
sum of entry.amount
count of entry
average of entry.amount
highest of entry.amount
lowest of entry.amount
```

Each takes an optional `where`. One more counts rows but stops at 1:

```
any of call where call.day is "Monday"    # 1 if there's at least one, else 0
```

**Tests**, joined with `and`:

```
where entry.kind is "earn"
where entry.hero is not me.id
where entry.amount above 10 and entry.amount below 100
where entry.reason contains "quest"
```

There is no `or`. Two lists usually read better than one clever condition.
Each side of a test is one value: to compare with `setting.goal minus 1`, work
it out in an `ask` first and test against `my.<name>`.

**Dates compare.** `above` and `below` work on dates — a `date` field, a
`created`, or a clock word. A day means the moment it starts, so:

```
where call.created above this_week_start    # saved this week
where call.created above session_start      # saved this session
where call.created is today                 # saved today
where trip.day below today                  # a date already past
```

`is` between `created` and a day means "saved on that day". There's still no
date *arithmetic*: you can't add days to a date.

**Arithmetic**, strictly left to right, one step at a time:

```
setting.rate times 2
sum of entry.amount minus sum of spend.amount
10 minus 3 plus 2              # (10 minus 3) plus 2 = 9
12 divided by 2 times 3        # (12 divided by 2) times 3 = 18
```

There's no "times before plus" precedence. Dividing by zero gives 0.

**Picking and deciding**:

```
max of 0 and setting.calls_needed minus my.days     # never below 0
min of my.points and 100                            # never above 100
if my.days above 2 then "Fun Friday!" else "Keep going"
```

Everything after `and` in `max of`/`min of` is the second value, arithmetic
included. If the first value is a total with its own `where ... and ...`, put
it in an `ask` first so the `and`s can't get mixed up. An `if` always needs an
`else`.

**Names.** `name of` turns a person id (a `person` field, `byId`, `me.id`,
`position.x.holder`) into the person's name:

```
note "Your AP is {name of my.my_ap}."
```

**Text**, with `{...}` for anything above:

```
note "You have {my.balance} points, {me.name}."
```

---

## `provides` and `use`

```
# in points-ledger
provides ledger, balance

# in your Tac-On
use points-ledger as points

note "You have {points.balance} points."
list points.ledger { columns hero, amount }
```

Reading only, same academy only, and only what the other Tac-On listed. If it is
not installed, the list is empty and the number is zero — your Tac-On keeps
working.

---

## Audiences

`show to` and `allow` take any of `everyone`, `admin`, `guide`, `secretary`,
`learner`, `dev`, plus the names of your own `position`s, which mean *whoever
holds it right now*. Leaving the line out means everyone who can open the page.

**Positions the studio already has.** `position "<title>"` names a seat the
studio already elects, by its title, without making a new one:

```
page appeals {
  show to position "Town Hall Leader", admin
  ...
}
```

Whoever holds a position with that title (in any capitalisation) in the
studio the Tac-On is installed in — or a position shared with it, or an
academy-wide one — is in the audience, and drops out when their term ends.
If the studio has no position by that title, nobody is. The admin sees the
titles before installing. It works anywhere an audience does: `show to`,
`allow`, `allow remove`, a `calendar`'s `show to`.

---

## Rules the compiler will hold you to

- One `tacon` block per file.
- A new `version` every time you publish. Versions already published are frozen.
- Lists, forms and reactions have to name a store that exists.
- `provides` has to name a store or value that exists.
- A Tac-On has to add something: a page, a panel, a position, a calendar or a `when`.
- `choice from` has to name a store and field that exist.
- `group by` on a part of a date only works on a `date` field or `created`.
- `link`, `allow remove own` and `open record` only work on your own stores.
- A position needs its own name — not a role's, and not another position's.

The editor checks all of this as you type, with the line number. If it says
**Compiles**, it will publish.
