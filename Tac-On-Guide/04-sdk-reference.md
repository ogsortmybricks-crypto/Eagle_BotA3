# The EagleBot SDK

> **Snapshot, October 2026.** If the SDK behaves differently from this page,
> it's right and this page is wrong. Note it in `ENGINE-REQUESTS.md`.

Before your scripts run, Eagle Bot puts one object on the page:
`window.EagleBot`. It is the app's only way into Eagle Bot. It can't be
replaced or changed.

Every method returns a **Promise**. Every call is made **as the person using
the app**: Eagle Bot checks their role and studio, exactly as if they'd done
the same thing in Eagle Bot themselves. When they aren't allowed, the promise
rejects with Eagle Bot's message.

```js
try {
  const record = await EagleBot.api.createRecord({ date: "2026-10-22" });
} catch (error) {
  showMessage("Couldn't save: " + error.message);
}
```

Always catch. A call also fails if it takes longer than 20 seconds, or if the
app makes requests far faster than a person could (a runaway loop).

---

## Who and where

```js
EagleBot.user      // { id, name, email, role } — the person using the app
EagleBot.academy   // { id, name }
EagleBot.studio    // { id, name } — the studio it's installed in, or null if academy-wide
EagleBot.tacon     // { installId, name, version, icon }
EagleBot.display   // "inline" or "fullscreen"
```

`role` is `"admin"`, `"guide"`, `"secretary"` or `"learner"`. Use it to decide
what to *show*:

```js
if (["admin", "guide"].includes(EagleBot.user.role)) {
  document.getElementById("staff-tools").hidden = false;
}
```

Hiding a button is not security. The server checks every call, so a learner
who un-hides it still gets refused. Design for that: show what someone can do,
and handle the refusal anyway.

There is **no `EagleBot.token`**. An app never holds anyone's login.

---

## Records: your own data store

Each install has its own records — one shared list, stored by Eagle Bot.
Records are plain JSON objects you shape yourself.

| Who | Can |
| --- | --- |
| Anyone who can open the app | Read every record, and add records |
| The person who saved a record | Change or delete it |
| Admins and guides | Change or delete any record |

Everyone using the app can read every record, so **don't store anything
private** in them.

### `EagleBot.api.getRecords(options?)`

```js
const records = await EagleBot.api.getRecords();
const goals = await EagleBot.api.getRecords({ store: "goal" });
```

Returns the newest 5,000 records, newest first:

| Field | What it is |
| --- | --- |
| `id` | The record's number. Unique, and it only ever goes up. |
| `store` | Which list it belongs to: `"records"` unless you chose another. Records from a TacScript version keep their store's name (`"goal"`, `"ap_call"`). |
| `data` | Your object |
| `created_at`, `updated_at` | ISO timestamps |
| `created_by` | The id of who saved it (null if a TacScript reaction wrote it) |
| `created_by_name` | Their name — trustworthy, because Eagle Bot fills it in |

### `EagleBot.api.createRecord(data, options?)`

```js
const record = await EagleBot.api.createRecord({ date: "2026-10-22", present: true });
const goal = await EagleBot.api.createRecord({ steps: 5 }, { store: "goal" });
```

`data` must be a plain object under 30 KB. `store` is a word of letters,
numbers, `_` or `-`, starting with a letter. Use stores to keep different
kinds of record apart (goals and check-ins, say). Returns the new record.

### `EagleBot.api.updateRecord(id, data)`

Replaces the record's `data` (send the whole object, not just the changed
part). Returns the record. Refused unless it's the person's own record, or
they're an admin or guide.

### `EagleBot.api.deleteRecord(id)`

Same rule as `updateRecord`.

---

## People

### `EagleBot.members.list()`

Everyone active in the academy:

```js
[{ id, name, email, role, studio_id, positions: ["Treasurer"] }, ...]
```

`email` is `null` unless the academy shows emails in its directory.
`EagleBot.users.list()`, `EagleBot.roster.list()`, `EagleBot.roster.get()` and
`EagleBot.api.getRoster()` are the same call.

---

## Positions

The positions of the studio the person is looking at (with ones shared with it
and academy-wide ones).

