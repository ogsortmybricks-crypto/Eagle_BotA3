# The app format

> **Snapshot of Eagle Bot's Tac-On app format, October 2026.** The Dev menu's
> checklist is the authority. If it disagrees with this page, trust it and note
> the difference in `ENGINE-REQUESTS.md`.

A Tac-On is a folder. Two files are required, at the top of it:

```
my-tac-on/
  manifest.json          ← required: who it is
  index.html             ← required: the app
  styles/
    base.css             ← optional: any depth is fine
  components/
    table.js
  data/
    defaults.json
```

The Dev menu reads the folder on your device, bundles it into one HTML
fragment, and checks it. Only `.html`, `.htm`, `.css`, `.js`, `.mjs` and `.json`
files are read. Hidden folders, `node_modules` and `dist` are left out. Limits:
200 files, 2 MB per file, and 2 MB for the bundled app.

---

## `manifest.json`

```json
{
  "name": "sign-in-sheet",
  "title": "Sign-In Sheet",
  "version": "1.0.0",
  "description": "Learners sign in each morning and see who's here.",
  "author": "Ada Lovelace",
  "icon": "📋"
}
```

| Field | Required | Rules |
| --- | --- | --- |
| `name` | Yes | The Tac-On's id, forever. Lowercase letters, numbers and single hyphens (`sign-in-sheet`), 3 to 50 characters. The first person to publish a name owns it. |
| `title` | Yes | What people see in the sidebar and the market. Up to 100 characters. |
| `version` | Yes | `MAJOR.MINOR.PATCH`, like `1.0.0`. Raise it for every publish. |
| `description` | Yes | One or two sentences, up to 500 characters. Admins read it before installing. |
| `author` | Yes | Your name or your team's. |
| `icon` | Yes | A single emoji, like `"📋"`. |
| `category` | No | `governance`, `tracking`, `community`, `quests`, `fun` or `general` (the default). |
| `audience` | No | Who can open it. Everyone in the studio, if left out. See below. |
| `stores` | No | Who may read and add to each store, and which need signing. See below. |
| `calendar` | No | Records drawn on the studio calendar. See below. |
| `panels` | No | The app as a card on Eagle Bot's own pages. See below. |
| `reactions` | No | Records saved by themselves when something happens. See below. |
| `setup` | No | Things to do when the Tac-On is installed. See below. |

The Dev menu won't publish anything missing a required field, a `name` that
isn't kebab-case, or a `version` that isn't `x.y.z`.

---

## Audiences: who

Several sections take an **audience**: a list of who it's for.

| Entry | Means |
| --- | --- |
| `"everyone"` | Everyone who can see the studio (the same as leaving it out) |
| `"admin"`, `"guide"`, `"secretary"`, `"learner"` | That role |
| `"dev"` | Learners with dev status |
| `"position:Agenda Keeper"` | Whoever holds a position with that title, right now, in the studio the Tac-On is installed in (or one shared with it, or academy-wide). Matched without regard to capitals. They drop out when their term ends. |

**Admins are always included**, whatever the list says. An app can't lock
the academy that runs it out of its own data.

### `audience`: who can open it

```json
{ "audience": ["learner", "guide", "position:Agenda Keeper"] }
```

Everyone else doesn't see it in their sidebar, and can't open it or reach its
records. Leave it out and everyone in the studio can.

---

## `stores`: who reads and writes what

Records go into named **stores** (see `createRecord` in
[04](04-sdk-reference.md)). By default everyone who can open the app can read
every store and add to it. `stores` narrows that, store by store, and **Eagle
Bot enforces it**, whatever your app's code does:

```json
{
  "stores": {
    "decision": { "write": ["position:Agenda Keeper"], "sign": true },
    "appeal":   { "read": ["position:Appeals Chair", "guide"] }
  }
}
```

