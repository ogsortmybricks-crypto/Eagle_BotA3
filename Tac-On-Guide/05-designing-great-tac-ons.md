# Designing great Tac-Ons

## 1. Start from a real studio problem

Good Tac-Ons digitize something studios already do, usually on paper, a
whiteboard or memory, and that keeps going wrong. Ask:

- **What gets lost?** A promise made at Town Hall, who holds which job, why a
  rule changed, whose turn it is.
- **What causes arguments?** Those are the records worth keeping. A good Tac-On
  produces the fact that settles the argument.
- **Who should own it?** Almost always a learner in a position the studio
  fills, not an adult.
- **Does Journey Tracker already do it?** Goals, points, badges, Quest
  progress, Bucks and peer reviews live there. Don't rebuild them.

Eagle Bot's sweet spot is **self-government**: the Contract, Town Hall,
elections, positions and the studio's shared record. Tac-Ons that extend those
are the most valuable.

### Ideas that fit

- **Agenda box.** Anyone adds a Town Hall topic. An elected keeper records what
  was decided (worked example below).
- **Promise log.** Commitments made at Town Hall, who made them and when
  they're due, with the overdue ones on top.
- **Job check-ins.** Each position's holder logs their duty each week, so the
  studio can see whether its jobs are being done. `positions.list()` tells you
  who holds what.
- **Appeals board.** A learner files an appeal; the elected committee records
  the hearing and decision.
- **Rule spotlight.** `wiki.search()` for the rules that matter this week (the
  ROE before a Launch) and show them big.
- **Election history.** `elections.list()` and `elections.get()` to show who
  has served, term by term.
- **Exhibition sign-up.** A form that collects guests and a list for the
  learner running the event.
- **Quest board.** `calendar.list()` for the running session and its Quest,
  and a form where learners log what they're building for it.
- **Boards.** A month grid, a kanban of studio projects, a goal board with a
  row per learner — the kind of thing that wants `enableFullWindow`.

## 2. Design principles

1. **A learner holds the job.** Anything that keeps a record, approves or runs
   a process belongs to a position the studio elects or appoints. Create it
   with a `createPosition` setup action, and check who holds it with
   `positions.list()`. Admins are a backstop, not the main audience.
