# Tac-Ons

*For admins, guides, and any learner who wants to build one.*

A Tac-On is an add-on for Eagle Bot. If you have used a Chrome extension or a
Minecraft data pack, you already have the idea: the base app does what it does,
and a Tac-On adds something on top — a page, a panel, or a rule about what
happens when the studio does something.

Two things make Tac-Ons different from a feature request:

- **Your academy decides what runs.** Nothing is installed until an admin
  installs it, and removing it removes it completely.
- **Learners write them.** An admin gives a learner dev status, and from then on
  they can write a Tac-On, publish it to the market, and watch other academies
  install it. That is the point of the whole system.

---

## For admins

### The market

**Tac-Ons → Market** in the sidebar. Every Tac-On is a tile: name, who wrote it,
what it does in one line, and how many times it has been installed. Click one to
open its details page, which tells you four things before you commit to
anything:

1. **What it adds** — every page, panel and reaction, listed plainly.
2. **What it can read** — the parts of Eagle Bot it looks at. See below.
3. **Who wrote it** — an academy's learner, or the Eagle Bot team (those carry an
   *Official* badge).
4. **The source** — every Tac-On is readable. Press *Read it*.

### Installing

Press **Install**. You will be asked one question that matters:

> **Install for:** a studio, or the whole academy.

A studio install shows up only in that studio — its pages, its sidebar entry,
its records. An academy-wide install shows up everywhere. A Hero Bucks ledger
almost always belongs to one studio; a notice board might belong to all of them.
You can install the same Tac-On separately in two studios, and they keep
completely separate records.

If the Tac-On has settings, you fill them in here. You can change them later.

### What a Tac-On can and cannot see

Every Tac-On declares what it reads, and the install screen shows you the list:

| It says | It means |
| --- | --- |
| Read the wiki and the list of people | It can list rules, sections and names |
| Read the positions and who holds them | It can list positions |
| Read Town Hall meetings | It can list meetings |
| Read elections and their results | It can list elections and vote counts |
| Read the activity log | It can list what has happened in the academy |

**A Tac-On can never show somebody more than they could already see.** The check
runs against whoever is looking at the page, not against the person who
installed it. A learner who cannot read the activity log sees an empty list with
a note saying so, even if the admin who installed the Tac-On sees a full one.
Studio boundaries work the same way: a Middle Studio Tac-On viewed from
Launchpad shows Launchpad's data, or nothing.

A Tac-On has no other reach. It cannot change the wiki, create elections, send
email, edit people, or touch another academy. It can only write to its own
records.

### Running one

An installed Tac-On's pages appear in the sidebar under a **Tac-Ons** heading,
kept separate from Eagle Bot's own pages on purpose. Panels appear at the bottom
of whichever page they attach to, each labelled with the Tac-On it came from.

### Updates

When a dev publishes a new version, nothing changes for you until you say so.
The details page shows *A newer version is published*, and **Update** moves your
install to it. This is deliberate: a Town Hall should never find the page has
changed underneath it mid-meeting.

You can also **Turn off** an install — it disappears from the sidebar and keeps
its records — or **Remove** it.

> **Removing a Tac-On deletes everything it recorded.** A term of Hero Bucks
> entries goes with it. The confirmation says so, and the activity log records
> how many rows were deleted. Turn it off instead if you are not sure.

### Giving a learner dev status

Open their profile in **People** and press **Give dev status**.

Dev status is *not* a role and changes nothing about governance. They still vote
as they voted, read what they read, and cannot touch the Contract. What it adds:

- The **Dev menu** — where they write and publish Tac-Ons.
- A **public dev profile** at `/devs/their-handle`, showing their bio, home
  studio, Next Great Adventure and everything they have published.

Removing dev status closes the dev menu but keeps their handle and their
published work, so existing links and listings do not break.

---

## For devs

### Getting started

**Dev menu** in the sidebar → **New Tac-On**. The editor opens with a working
example. The right-hand panel compiles what you type as you type it and tells
you, with a line number, what is wrong. When it says **Compiles**, you can
publish.

The language is called **TacScript**. Its full reference is in
[TacScript.md](TacScript.md). The short version:

```
tacon hero-bucks {
  name "Hero Bucks"
  version 1.0.0
  about "Every buck earned and spent, in one place."

  store entry {
    field hero person required
    field amount number
    field reason text
  }

  ask balance sum of entry.amount where entry.hero is me.id

  page bucks {
    title "Hero Bucks"
    nav true

    note "You're holding {my.balance} bucks."
    stat "In circulation" sum of entry.amount

    form "Log some bucks" {
      into entry
      ask hero
      ask amount
      ask reason
      allow admin, secretary
    }

    list entry {
      columns hero, amount, reason, created
      sort newest
    }
  }

  when election.certified {
    add entry { hero: event.winner, amount: 10, reason: "Elected" }
  }
}
```