| Rule | What it does |
| --- | --- |
| `read` | Only this audience gets these records. Everyone else's `getRecords()` simply leaves them out, and asking for the store by name is refused. |
| `write` | Only this audience can add to the store. |
| `sign` | Every record must be **signed**: the person types their own six-digit confirmation code, in a box Eagle Bot draws (your app never sees the code). A signed record shows who signed it and can't be changed afterwards. |

Stores you don't list are open to everyone using the app. Changing and
deleting are always limited to the person who saved a record, plus admins and
guides.

---

## `calendar`: records on the studio calendar

Draws records on the studio calendar, next to the guides' field trips and
sessions. Clicking an entry opens your app at that record
(`EagleBot.params.record`).

```json
{
  "calendar": [
    { "store": "trip", "on": "day", "until": "back", "title": "Trip: {place}", "kind": "field_trip" },
    { "store": "call", "on": "created", "title": "AP call with {partnerName}", "mine": true }
  ]
}
```

| Field | Required | What it does |
| --- | --- | --- |
| `store` | Yes | Which store's records to draw |
| `on` | Yes | `"created"` (the day it was saved), or a key in the record's `data` holding a day like `"2026-10-23"` |
| `until` | No | A key holding the last day, for an entry spanning several days |
| `title` | Yes | What the entry says. `{key}` is a value from the record's `data`; `{by}` is who saved it. |
| `kind` | No | `event` (the default), `field_trip`, `exhibition`, `launch` or `deadline`: how it's drawn |
| `color` | No | A hex colour like `"#0ea5e9"` |
| `mine` | No | `true`: each person sees only the records they saved |
| `audience` | No | Who sees these entries. By default, whoever may read the store. |

`"created"` puts a record on the day it was saved **in the academy's time
zone** (Settings → Display), so something saved at 9pm is on that day. Up to
10 calendar entries.

---

## `panels`: a card on Eagle Bot's own pages

Your app can also appear as a card at the bottom of one of Eagle Bot's pages:
`wiki`, `town-hall`, `elections`, `positions`, `people`, `admin` or
`calendar`.

```json
{ "panels": [{ "host": "town-hall", "title": "From the Agenda Box" }] }
```

It's the **same app**, run again in the card. `EagleBot.place` tells it where
it is (`"page"` or `"panel:town-hall"`), so it can draw something smaller
there — the agenda list without the form, say. A panel is shown to the app's
`audience` unless you give it its own `audience`. One panel per page.

---

## `reactions`: things that happen by themselves

When something happens in Eagle Bot, a reaction saves a record — even if
nobody has your app open.

```json
{
  "reactions": [
    {
      "on": "election.certified",
      "when": { "event.kind": "position" },
      "store": "service",
      "data": { "who": "{event.winner}", "note": "Elected: {event.summary}" }
    }
  ]
}
```

