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

### Ideas that fit the engine today

- **Agenda box.** Anyone adds a Town Hall topic. An elected keeper records what
  was decided (worked example below).
- **Promise log.** Commitments made at Town Hall, who made them and when
  they're due, shown as a panel on the Town Hall page.
- **Job check-ins.** Each position's holder logs their duty each week on their
  desk, so the studio can see whether its jobs are being done.
- **Appeals board.** A learner files an appeal, and an elected committee
  position records the hearing and decision. Fits studios that run Hero Buck
  appeals or Contract disputes.
- **Rule spotlight.** A panel on the wiki listing rules whose section matches
  a setting, for example the ROE before a Launch.
- **Election thank-yous.** A `when election.certified` reaction that records
  each winner, building a studio history of who served.
- **Studio visitors / Exhibition sign-up.** A form that collects guests and a
  list for the learner running the event.

## 2. Design principles

1. **A learner holds the job.** Use `position` for any role that keeps a
   record, approves or runs a process, so the studio elects or appoints it.
   Use `allow <position>` for its forms and `allow remove <position>` for
   clean-up. Add `admin` as a backstop, not as the main audience.
2. **The record is shared.** Default to lists the whole studio can read. Use
   `show to` only for things that really are private (a holder's desk, a
   staff-only page).
3. **Make every academy's differences settings.** Numbers, names of things, and
   which section of the Contract to read should all be `setting`s with sensible
   defaults.
4. **Words a twelve-year-old understands.** Titles say what something is
   ("Agenda Box"), notes say what to do ("Say what you want the studio to
   decide"), empty states say what will appear ("Nothing on the agenda yet.").
5. **Explain the rule in the Tac-On.** A `note ... info` at the top of a page
   saying how it works beats a README nobody opens.
6. **One job per Tac-On.** Two small Tac-Ons that `use` each other beat one that
   does everything. Keep `provides` small and stable, because others will
   depend on it.
7. **Design for updates from day one.** Records from version 1.0.0 will still
   exist in version 3.0.0. Choose store and field names you won't need to
   rename.
8. **Comment the source.** Learner devs read published Tac-Ons to learn. A `#`
   comment at the top saying what it's for, and one above any trick, helps the
   next author.

## 3. Patterns that work

### A position owns the record

```
position keeper {
  title "Record Keeper"
  seats 1
  elected true
  term "One session"
  duties "Record every decision the same day"
  form "Record a decision" {
    into decision
    ask summary
  }
}
```

The form on the desk is only visible to the current holder. When their term
ends, the next holder gets it.

### Append, don't edit

TacScript can't change a saved record. Model changes as new records: a
`decision` store next to a `topic` store, or a `status` row that the newest
one wins. Let the record keeper remove rows that are finished
(`allow remove keeper`). The history of what was decided lives in the second
store.

### "Mine" views

`by` holds the submitter's name, and `me.name` is the viewer's:

```
list topic {
  title "Topics you added"
  columns title, created
  where topic.by is me.name
}
```

For a record *about* someone, use a `person` field and compare it with
`me.id`:

```
ask my_points sum of entry.amount where entry.hero is me.id
```

### "This session" without dates

There's no date logic yet. Put the session in a setting and stamp it on each
record:

```
setting session {
  label "Current session"
  type text
  default "Session 1"
}
```

Then `field session text` on the store, and either have the form ask for it,
or fill it from a reaction with `session: setting.session`. Filter with
`where entry.session is setting.session`.

### React to what the studio does

```
when election.certified {
  only if event.winner above 0
  add service {
    who: event.winner
    note: event.summary
  }
}
```

Reactions run as the Tac-On. They can only add to its stores and write to the
activity log, and they never break the event that triggered them.

### Show up where people already are

A `panel on town-hall` or `panel on wiki` puts the Tac-On in front of people
during the meeting or while they read the Contract. That's often better than a
page they have to remember to open.

## 4. Worked example: Agenda Box

The whole file. It compiles on the current engine.

```
# Agenda Box: anyone can put a topic on the next Town Hall's agenda, and the
# elected Agenda Keeper records what the studio decided. Topics can't be edited
# once saved, so decisions go in their own store and the Keeper clears topics
# that are done.
tacon agenda-box {
  name "Agenda Box"
  version 1.0.0
  about "Anyone can put a topic on the next Town Hall's agenda. The Agenda Keeper records what the studio decided."
  icon megaphone
  category governance

  store topic {
    label "Agenda topic"
    field title text required
    field why longtext
    field kind choice proposal, problem, idea, celebration
  }

  store outcome {
    label "Decision"
    field topic text required
    field result choice passed, failed, tabled, resolved
    field decision longtext required
  }

  ask waiting count of topic
  ask decided count of outcome

  page agenda {
    title "Agenda Box"
    icon megaphone
    subtitle "Put a topic on the next Town Hall's agenda."
    note "Everyone in the studio can see what you add. Say what you want the studio to decide." info

    form "Add a topic" {
      into topic
      ask title "Topic"
      ask why "Why it matters"
      ask kind "What kind of topic"
      submit "Add to the agenda"
    }

    list topic {
      title "On the agenda"
      columns title, kind, why, by, created
      sort oldest
      empty "Nothing on the agenda yet."
      allow remove agenda_keeper, admin
    }

    divider

    list outcome {
      title "What Town Hall decided"
      columns topic, result, decision, created
      sort newest
      limit 20
      empty "No decisions recorded yet."
    }
  }

  panel on town-hall {
    title "From the Agenda Box"
    stat "Topics waiting" my.waiting
    list topic {
      columns title, kind, by
      sort oldest
      limit 10
      empty "Nothing on the agenda."
    }
  }

  position agenda_keeper {
    title "Agenda Keeper"
    about "Brings the Agenda Box to every Town Hall and records what the studio decided."
    seats 1
    elected true
    term "One session"
    duties "Read every topic at Town Hall", "Record each decision the same day", "Clear topics once they're decided"

    note "{my.waiting} topics are waiting for Town Hall."
    form "Record a decision" {
      into outcome
      ask topic "Which topic"
      ask result "What happened"
      ask decision "What the studio decided"
      submit "Record it"
    }
  }

  provides outcome, decided
}
```

Why it's built this way:

- **Learners own it.** Anyone can add a topic, and an elected learner keeps
  the record. Admins can only clear topics, as a backstop.
- **It's in the meeting.** The Town Hall panel shows the agenda where the
  Secretary is already working.
- **It works around the missing "edit".** Decisions are separate records, and
  finished topics are removed by the Keeper. The decision history stays.
- **It's reusable.** `provides outcome, decided` lets another Tac-On, such as
  a promise tracker, read the studio's decisions.

## 5. Before you call it done

- [ ] Compiles in the Dev menu with no errors, and you've read every warning.
- [ ] Tested as an admin, a learner and the position holder (see
      [06-testing-and-publishing.md](06-testing-and-publishing.md)).
- [ ] Every form and button has a deliberate `allow`.
- [ ] Every `where` reads the field you meant. Filters that name nothing match
      nothing, silently.
- [ ] No `or`, and no one-line `add { a: 1, b: 2 }`. See
      [05](05-limits-and-workarounds.md).
- [ ] The `about` line says what it does and which studios it's for.
- [ ] Anything an academy might disagree about is a `setting`.
- [ ] If this is an update: old records still read correctly, and nothing was
      renamed.
- [ ] Anything the engine stopped you doing is in `ENGINE-REQUESTS.md`.
