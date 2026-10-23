# Moving from TacScript

TacScript (`.tacon` files) has been retired. The Dev menu and the dev portal
now publish only apps. What that means for a Tac-On you already wrote:

- **Installs keep running.** Every academy running a TacScript version keeps
  it — its pages, panels, calendar entries, reactions and records — until its
  admin updates.
- **You publish its next version as an app**, with the same `name`.
- **When an academy presses Update, nothing is lost.** The install stays the
  same install, so every record it ever saved is still there, and your app
  reads them through `EagleBot.api.getRecords()`.

## How to move one

1. **Use the same name.** `"name"` in `manifest.json` must be your Tac-On's
   slug exactly (`tacon agenda-box` → `"name": "agenda-box"`). Anything else
   is a different Tac-On with none of the records.
2. **Use a higher version.** If 1.4.0 was the last TacScript version, the app
   might be `2.0.0`.
3. **Keep your positions.** For every `position` block, add a `createPosition`
   setup action with the **same title**. On update it takes over the old
   position: same seat, same holders, same history. (A different title makes
   a new position, and the old one is archived.)
4. **Read the old stores.** Your old records come back with `store` set to the
   store's name. Read them with `getRecords({ store: "topic" })`, and keep
   writing new ones to the same store, so old and new sit together.
5. **Publish as a Draft and test the update** on a test install that has
   TacScript records in it, before making it public (see
   [07](07-testing-and-publishing.md)).

The Dev menu shows a TacScript Tac-On's last source in its editor, under
**See the TacScript source**, for reference while you rebuild.

## What an old record looks like

A TacScript record

```
store topic {
  field title text required
  field kind choice proposal, problem, idea
  field due date
  field owner person
  field done boolean
}
```

comes back as

```js
{
  id: 412,
  store: "topic",
  data: { title: "Longer lunch", kind: "proposal", due: "2026-11-02", owner: 37, done: false },
  created_at: "2026-10-12T14:03:11.000Z",
  updated_at: "2026-10-12T14:03:11.000Z",
  created_by: 37,               // was `byId`
  created_by_name: "Ava"        // was `by`
}
```

| TacScript | In `data` |
| --- | --- |
| `text`, `longtext`, `choice` | Text |
| `number` | A number |
| `boolean` | `true` / `false` |
| `date` | `"YYYY-MM-DD"` |
| `person` | The person's id. Turn it into a name with `members.list()`. |
| `choice from` | The picked row's `id`. Find it in that store's records. |
| `created`, `by`, `byId`, `id` | `created_at`, `created_by_name`, `created_by`, `id` on the record itself |

A record a TacScript reaction (`when`) wrote has `created_by: null` and the
Tac-On's name as `created_by_name`.

## What each TacScript feature becomes

| TacScript | In an app |
| --- | --- |
| `store` | A store name in `getRecords({ store })` / `createRecord(data, { store })` |
| `form`, `ask`, `submit` | An HTML form that calls `createRecord` |
| `set who me.id` | Not needed: `created_by` is filled in for you |
| `list`, `columns`, `where`, `sort`, `group by`, `total` | JavaScript over `getRecords()` |
| `ask`, `sum of`, `count of`, `max of`, `if` | JavaScript |
| `stat`, `progress`, `celebrate`, `note`, `heading`, `show if` | Your own HTML and CSS |
| `page` (several), tabs | Sections or tabs inside the app, or `enableFullWindow` for room |
| `position` and its desk | A `createPosition` setup action, and tools you show to whoever `positions.list()` says holds it |
| `page ... { show to ... }` | The manifest's `audience` |
| `allow` on a form | A `write` rule on that store in the manifest's `stores` (enforced by Eagle Bot) |
| `show to` on a private list | A `read` rule on that store |
| `allow remove own` | Built in: people can delete their own records |
| `confirm with code` | `"sign": true` on the store, or `createRecord(data, { sign: true })` |
| `show to position "Town Hall Leader"` | `"position:Town Hall Leader"` in any audience |
| `setting` | A `config` record in a store only admins may write |
| `name of` | `members.list()` |
| `today`, `this_week_start`, `weekday` | `EagleBot.clock` (the academy's own day) |
| `session_start` | `EagleBot.calendar.currentSession()` |
| `list from wiki.rules`, `positions`, `elections`, `people`, `calendar` | `wiki.list()`, `positions.list()`, `elections.list()`, `members.list()`, `calendar.list()` |
| `link`, `open record` | `EagleBot.params.record` to open one record, and `linkTo` / `copyLink` to share it |
| `panel on town-hall` | `"panels": [{ "host": "town-hall" }]`, and `EagleBot.place` to draw the small version |
| `calendar` blocks | The manifest's `calendar` section (`{field}` placeholders, `mine` for "each person's own") |
| `when` reactions with `add` | The manifest's `reactions` |
| `notify` | Not available: the activity log is Eagle Bot's own. Save a record and show it. |
| Position desks | Keeper-only tools inside the app, gated by a `write` rule |
| `provides`, `use` | Not available. One app can't read another's records. |

If losing a feature makes your Tac-On pointless, keep the TacScript version
installed, and write an engine request saying what you'd build with it.
