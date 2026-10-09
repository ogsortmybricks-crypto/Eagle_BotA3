# Testing and publishing

There's no separate test environment. You test in the real app, safely, by
publishing as a **Draft**, which only your own academy can see.

How much of this you do yourself depends on the access the user gives you.
Without an Eagle Bot account, hand the user the `.tacon` file and the steps
below, and ask them to paste back exactly what the compiler and pages show.

## 1. Compile

**Dev menu → New Tac-On** (or open your existing one). Paste the source. The
right-hand panel compiles as you type and lists every problem with its line
number.

- Fix every **error**. It won't publish otherwise.
- Read every **warning**. Several real bugs only show up as warnings, such as
  a one-line `add` dropping fields.
- **Compiles** means it will publish. It doesn't mean it does what you meant.
  See the traps in [05](05-limits-and-workarounds.md).

## 2. Publish a Draft

**Publish** with visibility **Draft**. Only your academy sees it in the
market.

Published versions are frozen, so each new test needs a new `version`. Use
patch numbers while testing (`0.1.0`, `0.1.1`, `0.1.2` ...). Save `1.0.0` for
the first version other academies will see.

## 3. Install it somewhere harmless

As an admin: **Tac-Ons → Market**, open your Tac-On, **Install** into one
studio (not academy-wide), and fill in its settings.

## 4. Use it as each kind of person

Check each of these. Use real accounts with those roles, or ask the user to:

| As | Check |
| --- | --- |
| **Admin** | Installing, settings, everything they're allowed to see and do |
| **Learner** | Pages they should see. Forms that should say *denied* do. Lists show only what they should. |
| **The position holder** | Appoint someone on **Positions**. Their **Your desk** card appears. Desk forms work. |
| **Someone else in another studio** | A studio install doesn't appear for them at all |
| **Guide** | They aren't accidentally made the keeper of something learners should own |

Then:

- **Add real records** through every form. Check every `stat` and `ask` shows
  the number you expect. A typo reads as 0.
- **Trigger every `when`.** Certify a small test election, or hold a Town
  Hall, then check the reaction's record appeared.
- **Try the update path.** With records saved, bump the version, publish,
  press **Update** on the install, and check the old records still display
  correctly.

## 5. Publish for real

Once it works:

1. Set `version 1.0.0`, or the next proper version for an update.
2. Publish as **Unlisted** (anyone with the link) to let one other academy try
   it, then **Public** for everyone.
3. Fill in the listing's tagline and description, written for an admin
   deciding whether to install it.

**Official Tac-Ons**, from Eagle Bot's maintainers, are published from the dev
portal (Ctrl+D): **Tac-Ons → Publish official → Choose folder**. Select a folder
with exactly one `.tacon` file. Only that file is published. READMEs and other
files are ignored.

## Versioning rules

- Bump `version` on every publish. Use patch for wording and fixes, minor for
  new features, major when installs need care.
- **Never rename or change the type of a field that already has records.** Add
  a new field and keep the old one.
- Dropping a store orphans its records. Dropping a `position` archives it on
  update, and its history stays.
- Changing a position's title, duties or seats resets them on every install
  that updates. Say so in the changelog.
- Academies move to a new version only when they press **Update**. Tell them
  what changed and why it's worth it.
- Never tell anyone to remove and reinstall. **Removing deletes every
  record.**

## Keep your source

The live app is the only place a Tac-On exists. Keep every `.tacon` you write,
with a short README (what it does, who sees what, settings, version history),
in your own workspace, so you can publish the next version.
