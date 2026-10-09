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
| **Comparing dates**: `where entry.created above "2026-01-01"` | Dates are treated as 0, so the test is meaningless. | Stamp records with a session or week label (see below). |
| **`event.*` outside a `when`** | Empty. Buttons and forms have no event. | Use `me.*`, `setting.*` or literal text. |
| **A typo in a store name inside `ask` or `stat`**: `count of entires` | Not checked. It reads as 0. | Check every total shows a non-zero number once there's data. |

## Missing features, and how to build around them

### Records can't be edited

The only things a Tac-On can do are `add` a record and `notify` (write a line
to the activity log). No action changes or marks an existing record.

- **Append instead of edit.** Store the change as a new record: a `decision`
  store next to the `topic` store, a `status` store whose newest row wins.
- **Clean up by removing.** `allow remove <position>` on a list lets the
  person who owns the record clear finished rows.
- **Show the latest first.** `sort newest` with a small `limit`.

### No `or`

Split the condition: two lists with clear titles ("Open", "Waiting on you"),
or compute two `ask` values and add them:

```
ask open_count count of entry where entry.status is "open"
ask waiting_count count of entry where entry.status is "waiting"
ask still_to_do my.open_count plus my.waiting_count
```

### No dates, weeks or "today"

There's no date arithmetic, no "this week", and dates can't be compared.

- **Session or week label.** Add a `setting` like `current_session`
  (default `"Session 1"`) and a `field session text` on your store. Stamp it in
  forms (ask for it) or in reactions (`session: setting.current_session`).
  Filter with `where entry.session is setting.current_session`.
- **Show `created`** as a column so people can see when something happened.

### Forms can't fill in or lock a value

A form only offers the fields you `ask`. Every asked field can be set to
anything, including a `person` field set to someone else.

- **Use `by` for "who did this".** Every record gets `by`, the submitter's
  **name** (or the Tac-On's name if a reaction wrote it). It can't be faked.
  Filter "mine" with `where entry.by is me.name`.
- **Put a `person` field on a desk form** when only the position holder should
  record things about other people.
- **No ranges or validation.** Only `required` exists. Say the expected range
  in the label ("Points (1–10)").

### Time can't trigger anything

`when` only reacts to the listed events: `townhall.created`,
`townhall.processed`, `election.created`, `election.nomination`,
`election.vote.cast`, `election.closed`, `election.certified`, `wiki.built`,
`wiki.rule.created`, `wiki.rule.amended`, `wiki.rule.repealed`,
`position.created`, `position.appointed`, `position.term_ended`,
`document.uploaded`, `invite.accepted`, `auth.login`. There's nothing like
"every Friday" and no reminders.

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
  `elections`, `meetings`, `people`, `activity`, with only the columns listed in
  the reference. Read-only.
- **Panel hosts:** `wiki`, `town-hall`, `elections`, `positions`, `people`,
  `admin`.
- **Viewer:** `me.id`, `me.name`, `me.role`, `me.studioId`.
- **Positions:** only your own Tac-On's.
- **Other Tac-Ons:** only what they `provides`, read-only, same academy.

### No files, images or links

Fields are text, numbers, yes/no, choices, people and dates. There are no
uploads or pictures. A `text` field can hold a link as plain text, but it isn't
clickable.

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