```js
const positions = await EagleBot.positions.list();
// [{ id, title, description, seats, elected, studio_id, studio_name,
//    holders: [{ id, name }], holder_id, holder_name }, ...]
```

`holder_id` and `holder_name` are the first holder, or `null`.

Changing positions needs the person to be an **admin**:

| Method | What it does |
| --- | --- |
| `positions.create({ title, description?, seats?, elected?, term? })` | Adds a position in the studio being looked at |
| `positions.update(id, { title?, description?, seats?, elected?, holder_id? })` | Changes it. `holder_id` **appoints** that person (it doesn't end anyone else's term; it's refused when every seat is full). |
| `positions.assign(userId, [positionId, ...])` | Appoints one person to several positions |
| `positions.delete(id)` | Archives it. Its history is kept. |
| `exists.position(title)` | `{ exists, position }`, matching the title without regard to capitals |

---

## The wiki

The Contract is made of **sections**, each holding **rules**. The SDK calls a
section a "page".

```js
const pages = await EagleBot.wiki.list();
// [{ id, title, summary, content, rules: [{ id, title, body }], studio_name }, ...]
const page = await EagleBot.wiki.get(pageId);
const hits = await EagleBot.wiki.search("eagle bucks");   // every word must appear
```

`content` is the section's active rules joined together. Repealed rules are
left out.

Writing needs the person to be allowed to edit the wiki (admins and
secretaries; learners too if the academy allows it):

| Method | What it does |
| --- | --- |
| `wiki.create({ title, content, summary?, rationale? })` | Adds a section with `content` as its first rule |
| `wiki.update(id, { title?, summary?, content?, rationale? })` | Changes the title or summary, or amends the first rule to `content` |
| `exists.wikiPage(title)` | `{ exists, page }` |

Every change is kept in the wiki's history with its `rationale` (one is
written for you if you leave it out). There's no `wiki.delete`: in Eagle Bot,
rules are repealed at Town Hall, not deleted by apps.

---

## Elections

```js
const elections = await EagleBot.elections.list();
// [{ id, title, status, type, ..., position_title, candidate_count, has_voted, can_vote }, ...]

const election = await EagleBot.elections.get(electionId);
// { id, title, status, ..., candidates: [{ id, user_id, display_name, statement, vote_count }],
//   userVotes: [candidateId, ...], can_vote }
```

`vote_count` is `null` until the election closes, unless the academy shows
live tallies.

`elections.create({ title, description?, type?, position_id?, proposal?, seats?, options?, closes_at? })`
needs an admin (or a secretary, if the academy allows it). `type` is
`"position"` (the default) or `"rule"` — a rule election needs `proposal`, the
text being voted on. `seats` (or `votes_per_learner`) is how many people win.
It's created as a **draft**; it opens from the Elections page.

---

## The calendar

```js
const items = await EagleBot.calendar.list({ from: "2026-10-01", to: "2026-10-31" });
```

What's on the studio calendar between two days (`YYYY-MM-DD`, at most 400 days
apart; by default today and the next 60 days). Each item has `title`, `kind`
(`event`, `session`, `break`, `field_trip`, `exhibition`, `launch`,
`deadline`), `occurrenceStart`, `occurrenceEnd`, `startTime`, `endTime`,
`location`, `quest` and `description`. Read-only.

---

## Quick reference

| Call | Who may |
| --- | --- |
| `api.getRecords`, `api.createRecord` | Anyone who can open the app |
| `api.updateRecord`, `api.deleteRecord` | The record's author, admins, guides |
| `members.list` | Everyone |
| `positions.list`, `exists.position` | Everyone |
| `positions.create`, `.update`, `.assign`, `.delete` | Admins |
| `wiki.list`, `.get`, `.search`, `exists.wikiPage` | Everyone |
| `wiki.create`, `wiki.update` | Admins, secretaries, and learners if the academy allows |
| `elections.list`, `.get` | Everyone |
| `elections.create` | Admins, and secretaries if the academy allows |
| `calendar.list` | Everyone |

Everything is limited to the studios the person can see, the same as in
Eagle Bot itself.
