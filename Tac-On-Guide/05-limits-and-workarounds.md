# Limits and workarounds

What the engine can't do yet, checked against the compiler and runtime in
October 2026. **Build around these now**, and add the ones that cost you
something real to `ENGINE-REQUESTS.md`.

## Traps: compiles fine, does the wrong thing

Check for these every time. The compiler won't stop you.

| Trap | What happens | Do this instead |
| --- | --- | --- |
| **`or` in a `where`** | Everything from `or` onward is **silently dropped**. `where a is 1 or b is 2` becomes `where a is 1`. | Two lists, or two `ask`s added with `plus`. |
| **One-line `add` with several fields**: `add entry { hero: x, amount: 10 }` | Only the first field is saved. You get a *warning*, not an error. | One field per line inside the braces. |
| **Filtering a `list from` Eagle Bot source by a made-up name**: `where rule.section contains "ROE"` | Matches nothing. Base-source rows are called `row`. | `where row.section contains "ROE"`, or just `where section contains "ROE"` |
| **A Tac-On published before the October 2026 engine update** | A published version keeps what it was compiled to: `a minus b plus c` still means `a minus (b plus c)`, and of two `where` lines in a list or calendar only the last counts. | Republish (new `version`), then check every total that mixes `minus` or `divided` with another step, and every block with two `where` lines. |
| **A total inside `max of` / `min of`**: `max of count of x where x.a is 1 and x.b is 2 and 5` | The total's `where` swallows the `and`s, so the second value is lost. | Put the total in its own `ask` and write `max of my.total and 5`. |
| **A bare `day` in `group by` after a date level**: `group by created.week, day` | Means "by day of `created`", even if the store has a field called `day`. | To group by the field, write `store.day`. |
| **`event.*` outside a `when`** | Empty. Buttons and forms have no event. | Use `me.*`, `setting.*`, the clock words or literal text. |
| **Filtering `list from calendar` by kind code**: `where row.kind is "field_trip"` | Matches nothing. The `kind` column holds the word people see. | `where row.kind is "Field trip"`. (`event.kind` inside a `when` *is* the code, `field_trip`.) |
| **A time in a `date` field for `at`** | `at` needs a `text` field holding `HH:MM`. Anything else, or an entry spanning several days, shows as all day. | `field leaves text` with a label like "Leaves at (e.g. 09:30)". |
| **A typo in a store name inside `ask` or `stat`**: `count of entires` | Not checked. It reads as 0. | Check every total shows a non-zero number once there's data. |

## Missing features, and how to build around them

### Records can't be edited

The only things a Tac-On can do are `add` a record and `notify` (write a line
to the activity log). No action changes or marks an existing record.

- **Append instead of edit.** Store the change as a new record: a `decision`
  store next to the `topic` store, a `status` store whose newest row wins.
- **Clean up by removing.** `allow remove <position>` on a list lets the
  person who owns the record clear finished rows, and `allow remove own` lets
  each person remove (and re-enter) their own typos.
- **Show the latest first.** `sort newest` with a small `limit`.

### No `or`

Split the condition: two lists with clear titles ("Open", "Waiting on you"),
or compute two `ask` values and add them:

```
ask open_count count of entry where entry.status is "open"
ask waiting_count count of entry where entry.status is "waiting"
ask still_to_do my.open_count plus my.waiting_count
```

### Dates compare, but don't add up

`above`, `below` and `is` work on dates, and `today`, `this_week_start`,
`session_start` and `weekday` read the clock, so "this week", "this session"
and "saved today" need no button and no setting:

```
ask days count of call where call.byId is me.id and call.created above this_week_start
```

What's still missing is date *arithmetic*: no "7 days from now", no "due in 3
days", no number of days between two dates.

- **Due soon.** Show upcoming dates on the calendar with a `calendar` block,
  or list them `sort oldest` with `where entry.due above today`.
- **Named periods.** For periods that aren't a week or a session (a "sprint",
  a "launch"), a setting like `current_sprint` stamped on each record still
  works: `where entry.sprint is setting.current_sprint`.

### Forms can fill in a value, but not check a range

A form `set`s fields it shouldn't ask about (`set who me.id`,
`set day weekday`), and `byId` says who saved a row whatever the form sent.
"Mine" is `where entry.byId is me.id`.

- **No ranges or validation.** Only `required` exists (a required checkbox
  must be ticked). Say the expected range in the label ("Points (1–10)"),
  and cap totals with `max of` / `min of`.
- **No editing a submitted form.** See *Records can't be edited*.

### Time can't trigger anything

`when` only reacts to the listed events: `townhall.created`,
`townhall.processed`, `election.created`, `election.nomination`,
`election.vote.cast`, `election.closed`, `election.certified`, `wiki.built`,
`wiki.rule.created`, `wiki.rule.amended`, `wiki.rule.repealed`,
`position.created`, `position.appointed`, `position.term_ended`,
`document.uploaded`, `invite.accepted`, `auth.login`,
`calendar.event.created`, `calendar.event.updated`, `calendar.event.removed`.
There's nothing like "every Friday" and no reminders: a calendar entry's date
arriving doesn't fire anything.

- Use `townhall.processed` or `townhall.created` as the studio's natural
  rhythm.
- Use a `button` the position holder presses ("Close the week") that adds a
  summary record.

### `notify` only writes to the activity log

It doesn't message anyone. To get someone's attention, put a `note` on their
desk (`{my.waiting} topics are waiting for you`) or a `stat` on a panel where
they work.

### Totals see at most 2,000 rows

`sum`, `count` and filtered lists work over each store's most recent 2,000
records. Fine for a studio. If a design could pass that in a few sessions, give
it a different shape, such as one record per week instead of one per action.

### Fixed things you can read

- **Eagle Bot sources:** `wiki.rules`, `wiki.sections`, `positions`,
  `elections`, `meetings`, `people`, `activity`, `calendar`,
  `calendar.sessions`, with only the columns listed in the reference.
  Read-only.
- **Panel hosts:** `wiki`, `town-hall`, `elections`, `positions`, `people`,
  `admin`, `calendar`.
- **The calendar:** a Tac-On can read it and draw its own records on it, but
  can't add, move or remove the guides' entries, and can't mark sessions or
  breaks. Its entries can't repeat; one record is one entry.
- **Viewer:** `me.id`, `me.name`, `me.role`, `me.studioId`.
- **Positions:** your own Tac-On's can be read (`position.x`); the studio's
  existing positions can be used as an audience
  (`show to position "Town Hall Leader"`) but not read.
- **Other Tac-Ons:** only what they `provides`, read-only, same academy.

### No files or images, and only links to your own records

Fields are text, numbers, yes/no, choices, people and dates. There are no
uploads or pictures. A list's `link` column and a calendar's `open record`
give each record its own page to link to, but a `text` field holding a web
address still isn't clickable.

### Icons don't show

`icon` compiles with any word, but the app currently shows the same puzzle
icon for every Tac-On. Set a sensible icon anyway (`coins`, `users`,
`megaphone`), so it's right once icons are supported.

### Every install is separate

Each studio install keeps its own records. To share one record across
studios, install academy-wide or use a studio group. A Tac-On can't choose
this. The admin decides at install time, so say in `about` which you intend.

## The rule of thumb

If you can get 80% of the value inside these limits, **ship it now** and
request the rest. If the limit makes the idea pointless (it fundamentally needs
editing, uploads or privacy the engine doesn't have), write the engine request
first and say what you'd build with it.
