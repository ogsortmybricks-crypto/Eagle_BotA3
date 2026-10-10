# Studio groups

*For admins and guides.*

Every studio in Eagle Bot governs itself: its own Contract, its own positions,
its own Town Halls and elections. That fits most Actons. But plenty run two
studios as one body. Middle Studio and Launchpad sit in the same Town Hall,
keep one Contract and elect one Council.

A **studio group** is how you tell Eagle Bot that. Put Middle and Launchpad in
a group and they share everything, while Spark carries on exactly as before.

---

## What a group shares

Open any studio in a group and you see everything the whole group owns:

| | In a group |
| --- | --- |
| **Wiki** | One Contract. Rules written in Middle show in Launchpad, and the other way round. |
| **Positions** | One list. Anyone in the group can be appointed to or stand for any of them. |
| **Town Hall** | Meetings held in either studio belong to both. Quorum counts everyone in the group, and open action items carry forward across the group. |
| **Elections** | Everyone in the group votes on the group's ballots. |
| **Tac-Ons** | A Tac-On installed in either studio shows for the whole group, with one shared set of records. Its `when` reactions hear about things that happen anywhere in the group. |
| **Documents and AI** | Building the wiki reads the whole group's documents. When the AI writes rules or processes a Town Hall, it sees the whole group's Contract and positions and writes for all of the group's studios. |
| **Profiles** | Learners can see the profiles of everyone in the group. |
| **Calendar** | Entries put on the group's calendar show in every studio in it. Each studio's own entries stay on that studio's calendar; the **Studio group** view shows them all together. See [the calendar](Calendar.md). |
| **Guides** | A guide assigned to the group is a guide of every studio in it. See [Studio guides](Studio-Guides.md). |

Studios outside the group see none of it. Academy-wide items still show
everywhere, as they always have.

**What stays per studio:** the studio's name, colour, age range, simple view,
and its own settings overrides (quorum rules, election length and so on). A
learner's home studio doesn't change either. The studio switcher still lists
the same studios, but its subtitle now says who the studio governs with, for
example *With Launchpad · Upper Studios*.

---

## Making a group

**Settings → Studio groups → New group.** Give it a name, say why the studios
govern together (optional), and tick at least two studios.

Both **admins and guides** can do this. Whether two studios meet as one is a
call about the room, and the guide is often the one who knows. A guide can only
group studios they can see, and only sees groups made up of studios they can
see.

A studio can be in **one group at a time**. To move one, take it out of its old
group first.

### Things to look out for

When the studios already have things in common, Eagle Bot says so as soon as
you save:

- **Two positions with the same title.** If Middle and Launchpad both have a
  *Treasurer*, both now appear on the Positions page. Archive the one you don't
  need.
- **The same Tac-On installed in both.** Each install keeps its own records,
  so the group would see two copies. Remove the extra one if you want a single
  set (remember that removing a Tac-On deletes its records).

---

## Changing or breaking up a group

**Edit** renames a group or changes which studios are in it. **Break up** (the
unlink button) dissolves it.

Nothing is copied, moved or deleted, either way. Every rule, position,
meeting, election and Tac-On belongs to the studio it was created in, and
keeps belonging to it. So:

- When a studio **leaves** a group, it takes everything it created with it and
  stops seeing what the other studios created.
- Anything made **while grouped** belongs to whichever studio was selected at
  the time. That's normally the creator's own studio, and the studio picker on
  each form shows which one.
- People keep the positions they hold. An election that is still open keeps
  its owning studio's voters, which after a break-up is just that studio.

Every change is written to the activity log.

---

## Setting it up

This feature adds a table and a column. After pulling this version:

```sh
npm run db:push
```

New: the `studio_groups` table, and `group_id` on `studios`.