That is a complete, installable Tac-On.

### Publishing

**Publish** in the editor. You choose who can find it:

- **Draft** — only your own academy sees it in the market.
- **Unlisted** — anyone with the link.
- **Public** — it appears in the market for every academy on this Eagle Bot.

The `version` line in your source decides the version. **Publishing over a
version that already exists is refused**, always. An academy running 1.0.0 keeps
running exactly the 1.0.0 it installed; bump to 1.0.1 or 1.1.0 and they will be
offered the update.

Your Tac-On's name (`tacon my-name`) is yours once you publish it. Nobody else
can publish over it.

### Stats

**Stats** on any of your Tac-Ons shows installs over time, how many academies
run it, and which versions they are on. The last one is the useful one: if most
of your installs are still on an old version, the update you shipped has not
reached anybody yet.

### Reading other Tac-Ons

A Tac-On can list what another one publishes:

```
use hero-bucks as bucks
...
note "You have {bucks.balance} bucks."
list bucks.entry { columns hero, amount }
```

This only works for things the other Tac-On listed under `provides`, only inside
the same academy, and only for reading. If that Tac-On is not installed, lists
come back empty and borrowed numbers read zero — your Tac-On still works.

### What to expect from the runtime

- Records are yours alone. Two installs of the same Tac-On, in two studios, keep
  two separate sets.
- Totals are worked out over the most recent 2,000 rows in a store. A studio
  ledger will never come close; if yours might, it probably wants a different
  shape.
- A reaction (`when`) runs as the Tac-On, not as the person who triggered it. It
  can write to your own stores and nothing else. If it fails, it fails quietly —
  a broken Tac-On never breaks somebody's election.

---

## The dev portal

Press **Ctrl+D** anywhere in Eagle Bot.

The portal is for the people who maintain Eagle Bot itself, not for academies.
It has its own accounts, kept in their own table: no academy admin can grant
portal access, and portal accounts have no academy, no studio and no vote.

Portal devs can:

- **Publish official Tac-Ons** — same language, same compiler, same rules as
  anybody else's, with an *Official* badge on the tile.
- **Send notices** — a banner every academy on this deployment sees, aimed at
  admins, devs, or everyone. People can dismiss one; it stays dismissed.
- **Invite other devs** — the head dev creates an invite link and passes it on.
  The portal has no mailer of its own.
- **Pull a Tac-On** (head dev only) — blocks new installs and says why on the
  listing. **Academies already running it keep it and their records.** Pulling
  something should not cost a studio a term of work.

### First run

The first time anyone opens the portal it offers to create the head dev account.
In production this requires `DEV_PORTAL_SETUP_KEY` to be set in the server's
environment and typed into the form — otherwise the first person to find Ctrl+D
would own the market.

---

## What ships with Eagle Bot

Four official Tac-Ons are published the first time the server starts. They are
ordinary Tac-Ons: installable, removable, and readable as worked examples.

| Tac-On | What it does |
| --- | --- |
| **Hero Bucks** | A ledger for the currency the studio already runs on, with a running total per Hero. Awards bucks automatically when an election is certified. |
| **Quest Board** | Every quest the studio is running, who signed up, and a panel on Town Hall showing what is live. |
| **Gratitude Wall** | Anyone can thank anyone, in public, and it stays up. The simplest useful Tac-On there is. |
| **Buck Shop** | A shop that spends the balance Hero Bucks keeps — the worked example of one Tac-On reading another. |

---

## Setting it up

The Tac-Ons feature adds tables to the database. After pulling this version:

```sh
npm run db:push
```

New tables: `tacons`, `tacon_versions`, `tacon_installs`, `tacon_records`,
`portal_devs`, `portal_invites`, `portal_notices`, plus three columns on `users`
(`dev_status`, `dev_handle`, `dev_since`).

Optional environment variable:

- `DEV_PORTAL_SETUP_KEY` — required in production before the head dev account
  can be claimed.

---

## Notes and limits

- **The market is per deployment.** Every academy on one Eagle Bot server shares
  one registry. Academies on a different server have a different market; the dev
  portal is how official Tac-Ons reach any of them.
- **Paid Tac-Ons do not exist yet.** The listing carries installs and versions,
  not a price. When charging arrives it belongs on the listing, not in the
  language.
- **Nothing in a Tac-On executes.** A Tac-On is a description of what to show and
  what to record, checked at publish time and rendered by the server. Installing
  one never runs somebody else's code in your browser, which is what makes it
  reasonable to let a fourteen-year-old ship to every academy in the network.
