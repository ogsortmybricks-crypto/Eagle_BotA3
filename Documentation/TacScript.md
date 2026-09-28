# TacScript

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
tacon hero-bucks {          # lowercase letters, numbers and hyphens
  name "Hero Bucks"          # what people see
  version 1.0.0              # bump this every time you publish
  about "One sentence."      # shown in the market
  icon coins
  category tracking          # general | governance | quests | community | tracking | fun

  setting ...                # questions the installing admin answers
  store ...                  # tables of your own
  ask ...                    # numbers worked out from those tables
  page ...                   # pages in the sidebar
  panel ...                  # cards on Eagle Bot's own pages
  position ...               # positions on the Positions page, and their holder's desk
  when ...                   # things that happen by themselves

  provides entry, balance    # what other Tac-Ons may read
  use hero-bucks as bucks    # what you read from them
}
```

Only `name`, `version` and one of `page` / `panel` / `position` / `when` are
required. The compiler will tell you if something is missing.

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
| `person` | Somebody in the academy | A dropdown of names |
| `date` | A day | A date picker |

Add `required` after the type to insist on it.

Every row also gets two fields for free: `created` (when it was saved) and `by`
(who saved it — or the Tac-On's name, if a reaction wrote it). You can use those
as columns like any other.

Records belong to one install. Two studios running your Tac-On keep two separate
sets, and uninstalling deletes them.

---

## `setting` — what the admin fills in

```
setting election_award {
  label "Bucks for winning an election"
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
looking at the page*. Read them back as `my.balance` — including inside text:

```
note "You're holding {my.balance} bucks."
```

A value may be written in terms of another one. List it under `provides` and
other Tac-Ons can read it as `youralias.balance`.

---

## `page` — a page in the sidebar

```
page bucks {
  title "Hero Bucks"
  icon coins
  nav true                        # false hides it from the sidebar
  subtitle "The studio's ledger."
  show to admin, secretary        # leave it out and everybody sees it

  ...widgets...
}
```

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

Listing any of these adds a line to what your Tac-On declares it reads, which
the admin sees before installing. It never grants access: whoever is looking
sees what they were already allowed to see, and nothing else.

**`form`** — how records get in.

```
form "Log some bucks" {
  into entry
  ask hero "Who?"          # the quoted bit renames the field on this form
  ask amount
  ask reason
  allow admin, secretary   # leave it out and anyone who can open the page may add
  submit "Log it"
  then { notify "A new entry was logged." }
}
```

**`button`** — does something when pressed.

```
button "Close the week" {
  allow admin
  confirm "Close the week and file the summary?"
  add summary { note: "Week closed", when: event.summary }
  notify "Week closed."
}
```

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

Panels can attach to `wiki`, `town-hall`, `elections`, `positions`, `people` and
`admin`, and hold the same widgets a page does.

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
  notify "Awarded bucks for a certified election."
}
```

Things that happen:

`townhall.created`, `townhall.processed`, `election.created`,
`election.nomination`, `election.vote.cast`, `election.closed`,
`election.certified`, `wiki.built`, `wiki.rule.created`, `wiki.rule.amended`,
`wiki.rule.repealed`, `position.created`, `position.appointed`,
`position.term_ended`, `document.uploaded`, `invite.accepted`, `auth.login`.

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
| `bucks.balance` | Another Tac-On's, via `use` |

**Totals**

```
sum of entry.amount
count of entry
average of entry.amount
highest of entry.amount
lowest of entry.amount
```

Each takes an optional `where`.

**Tests**, joined with `and`:

```
where entry.kind is "earn"
where entry.hero is not me.id
where entry.amount above 10 and entry.amount below 100
where entry.reason contains "quest"
```

There is no `or`. Two lists usually read better than one clever condition.

**Arithmetic**, left to right:

```
setting.rate times 2
sum of entry.amount minus sum of spend.amount
```

**Text**, with `{...}` for anything above:

```
note "You have {my.balance} bucks, {me.name}."
```

---

## `provides` and `use`

```
# in hero-bucks
provides ledger, balance

# in your Tac-On
use hero-bucks as bucks

note "You have {bucks.balance} bucks."
list bucks.ledger { columns hero, amount }
```

Reading only, same academy only, and only what the other Tac-On listed. If it is
not installed, the list is empty and the number is zero — your Tac-On keeps
working.

---

## Audiences

`show to` and `allow` take any of `everyone`, `admin`, `guide`, `secretary`,
`learner`, `dev`, plus the names of your own `position`s, which mean *whoever
holds it right now*. Leaving the line out means everyone who can open the page.

---

## Rules the compiler will hold you to

- One `tacon` block per file.
- A new `version` every time you publish. Versions already published are frozen.
- Lists, forms and reactions have to name a store that exists.
- `provides` has to name a store or value that exists.
- A Tac-On has to add something: a page, a panel, a position or a `when`.
- A position needs its own name — not a role's, and not another position's.

The editor checks all of this as you type, with the line number. If it says
**Compiles**, it will publish.
