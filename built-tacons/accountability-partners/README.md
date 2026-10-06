# Package ownership

All AP implementation lives in this folder: the TacScript compiler extension,
shared contracts and helpers, server rules and routes, React screens, public
verification page, and regression tests. Eagle Bot Main only supplies generic
extension dispatch plus reusable services (accounts, permissions, database
records, studio scope, and the account confirmation-code service).

`extension.json` declares the three trusted build entries. Running
`npm run tacons:generate` discovers checked-in packages and generates the engine
registries in `built-tacons/`. It also runs automatically before development,
type checks and production builds. Adding another checked-in package doesn't
require adding feature-specific imports to the main compiler, app or router.

Uploaded folders still publish declarative TacScript, not executable code.
Uploaded TypeScript/JavaScript is never loaded by the server. Package extensions
must be checked into `built-tacons` and included in a published engine build.

The package accepts older installed manifests and keeps the existing record
names and `/ap/verify/...` URLs. No reinstall or data conversion is required.
Publish the engine update, then use the normal Tac-On update flow for the new
1.2.0 source; do not uninstall an existing AP installation.

# Accountability Partners

## Weekly learning workspace

Admins, including learner admins, plan weekly assignments in Writers' Workshop,
Civilization, Quest, and custom categories. Core goals and existing check-ins stay
available. Open **Learning workspace → Weekly work** to plan or review assignments.

Learners review a current partner's actual work, choose Completed or Excellence,
add an evidence reference and optional notes, and confirm with their own private
six-digit code. Set or change that code on your own Eagle Bot profile. Codes are
account-level, stored only as password hashes, never shown to partners or staff,
and locked for 15 minutes after five incorrect attempts. An admin can reset a
forgotten code; the learner then sets a new code themselves.

Each certification gets a public verification link suitable for pasting into
Journey Tracker. It displays only the assignment, learner, certifying AP,
academy, dates, and completion/excellence status. Private evidence, notes,
attendance and codes are not public. Completed without Excellence never claims
Excellence. Certificates can be revoked by their reviewer or an admin. A
certified assignment's wording cannot be changed without archiving it and
creating a new assignment; links retain the original reviewed wording.

**My AP settings** stores recurring attendance days, dated sick/other absences,
and milestones. **Calendar** combines these with core goals, full check-ins, and
certified work, either for one learner or their current AP group. **History
folders** organizes original records by pair, year and month, including ended
pairings. Learners see their own pair history; guides and admins see all pairs
within this installation's scope.

Pair saves merge new pairs into the active roster. Ending a pair is explicit,
and a stale roster cannot overwrite somebody else's changes. Check-in and
certification history survives re-pairing. Do not uninstall/reinstall to update:
update the existing installation so its records remain attached.

Development applies the account-code table with `npm run db:push`. For Replit's
managed production database, publish the app after this update; publishing
applies the development schema change to production.

An installable Tac-On for the AP system. Source:
[`accountability-partners.tacon`](./accountability-partners.tacon).

## Why it exists

Many studios run the rule that if your AP misses their goal, neither of you
gets the reward — so being a good AP matters. What's been missing is a record:
how often partners actually checked in, and what they were shown. This Tac-On
keeps that record.

## How it works

**Pairing (admins and guides).** The first screen an admin or guide sees has
two columns, **AP 1** and **AP 2**, with a dropdown for each seat, plus an
optional **AP 3** for groups of three. *Pair the rest randomly* fills in
whoever is left. Pairings can change at any time. A changed pairing is ended,
not deleted, so earlier check-ins still show who they were with.

**Who can be an AP.** Learners, secretaries (who are almost always learners)
and learner admins. Guides and other admins can't; there is no switch for it.
An admin becomes a learner admin under **Admin → People**.

**The dashboard (partners).** Each partner gets a **You** tab and one tab
named after each partner.

- *You:* a card per partner showing this week's check-ins as a Mon–Fri strip,
  with the required day underlined, plus one line saying what's left ("2 more
  check-ins needed, including Friday") and a button to check in now. Below the
  cards: your goals for the week, what your partner recorded about you, and your
  record for the last five weeks.
- *[Partner's name]:* their goals for the week, your calendar for them, and the
  check-in form.

**A check-in** covers:

- **Core goals** (Math, Reading): the week's goal (filled in from your
  partner's own goals), progress so far, and an optional percentage.
- **Show the work** (Writers' Workshop, Civilization, Quest): up to 3
  screenshots each, plus notes on how much is done and why some might not be.
- **On track?** On track, a little behind or off track, with notes.

**The rule:** each partner checks in on each counterpart on at least **3
different days a week, one of them Friday**. Daily is encouraged. Checking in
twice in one day updates that day's check-in instead of counting twice. A
check-in can only be recorded for today, which keeps the calendar honest.

**The overview (admins and guides).** The *This week* tab lists every group
with its standing: met, on pace, behind or missed. A group's standing is its
weakest link. Opening a group shows each partner's calendar and the full
check-ins, with screenshots. You can step back through the last five weeks.

## Who sees what

| | Sees |
| --- | --- |
| A partner | Their own group's goals and check-ins, including groups they used to be in |
| Admins and guides | Every group, every check-in, every screenshot in the install |
| Anyone else | A note that they don't have a partner yet |

Screenshots are served one at a time, and only to people who can see the
check-in they belong to. Nobody can set someone else's goals, check in for
someone, or attach another person's upload.

## Publish and install

1. Run the Eagle Bot engine with this checked-in package extension registered.
2. Paste the `.tacon` file into **Dev menu → New Tac-On** (or the dev portal for
   an official listing). Check that it compiles, then publish.
3. Install it from **Tac-Ons → Market**, either in one studio or academy-wide.
   A studio install pairs that studio's learners (or its group's).
4. Open **My AP** in the sidebar and set the pairings.

To change the subjects, the weekly minimum or the required day, edit the
`partners ap { ... }` block and publish a new version.

## Checks

```sh
npx tsx --test built-tacons/accountability-partners/compile.test.ts
```

Database test, against an **isolated** development database only:

```sh
NODE_ENV=development RUN_TACON_PARTNERS_DB_TESTS=true npx tsx --test built-tacons/accountability-partners/server/partners.integration.test.ts
```

It creates a temporary academy and deletes it in `finally`.