| Field | What it does |
| --- | --- |
| `on` | The event (list below) |
| `when` | Optional: only when every `event.*` value matches |
| `store` | Where the record goes |
| `data` | The record. In text, `{event.x}` is filled in; a value that is exactly `"{event.x}"` keeps its type (a person's id stays a number). |

The record is saved as the Tac-On: `created_by` is `null` and
`created_by_name` is your Tac-On's name. A studio install only hears its own
studio's events; an academy-wide install hears all of them. A reaction that
fails does so quietly and never breaks the thing that triggered it.

**Events:** `townhall.created`, `townhall.processed`, `election.created`,
`election.nomination`, `election.vote.cast`, `election.closed`,
`election.certified`, `wiki.built`, `wiki.rule.created`, `wiki.rule.amended`,
`wiki.rule.repealed`, `position.created`, `position.appointed`,
`position.term_ended`, `document.uploaded`, `invite.accepted`, `auth.login`,
`calendar.event.created`, `calendar.event.updated`, `calendar.event.removed`.

**What `event` holds:**

| Field | What it is |
| --- | --- |
| `event.actor`, `event.actorName` | Who did it |
| `event.summary` | The sentence in the activity log |
| `event.winner`, `event.winnerName`, `event.votes` | On a certified election: who won, and with how many votes |
| `event.entityId`, `event.studioId` | Which thing, in which studio |
| `event.kind` | On a certified election: its type, `position` or `rule`. On a calendar event: its kind (`session`, `field_trip`...). |
| `event.title` | On a certified election or a calendar event: its title |
| `event.starts`, `event.ends`, `event.quest` | On a calendar event: its first and last day, and a session's Quest |

Up to 20 reactions.

---

## Setup: what happens at install

The `setup` list lets your Tac-On prepare Eagle Bot when an admin installs it,
before anyone opens it.

```json
{
  "setup": [
    { "type": "createPosition", "title": "Agenda Keeper", "description": "Brings the agenda to every Town Hall." },
    { "type": "createWikiPage", "title": "How the Agenda Box works", "content": "Anyone can add a topic..." },
    { "type": "enableFullWindow", "optional": true, "prompt": "Open the Agenda Box full screen?" }
  ]
}
```

| `type` | Fields | What it does |
| --- | --- | --- |
| `createPosition` | `title` (required), `description`, `seats` (1–20, default 1), `elected` (default `true`) | Adds a position in the studio it's installed in, unless one with that title is already there |
| `createWikiPage` | `title`, `content` (both required) | Adds a section to the Contract with the content as its first rule, unless a section with that title is already there |
| `enableFullWindow` | `mode`: `"fullscreen"` (default) or `"inline"` | Opens the Tac-On full screen. See below. |

How setup behaves:

- **It never makes a second copy.** Titles are matched without regard to
  capitals, against the studio's own positions or sections, ones shared with
  it, and academy-wide ones. If it's already there, nothing is made.
- **It runs again on Update**, with the admin's earlier answers. A new action
  in a new version runs then too.
- **Positions it makes belong to the Tac-On.** Turning the Tac-On off or
  removing it archives them (who held them is kept); turning it back on
  restores them.
- **A position from your TacScript version is kept.** If your old Tac-On
  declared a position, a `createPosition` with the same title takes it over,
  holders and all. See [08](08-moving-from-tacscript.md).
- Up to 30 actions, and one `enableFullWindow`.

### Asking first: optional actions

Your Tac-On is installed into someone else's academy, and not every admin wants
a new position or wiki page. Mark an action `"optional": true` and it becomes a
tickbox on the install screen:

```json
{
  "type": "createPosition",
  "title": "Calendar Manager",
  "description": "Keeps the studio calendar current.",
  "optional": true,
  "default": true,
  "prompt": "Create the “Calendar Manager” position?",
  "why": "Lets you give a learner this job without making them a guide.",
  "id": "calendar-manager"
}
```

| Field | Default | What it does |
| --- | --- | --- |
| `optional` | `false` | Ask the admin instead of always doing it |
| `default` | `true` | Whether the tickbox starts ticked |
| `prompt` | "Create the position …" | The question beside the tickbox |
| `why` | — | One line on what they get if they leave it ticked |
| `id` | its place in the list | A stable key, so answers survive you reordering the list |

- Actions **without** `optional` always run. They're what your Tac-On *is*;
  don't make anything it can't work without optional.
- The install screen lists required actions under **What will be created on
  install** and optional ones under **This Tac-On would also like to…**.
- **Setting `prompt` or `why` without `"optional": true` is an error.** The
  admin would never be asked.
- Because admins can say no, check at runtime and offer again from inside your
  app:

```js
const { exists } = await EagleBot.exists.position("Calendar Manager");
if (!exists && EagleBot.user.role === "admin") {
  // Show a one-time "finish setting up" card, and on click:
  await EagleBot.positions.create({ title: "Calendar Manager" });
}
```

### Full screen: `enableFullWindow`

By default a Tac-On opens **inside the page**, in the normal content column
with the sidebar beside it. That suits small tools: a sign-in sheet, a tally,
a form. Its frame grows to fit what you draw, so it never scrolls twice.

A month calendar, a kanban board or a dashboard needs room. With
`enableFullWindow` your Tac-On fills the whole window when opened, under a
slim bar with its icon, title and an **Exit full screen** button. **Escape**
exits too, and a button on the page opens it full screen again.

```json
{ "type": "enableFullWindow", "optional": true, "default": true,
  "prompt": "Open the calendar full screen?", "why": "A month grid is hard to read in a narrow column." }
```

- Make it optional. Taking over someone's window is a preference.
- The display mode is worked out again on every install and update. If a later
  version drops the action, or the admin unticks it, it goes back to inline.
- The Market shows **⛶ Full window** on an install that opens full screen.
- `EagleBot.display` tells your app which mode it's in. Size to your
  container rather than hard-coding a height, so the same HTML reads well both
  ways.

---

## `index.html`

Write a normal HTML file. Eagle Bot keeps what's inside `<head>` and `<body>`
and drops the wrapper tags.

```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="sis">
    <h2>Good morning, <span id="sis-name"></span>!</h2>
    <button id="sis-go">Sign in for today</button>
  </div>
  <script src="app.js"></script>
</body>
</html>
```

### How the folder is bundled

1. `<html>`, `<head>` and `<body>` tags are dropped; what's inside them is
   kept, in order.
2. `<link rel="stylesheet" href="...">` to a file in your folder becomes an
   inline `<style>`.
3. `<script src="...">` to a file in your folder becomes an inline `<script>`.
4. CSS files you didn't link are added first; JS files you didn't link are
   added last, in alphabetical order of their path.

References are matched by full path first, then by the end of the path, so
`href="base.css"` finds `styles/base.css`. Outside addresses
(`https://cdn.example.com/lib.js`) are left as they are — and the sandbox
refuses to load them. Put any library you need in your folder.

`.json` files other than `manifest.json` are **not** put into the app, and
your app can't fetch them. Data you need at runtime goes in a `.js` file that
sets a variable: `window.SIS_DEFAULTS = { ... };`.

### Tips

- **Name your CSS classes after your app** (`.sis-row`), so a later page you
  add doesn't fight your first one.
- **No `document.write()`.** It runs after the page has loaded.
- **Use `type="module"` if you like.** Inline module scripts work; importing
  other files doesn't (bundle them in your folder as plain scripts).
- **Handle errors.** An uncaught error shows a yellow "This app hit an error"
  box above your app, which is useful while testing and alarming for learners.

---

## What the sandbox allows

| Allowed | Not allowed |
| --- | --- |
| Any HTML, CSS and JavaScript of your own | Network requests: `fetch`, `XMLHttpRequest`, WebSockets |
| Inline `<script>` and `<style>`, including modules | Scripts, styles, fonts or images from the internet |
| Images, fonts and audio as `data:` or `blob:` URLs | Cookies, `localStorage`, `sessionStorage`, IndexedDB (they throw) |
| `alert`, `confirm` and `prompt` | Pop-ups and new tabs |
| Forms, read with JavaScript | Navigating away: an app whose frame loads another page is stopped |
| Web Workers from `blob:` URLs | Camera, microphone, location, clipboard |
| `window.EagleBot` | Reading or changing anything on Eagle Bot's own page |

Keep anything you'd have put in `localStorage` in a record instead.

---

## Sharing: `.taconapp` files

A `.taconapp` file is the bundled app as JSON:

```json
{
  "manifest": { "name": "sign-in-sheet", "title": "Sign-In Sheet", "...": "..." },
  "html": "<!-- the bundled HTML -->"
}
```

An admin can **Export** an installed app from its Market page. In the Dev
menu, **Open .taconapp file** publishes one. `.eggstension` files have the same
shape and open the same way.
