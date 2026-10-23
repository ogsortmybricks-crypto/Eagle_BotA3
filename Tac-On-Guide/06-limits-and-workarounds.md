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
| **Hiding a button and calling it security** | Anyone using the app can still call the SDK themselves; a hidden "Record decision" button stops nobody. | Put the rule in the manifest: a `write` (or `read`) rule on the store, or the app's `audience`. Then hide the button for tidiness. |
| **The `hidden` attribute on something your CSS gives `display`** | `display: grid` (or `flex`, `block`) in your CSS beats `hidden`, so it still shows. | Set `element.style.display = "none"`, or add `[hidden] { display: none !important; }` to your CSS. |
| **`new Date()` for "today"** | The person's laptop clock and time zone, which may not be the academy's. Evening records land on the wrong day. | `EagleBot.clock.today` and `EagleBot.academy.timeZone`. |
| **Trusting `data` for "who did this"** | Anyone can save any `data`. | Use `created_by` / `created_by_name`, which Eagle Bot fills in. |
| **A fixed height**: `height: 100vh` inside an inline app | The frame grows to fit, so `100vh` keeps growing with it. | Size to your content inline; use `enableFullWindow` for a full-height layout. |

## Missing features, and how to build around them

### Privacy is per store, and admins see everything

A store with a `read` rule is private to that audience: others never receive
its records. But **admins can always read every store**, so an app can't keep
anything from the academy that runs it, and the person who saved a record
can't hide it from admins either.

- Secret ballots belong in Eagle Bot's own Elections (`elections.create`),
  not in records.
- Say in your app who can see what ("Only the Appeals Chair and admins read
  appeals").

### Changing other people's records

Learners can change and delete only what they saved. Admins and guides can
change anything. Signed records can't be changed by anyone.

- **Append instead of edit**: the Keeper adds a decision record that points at
  the topic (see the worked example).
- **A status record wins**: the newest `status` record for a thing is its
  current state.

### Reactions only save records

A `reaction` saves one record when an event happens, as the Tac-On. It can't
message anyone, change Eagle Bot, or run your code. There are no schedules or
reminders ("every Friday"), and a calendar date arriving doesn't fire
anything.

- Show what's due when someone opens it: "3 promises are overdue".
- Let the position holder press a button ("Close the week") that writes a
  summary record.

### Where an app can appear

Its own page (inline or full screen), one card on each of Eagle Bot's pages
(`panels`), and entries on the studio calendar. It can't give a position
holder a desk on the Positions page, and it can't change Eagle Bot's own
pages beyond its card.

- For "the Keeper's desk", show Keeper-only tools inside your app, gated by a
  `write` rule (`EagleBot.stores.decision.write`).

### No settings form at install

The only install-time questions are optional setup actions. Academy choices
(a number of calls, a name for a thing) are a `config` record in a store only
admins may write. See "Settings without settings" in
[05](05-designing-great-tac-ons.md).

### Limits on records

- `getRecords()` returns the newest **5,000**. Design so that's plenty: one
  record per week rather than one per click, or a summary record per session.
- One record's `data` is at most **30 KB**.
- No server-side filtering beyond `store`: you filter in JavaScript.

### Reading Eagle Bot

The SDK reads people, positions, the wiki, elections and the calendar. It
can't read Town Hall meetings or the activity log, can't vote, can't nominate,
and can't add to the guides' calendar (your own records can appear on it, via
`calendar`). Writes it can do (positions, the wiki, elections) need the person
using the app to have that power in Eagle Bot.

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
reminders, a desk on the Positions page, or a secret ballot), write the engine
request first and say what you'd build with it.
