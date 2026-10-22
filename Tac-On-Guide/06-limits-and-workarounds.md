# Limits and workarounds

What Tac-On apps can't do yet, checked against Eagle Bot in October 2026.
**Build around these now**, and add the ones that cost you something real to
`ENGINE-REQUESTS.md`.

## Traps: works in your browser, fails in Eagle Bot

The sandbox is stricter than a normal web page. Check for these every time.

| Trap | What happens | Do this instead |
| --- | --- | --- |
| **A library from a CDN**: `<script src="https://cdn...">` | Blocked. Nothing loads, and your code fails where it first uses the library. | Download the library into your folder and link it locally. Mind the 2 MB limit. |
| **`fetch()` or any network call** | Refused. There's no internet in the sandbox. | Use the SDK. Data you ship goes in a `.js` file in your folder. |
| **`localStorage` / `sessionStorage`** | Throws a `SecurityError`. | Keep it in a record. A per-person preference is a record with the person's id in it. |
| **A link that leaves**: `<a href="https://...">`, `location.href = ...`, a form with an `action` | The app is stopped and replaced with an error, because leaving could carry data out. | Show the address as text people can copy. Handle forms in JavaScript with `preventDefault()`. |
| **Images from the internet** | Blocked. | Put small images in as `data:` URLs, or draw them with CSS or SVG. |
| **A `.json` file you `fetch`** | It isn't in the bundle, and `fetch` is blocked anyway. | Turn it into a `.js` file that sets a variable. |
| **Showing what people typed with `innerHTML`** | It renders as HTML: a topic called `<img onerror=...>` runs in everyone's copy of your app. | Use `textContent`, or escape it first (see the worked example). |
| **Hiding a button and calling it security** | The server doesn't know about your button; but it does check every call. | Fine for tidiness, as long as you also handle the refusal when a call fails. |
| **Trusting `data` for "who did this"** | Anyone can save any `data`. | Use `created_by` / `created_by_name`, which Eagle Bot fills in. |
| **A fixed height**: `height: 100vh` inside an inline app | The frame grows to fit, so `100vh` keeps growing with it. | Size to your content inline; use `enableFullWindow` for a full-height layout. |

## Missing features, and how to build around them

### No private records

Everyone who can open your app can read all its records through the SDK, even
ones your app never shows them.

- Don't build anything that needs secrecy: votes that must be secret belong in
  Eagle Bot's own Elections (`elections.create`).
- For "only the Keeper should see this", accept that it's hidden, not secret,
  and say so in the app.

### Changing other people's records

Learners can change and delete only what they saved. Admins and guides can
change anything.

- **Append instead of edit**: the Keeper adds a decision record that points at
  the topic (see the worked example).
- **A status record wins**: the newest `status` record for a thing is its
  current state.

### Nothing happens unless someone opens the app

Apps only run while someone has them open. There are no reactions to events
(an election certified, a Town Hall processed), no schedules and no reminders.

- Show what's due when someone opens it: "3 promises are overdue".
- Let the position holder press a button ("Close the week") that writes a
  summary record.

### One page in the sidebar

An app has one sidebar entry, opened inline or full screen. It can't put a
panel on Eagle Bot's own pages (Town Hall, the wiki), draw entries on the
studio calendar, or give a position holder a desk on the Positions page.

- Build tabs or sections inside the app.
- Tell people where to find it: a `createWikiPage` setup action can explain it
  in the Contract.

### No settings form at install

The only install-time questions are optional setup actions. Academy choices
(a number of calls, a name for a thing) are a `config` record that an admin
changes from inside the app. See "Settings without settings" in
[05](05-designing-great-tac-ons.md).

### Limits on records

- `getRecords()` returns the newest **5,000**. Design so that's plenty: one
  record per week rather than one per click, or a summary record per session.
- One record's `data` is at most **30 KB**.
- No server-side filtering beyond `store`: you filter in JavaScript.

### Reading Eagle Bot

The SDK reads people, positions, the wiki, elections and the calendar. It
can't read Town Hall meetings or the activity log, can't vote, can't nominate,
and can't write to the calendar. Writes it can do (positions, the wiki,
elections) need the person using the app to have that power in Eagle Bot.

### Other Tac-Ons

One app can't read another's records. If two Tac-Ons need to share, they
should be one.

### Every install is separate

Each studio install keeps its own records. To share across studios, install
academy-wide or use a studio group. A Tac-On can't choose this: the admin
decides at install time, so say in `description` which you intend.

## The rule of thumb

If you can get 80% of the value inside these limits, **ship it now** and
request the rest. If a limit makes the idea pointless (it fundamentally needs
reactions, privacy or a panel on Town Hall), write the engine request first
and say what you'd build with it.
