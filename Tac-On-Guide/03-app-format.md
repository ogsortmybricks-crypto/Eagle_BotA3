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
| `setup` | No | Things to do when the Tac-On is installed. See below. |

The Dev menu won't publish anything missing a required field, a `name` that
isn't kebab-case, or a `version` that isn't `x.y.z`.

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