2. **The record is shared.** By default every record is readable by everyone
   who uses the app. Lean into it: the studio's shared record is the point.
   When something really is private (an appeal, a Keeper's notes), give its
   store a `read` rule — don't just hide it in your app.
3. **Put the rules in the manifest, not only in your code.** "Only the Keeper
   records decisions" is a `write` rule on the `decision` store; Eagle Bot
   enforces it. Then use `EagleBot.stores` to hide what someone can't do, and
   handle refusals anyway.
4. **Words a twelve-year-old understands.** Titles say what something is
   ("Agenda Box"), instructions say what to do ("Say what you want the studio
   to decide"), empty states say what will appear ("Nothing on the agenda
   yet.").
5. **Explain the rule in the app.** A line at the top saying how it works beats
   a README nobody opens.
6. **One job per Tac-On.** Two small Tac-Ons beat one that does everything.
7. **Design for updates from day one.** Records from version 1.0.0 will still
   exist in version 3.0.0. Choose store names and `data` keys you won't need
   to rename, and read old records defensively (`record.data.kind ?? "idea"`).
8. **Comment your code.** Learner devs read published Tac-Ons (Export gives
   anyone the source) to learn. A comment at the top saying what it's for, and
   one above any trick, helps the next author.
9. **Work in a narrow column.** Unless you ask for full screen, your app sits
   in the page's content column, from a Chromebook to a phone. Size to your
   container.

## 3. Patterns that work

### A position owns the job

Create the seat at install, then let whoever holds it do the job:

```json
{ "type": "createPosition", "title": "Agenda Keeper", "description": "Records what Town Hall decided.", "elected": true }
```

Then give the job its powers in the manifest, so they're real:

```json
{ "stores": { "decision": { "write": ["position:Agenda Keeper"] } } }
```

In the app, `EagleBot.stores.decision.write` is `true` for whoever holds the
seat right now (and admins), so that's all you need to show their tools. To
show *who* holds it:

```js
async function holds(title) {
  const positions = await EagleBot.positions.list();
  const seat = positions.find((p) => p.title.toLowerCase() === title.toLowerCase());
  return !!seat && seat.holders.some((h) => h.id === EagleBot.user.id);
}

const isKeeper = await holds("Agenda Keeper");
document.getElementById("keeper-tools").hidden = !isKeeper;
```

When the Keeper's term ends, the next holder gets the tools: nothing to
change.

### Append, don't overwrite

A learner can change only their own records. So when someone *else* needs to
move something along (the Keeper deciding a topic, a committee ruling on an
appeal), don't edit the original: add a new record that points at it.

```js
await EagleBot.api.createRecord({ topicId: topic.id, result: "passed", note }, { store: "decision" });

// Later: a topic is decided if any decision points at it.
const decided = new Set(decisions.map((d) => d.data.topicId));
const waiting = topics.filter((t) => !decided.has(t.id));
```

The history of who decided what is kept, and nobody can quietly rewrite it.
With a `write` rule on `decision`, nobody but the Keeper can add one either.

### "Mine"

`created_by` is filled in by Eagle Bot, so it can't be faked:

```js
const mine = records.filter((r) => r.created_by === EagleBot.user.id);
```

Use `created_by_name` to show who saved something. If a record is *about*
someone else, store their id in `data` (pick them from `members.list()`).

### "This week" and "this session"

Use the academy's clock, not the laptop's, so everyone agrees what day it is:

```js
// The day a record was saved, in the academy's time zone.
const dayOf = (iso) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: EagleBot.academy.timeZone ?? undefined }).format(new Date(iso));

const thisWeek = records.filter((r) => dayOf(r.created_at) >= EagleBot.clock.weekStart);
const today = records.filter((r) => dayOf(r.created_at) === EagleBot.clock.today);

const session = await EagleBot.calendar.currentSession();
const thisSession = session ? records.filter((r) => dayOf(r.created_at) >= session.starts) : [];
```

(`en-CA` formats a date as `YYYY-MM-DD`, which compares correctly as text.)

### Boards: one row per person

```js
const [people, logs] = await Promise.all([EagleBot.members.list(), EagleBot.api.getRecords({ store: "log" })]);
const learners = people.filter((p) => p.role === "learner");
const steps = (id) => logs.filter((l) => l.created_by === id).reduce((sum, l) => sum + (l.data.steps ?? 0), 0);
render(learners.map((p) => ({ name: p.name, done: steps(p.id) })));
```

Everything an `ask` or a TacScript `value` line used to do is now a line of
JavaScript.

### Settings without settings

An app has no install-time settings form. Keep academy choices as a record the
admin edits from inside the app, in a store only admins may write:

```json
{ "stores": { "config": { "write": ["admin"] } } }
```

```js
const [config] = await EagleBot.api.getRecords({ store: "config" });
const callsNeeded = config?.data.callsNeeded ?? 3;   // a sensible default

// Shown only when EagleBot.stores.config.write is true:
if (config) await EagleBot.api.updateRecord(config.id, { callsNeeded: 4 });
else await EagleBot.api.createRecord({ callsNeeded: 4 }, { store: "config" });
```

Without the `write` rule, any learner could add a newer `config` record of
their own.

### Show what matters, when it matters

Draw what's true right now: a "Nobody holds this seat yet — hold an election"
banner when `holders` is empty, a progress bar towards a goal, a celebration
when it's reached. Conditional display is just `if`.

### One page, sections inside

A Tac-On has one sidebar entry. If it does several things, give it tabs or
sections inside the app ("This week", "History", "For the Keeper"), or ask for
full screen if it needs the room. Keep the tab in the address
(`EagleBot.navigate({ tab: "history" })`, read back from `EagleBot.params.tab`)
so the back button and shared links land on the right one.

### Links to one record

Learners want to point someone at one thing: "Ben confirmed Ava did this."
Open the record named in the address, and offer a link to it:

```js
if (EagleBot.params.record) showRecord(Number(EagleBot.params.record));

shareButton.onclick = async () => {
  const { ok, link } = await EagleBot.copyLink({ record: record.id });
  say(ok ? "Link copied." : "Copy this link: " + link);
};
```

### Signed records

For anything that counts as a promise (an AP call, a ledger entry, a check-in
someone else confirms), mark the store `"sign": true`. Each record then needs
the saver's own six-digit confirmation code, entered in Eagle Bot's box, and
shows `signed.by_name` from then on. A signed record can't be edited, so a
correction is a new record.

### On the calendar

Anything with a date belongs where the studio already looks. Add a `calendar`
entry to the manifest rather than building your own calendar:

```json
{ "calendar": [{ "store": "promise", "on": "due", "title": "Due: {text} ({by})", "kind": "deadline" }] }
```

Clicking it opens your app at `?record=<id>`, so handle `EagleBot.params.record`.

### In the meeting: panels

A `panel` on `town-hall` or `wiki` puts the Tac-On in front of people during
the meeting, or while they read the Contract. It's your app again; check
`EagleBot.place` and draw the small version:

```js
if (EagleBot.place.startsWith("panel:")) {
  drawAgendaOnly();     // no form, no history: just what's waiting
} else {
  drawEverything();
}
```

### React to what the studio does

A `reactions` entry saves a record when something happens, even if nobody has
your app open — every certified position election, every new calendar session:

```json
{
  "reactions": [
    { "on": "election.certified", "when": { "event.kind": "position" },
      "store": "service", "data": { "who": "{event.winner}", "election": "{event.title}" } }
  ]
}
```

Your app then reads `service` like any other store. Reactions only save
records; anything more happens when someone opens the app.

### Finish setting up from inside

If an optional setup action was declined (`exists.position()` says no), show
admins a one-time card offering to do it now.

## 4. Worked example: Agenda Box

A complete Tac-On. Anyone adds a topic for the next Town Hall; the elected
Agenda Keeper records what the studio decided.

**`manifest.json`**

```json
{
  "name": "agenda-box",
  "title": "Agenda Box",
  "version": "1.0.0",
  "description": "Anyone can put a topic on the next Town Hall's agenda. The Agenda Keeper records what the studio decided.",
  "author": "Eagle Bot examples",
  "icon": "📣",
  "category": "governance",
  "stores": {
    "decision": { "write": ["position:Agenda Keeper"] }
  },
  "panels": [
    { "host": "town-hall", "title": "From the Agenda Box" }
  ],
  "setup": [
    {
      "type": "createPosition",
      "title": "Agenda Keeper",
      "description": "Brings the Agenda Box to every Town Hall and records what the studio decided.",
      "elected": true
    },
    {
      "type": "createWikiPage",
      "title": "The Agenda Box",
      "content": "Anyone can add a topic to the Agenda Box before Town Hall. The Agenda Keeper reads every topic at Town Hall and records what the studio decided the same day.",
      "optional": true,
      "default": true,
      "prompt": "Add a short wiki page explaining the Agenda Box?",
      "why": "So everyone can find out how it works from the Contract.",
      "id": "explainer"
    }
  ]
}
```

**`index.html`**

```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="ab">
    <p class="ab-how">Add a topic you want the studio to decide at the next Town Hall. Everyone can see the agenda.</p>

    <form id="ab-add" class="ab-card">
      <label>Topic <input name="title" required maxlength="120"></label>
      <label>Why it matters <textarea name="why" rows="2" maxlength="600"></textarea></label>
      <label>Kind
        <select name="kind">
          <option value="proposal">A proposal</option>
          <option value="problem">A problem</option>
          <option value="idea">An idea</option>
          <option value="celebration">A celebration</option>
        </select>
      </label>
      <button type="submit">Add to the agenda</button>
    </form>

    <p id="ab-message" class="ab-message" role="status"></p>

    <h2>On the agenda</h2>
    <ul id="ab-waiting" class="ab-list"></ul>

    <h2>What Town Hall decided</h2>
    <ul id="ab-decided" class="ab-list"></ul>
  </div>
  <script src="app.js"></script>
</body>
</html>
```

**`style.css`**

```css
.ab { max-width: 720px; }
.ab-how { color: #475569; }
.ab-card { display: grid; gap: 8px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 10px; }
.ab-card label { display: grid; gap: 4px; font-weight: 600; }
.ab-card input, .ab-card textarea, .ab-card select { font-weight: 400; padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 6px; }
.ab button { justify-self: start; padding: 6px 14px; border: 0; border-radius: 6px; background: #1d4ed8; color: #fff; cursor: pointer; }
.ab-message { min-height: 1.2em; color: #15803d; }
.ab-message.ab-error { color: #b91c1c; }
.ab-list { list-style: none; padding: 0; display: grid; gap: 8px; }
.ab-list li { padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 10px; }
.ab-meta { color: #64748b; font-size: 12px; }
.ab-decide { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.ab-decide input { flex: 1; min-width: 160px; padding: 4px 8px; border: 1px solid #cbd5e1; border-radius: 6px; }
```

**`app.js`**

```js
// Agenda Box: topics go in the "topic" store; the Agenda Keeper's decisions go
// in "decision", each pointing at its topic. Only the Keeper (and admins) may
// write to "decision" - the manifest says so and Eagle Bot enforces it. A topic
// is never edited: it's "decided" once a decision points at it, and the
// decision keeps the history.

const $ = (id) => document.getElementById(id);
// On Town Hall's page, the same app runs as a small panel: just the agenda.
const inPanel = EagleBot.place.startsWith("panel:");
// True for whoever holds the Agenda Keeper seat right now, and for admins.
const isKeeper = Boolean(EagleBot.stores.decision && EagleBot.stores.decision.write);

function say(text, isError) {
  $("ab-message").textContent = text;
  $("ab-message").classList.toggle("ab-error", Boolean(isError));
}

function item(html) {
  const li = document.createElement("li");
  li.innerHTML = html;
  return li;
}

// Text from people goes on the page as text, never as HTML.
function escape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

async function load() {
  try {
    const [topics, decisions] = await Promise.all([
      EagleBot.api.getRecords({ store: "topic" }),
      EagleBot.api.getRecords({ store: "decision" }),
    ]);
    const decidedIds = new Set(decisions.map((d) => d.data.topicId));
    const titles = new Map(topics.map((t) => [t.id, t.data.title]));

    const waiting = topics.filter((t) => !decidedIds.has(t.id)).reverse(); // oldest first
    $("ab-waiting").replaceChildren(
      ...(waiting.length
        ? waiting.map((topic) => {
            const li = item(
              `<strong>${escape(topic.data.title)}</strong>` +
                (topic.data.why ? `<div>${escape(topic.data.why)}</div>` : "") +
                `<div class="ab-meta">${escape(topic.data.kind ?? "idea")} · added by ${escape(topic.created_by_name)}</div>`,
            );
            if (isKeeper && !inPanel) li.append(decideForm(topic));
            return li;
          })
        : [item("Nothing on the agenda yet.")]),
    );

    $("ab-decided").replaceChildren(
      ...(decisions.length
        ? decisions.slice(0, 20).map((d) =>
            item(
              `<strong>${escape(titles.get(d.data.topicId) ?? "A topic")}</strong> — ${escape(d.data.result)}` +
                (d.data.note ? `<div>${escape(d.data.note)}</div>` : "") +
                `<div class="ab-meta">recorded by ${escape(d.created_by_name)} on ${new Date(d.created_at).toLocaleDateString()}</div>`,
            ),
          )
        : [item("No decisions recorded yet.")]),
    );
  } catch (error) {
    say("Couldn't load the agenda: " + error.message, true);
  }
}

// Only the Agenda Keeper sees this; the decision is a new record, not an edit.
function decideForm(topic) {
  const box = document.createElement("div");
  box.className = "ab-decide";
  const note = document.createElement("input");
  note.placeholder = "What the studio decided";
  box.append(note);
  for (const result of ["passed", "failed", "tabled", "resolved"]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = result[0].toUpperCase() + result.slice(1);
    button.addEventListener("click", async () => {
      try {
        await EagleBot.api.createRecord({ topicId: topic.id, result, note: note.value.trim() }, { store: "decision" });
        say("Decision recorded.");
        load();
      } catch (error) {
        say("Couldn't record that: " + error.message, true);
      }
    });
    box.append(button);
  }
  return box;
}

if (inPanel) {
  // The panel shows only what's waiting. (style.display, because the CSS's
  // `display: grid` would beat the `hidden` attribute.)
  const hide = (element) => (element.style.display = "none");
  [$("ab-add"), $("ab-decided"), document.querySelector(".ab-how"), document.querySelectorAll(".ab h2")[1]].forEach(hide);
}

$("ab-add").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  if (!String(values.title).trim()) return say("Give the topic a name.", true);
  try {
    await EagleBot.api.createRecord(
      { title: String(values.title).trim(), why: String(values.why).trim(), kind: values.kind },
      { store: "topic" },
    );
    form.reset();
    say("Added to the agenda.");
    load();
  } catch (error) {
    say("Couldn't add it: " + error.message, true);
  }
});

load();
```

Why it's built this way:

- **Learners own it.** Anyone can add a topic, and an elected learner keeps
  the record. The Keeper's seat is created at install, and only whoever holds
  it can record decisions: that's a `write` rule, enforced by Eagle Bot.
- **It's in the meeting.** The Town Hall panel shows the agenda where the
  Secretary is already working.
- **Nobody rewrites history.** Decisions are new records pointing at topics,
  so the record of what the studio decided can't be quietly changed.
- **The rule is in the app and in the Contract.** The first line says how it
  works, and the optional wiki page puts it in the Contract.
- **Text stays text.** Everything people typed goes through `escape()`, so a
  topic called `<b>` shows as `<b>`.

## 5. Before you call it done

- [ ] The Dev menu checklist passes, and the app works when published as a
      Draft (see [07-testing-and-publishing.md](07-testing-and-publishing.md)).
- [ ] Tested as an admin, a learner and the position holder.
- [ ] Every SDK call has a `catch` that tells the person what went wrong.
- [ ] Everything people typed is shown as text (`textContent`, or escaped),
      never pasted in as HTML.
- [ ] It reads well in a narrow column, or it asks for full screen.
- [ ] Every "only X can..." is a `stores` rule or an `audience`, not just a
      hidden button; anything private has a `read` rule.
- [ ] The `description` says what it does and which studios it's for.
- [ ] Anything an academy might disagree about can be changed by an admin.
- [ ] If this is an update: old records still read correctly, and no `data`
      key or store was renamed.
- [ ] Anything the engine stopped you doing is in `ENGINE-REQUESTS.md`.
