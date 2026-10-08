# Authoring playbook

How to go from "I want a Tac-On that does X" to something an academy can
install.

## 1. Understand the Acton practice first

Most Tac-On requests digitize something studios already do on paper (Hero
Bucks, running partners, quest boards, jobs). Before designing:

- Look the practice up in [`context/`](../context/). If it isn't there, ask the
  user how *their* academy runs it. Practices differ a lot between academies.
- Decide what's **configurable** (a `setting` or a block option) and what's
  fixed. Anything academies disagree about should be configurable.
- Ask what record would settle an argument at Town Hall. That's usually the
  store you need.

## 2. Pick the tier

| If the feature needs... | Use |
| --- | --- |
| Pages, panels, positions, forms, lists, stats, simple reactions, its own tables | **Pure TacScript.** One `.tacon` file. |
| A points economy with enforced balances | The built-in `market` declaration (still pure TacScript). |
| Custom screens, server rules TacScript can't express, file uploads, transactions, public pages, or more than 2,000 rows of history in totals | An **engine extension**. See [03](03-engine-extensions.md). |
| A new generic capability every Tac-On could use (a new event, data source or widget) | An **engine request** in `ENGINE-REQUESTS.md` ([04](04-engine-requests.md)). Don't build it here. |

Default to pure TacScript. Extensions cost a full engine release to ship and
can't be published by learners.

## 3. Write the source

Create `tacons/<slug>/<slug>.tacon`. Slug: lowercase letters, numbers and
hyphens. Start from the outline in
[reference/TacScript.md](reference/TacScript.md) and follow it exactly. Don't
invent keywords. If the reference doesn't show it, it doesn't exist.

A good `.tacon`:

- Opens with a `#` comment saying what it does and any rule a reader needs (for
  example, `# 100 points = 1 Eagle Buck`).
- Sets `name`, `version`, `about` (one sentence for the market tile), `icon` and
  `category`.
- Uses `show to` / `allow` deliberately. Leaving them out means *everyone who
  can open the page*. For forms that write records, that is rarely what you
  want.
- Uses a `position` when a learner should own a job (Shopkeeper, Treasurer),
  instead of granting power to `admin`. Positions are elected or appointed by
  the studio, which fits Acton self-government.
- Keeps `provides` small and stable. Other Tac-Ons will depend on those names.

## 4. Test it

Use the sandbox in [`testing/`](../testing/README.md). It's the real Eagle Bot
server with a seeded academy of test personas.

```sh
testing/sandbox up
node testing/tacon-test.mjs try tacons/my-tacon/my-tacon.tacon --hold treasurer=learner1
```

Read the whole report. For each persona, ask whether they should see that page,
be allowed that form, and see those rows. Check especially:

- **learner3** (the other studio) sees nothing from a studio install.
- Forms and buttons are DENIED for everyone who isn't in `allow`, and a direct
  `submit` as them returns 403. Showing as denied isn't enough.
- **guide** isn't made the keeper of something learners should own.
- `when` blocks do the right thing: `testing/sandbox fire <event> ...`, then
  look again.
- Updating keeps the data: put records in, bump the version, `try` again, and
  check the records are still there and still read correctly.

Then turn what you checked into `tacons/<slug>/sandbox.test.mjs` (copy
`testing/examples/sandbox-smoke.scenario.test.mjs`), so it can be re-run with
`node --test` after any engine change.

The last check is the live compiler: `node testing/tacon-test.mjs check <file>
--live`. If it compiles in the sandbox but not live, the live engine is older.
Tell the user it needs an engine release first. Don't rewrite valid source to
dodge it.

## 5. Write the README

`tacons/<slug>/README.md`, in plain language, for admins and learner devs:

- **Why it exists:** the studio problem it solves, in two or three sentences.
- **How it works:** each page, panel and position, and who does what.
- **Who sees what:** a small table by role/position.
- **Publish and install:** numbered steps. Say studio vs academy-wide and why.
- **Updating:** what changes for existing installs. Always "Update", never
  "remove and reinstall".
- **Checks:** the test commands.

Match the voice of [reference/Tac-Ons.md](reference/Tac-Ons.md): second
person, short paragraphs, bold for UI labels.

## 6. Versioning and changes to a live Tac-On

- Bump `version` on every publish: patch for wording/fixes, minor for new
  features, major when existing installs need care.
- **Never rename or retype a store field that has data.** Add a new field and
  keep reading the old one. Records from 1.0.0 still exist after an academy
  updates to 2.0.0.
- Dropping a `position` archives it on update (history stays). Dropping a store
  orphans its records. Think twice.
- Changing a position's title, duties or seats resets those on every updated
  install. Say so in the README.

## 7. Before you say it's done

- [ ] `try` report checked for every persona. `sandbox.test.mjs` passes on a
      freshly pulled engine.
- [ ] `check --live` passes, or the user knows it needs an engine release.
- [ ] Every form and button has an intentional `allow`.
- [ ] No design relies on a viewer seeing data they couldn't already see.
- [ ] Totals can't plausibly pass 2,000 rows.
- [ ] Existing installs survive the update with their records intact.
- [ ] README written. UI text is readable by a twelve-year-old.
- [ ] Nothing is published or installed automatically. Publishing is the user's
      call.

## Pitfalls seen before

- **Assuming adults run things.** Plans that made Guides the keepers of the
  record got corrected. Give learners the job (a position) where you can.
- **Inferring facts from missing records.** A missing AP check-in doesn't prove
  a missed school day. Show "not recorded", not "absent".
- **Losing history on edit.** Adding a new pair once wiped existing pairs.
  Merges must preserve existing records, and re-pairing must keep history.
- **Over-sharing on public links.** Public verification shows the minimum:
  who, what, when, status. Never notes, evidence or attendance.
- **Docs that don't match the engine.** The one-line form
  `add entry { hero: x, amount: 10 }` shown in Tac-Ons.md drops every field
  after the first. Put each field on its own line. When the sandbox disagrees
  with the reference, believe the sandbox and file an engine request.
- **Live compiler mismatch.** A valid `market` Tac-On failed live because the
  deployed engine predated `market`. The fix was shipping the engine, not
  editing the Tac-On.
