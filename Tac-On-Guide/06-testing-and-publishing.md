# Testing and publishing

There's no separate test environment. You test in the real app, safely, by
publishing as a **Draft**, which only your own academy can see.

How much of this you do yourself depends on the access the user gives you.
Without an Eagle Bot account, hand the user the complete package folder and the steps
below, and ask them to paste back exactly what the compiler and pages show.

## 1. Compile

**Dev menu → New Tac-On** (or open your existing one). Paste the source. The
right-hand panel compiles as you type and lists every problem with its line
number.

For packages with code, use **Upload folder** in the learner Dev menu or the
developer portal, then edit the imported `.tacon` and local code files there.
The server compiler validates the complete package at publication; a native
source preview alone does not verify code imports. See
[the complete package example](08-programs-and-engine-contracts.md).

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

For an `engine 1` package, review the four access audiences, approve only needed
capabilities and choose optional setup deliberately. Check both opt-in and
opt-out, retry setup without duplicate positions, and inspect any failed result.

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
  Hall, then check the reaction's record appeared. For a `calendar.*`
  reaction, ask a guide or admin to add, change and remove a test entry.
- **Check every `calendar` block.** Save a record with a date this month and
  open **Calendar**: it should be on the right day, in the right colour, with
  the title you meant. Try one with an end date and one without, check the
  `where` leaves out what it should, sign in as someone outside `show to` to
  make sure they don't see it, and click it to check `open` goes to your page.
- **Check the clock in the evening.** If you use `created`, `today` or
  `this_week_start`, make sure the academy's time zone is set
  (**Settings → Display → Time zone**) and save a record after dinner: it
  should count as today and show on today's calendar square.
- **Check what each person may remove and open.** As someone else, try
  removing a row only its owner should (`allow remove own`), and open a
  `link` from someone else's list. Both should be refused.
- **Sign something.** For `confirm with code`, try a wrong code (refused,
  nothing saved), then the right one. A person who hasn't set a code yet is
  told where to set it.
- **Watch `show if` change.** Make the test true and false and check the widget
  appears and disappears, and that a `celebrate` plays its confetti once.
- **Try the update path.** With records saved, bump the version, publish,
  press **Update** on the install, and check the old records still display
  correctly.
- **Test the new contract.** Try view/configure/read/write as separate roles,
  including a configurer denied private UI access. Revoke a capability and check
  future calls fail. Test discovery, targeted/broadcast events, cursor reads and
  denied academy/studio recipients. Check JS/TS UI at desktop and phone sizes.
  Disable/re-enable with saved records and verify data/settings survive updates.

## 5. Publish for real

Once it works:

1. Set `version 1.0.0`, or the next proper version for an update.
2. Publish as **Unlisted** (anyone with the link) to let one other academy try
   it, then **Public** for everyone.
3. Fill in the listing's tagline and description, written for an admin
   deciding whether to install it.

**Official Tac-Ons**, from Eagle Bot's maintainers, are published from the dev
portal (Ctrl+D): **Tac-Ons → Publish official → Choose folder**. Select a folder
with exactly one `.tacon` file and its local program files. Supported
JS/TS/JSX/TSX/CSS files are published with the immutable version; READMEs,
dependency directories and build output are not program source. The learner
Dev menu also supports folder upload/editing for non-official packages.

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
