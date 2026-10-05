# Learner admins

*For admins.*

Plenty of Actons hand the job of running Eagle Bot to a learner. That learner
needs admin powers: settings, invites, the roster. But they are still a
learner. They have an AP, they sit in Town Hall as a learner, and nobody
should mistake them for a guide.

A **learner admin** is how you tell Eagle Bot that.

---

## Making someone a learner admin

**Admin → People.** Set the person's role to **admin**. A **Learner admin**
checkbox appears under the role. Tick it.

- Only admins can be learner admins. The checkbox shows only on admin rows.
- Changing the role away from admin clears it automatically. Making them an
  admin again won't bring it back; tick it again.
- Every change is written to the activity log.

Their profile shows **learner admin** in place of **admin**, so everyone can
tell them apart from staff.

---

## What it changes

A learner admin has exactly the same powers as any other admin. The flag
only matters where being a learner matters:

| | Learner admin | Other admins |
| --- | --- | --- |
| **Admin powers** | All of them | All of them |
| **Accountability Partners Tac-On** | Can be an AP | Can't |

---

## Who can be an AP

The Accountability Partners Tac-On pairs learners, so only these people show
up in its pairing dropdowns:

- **Learners**
- **Secretaries**, because the secretary is almost always a learner
- **Learner admins**

Guides and other admins can't be APs. The old *Admins and guides can be
partners* switch is gone. If a guide or staff admin is still in a pairing from
before, saving the pairings shows an error naming them. Take them out of that
row and save again. Their past check-ins are kept.

---

## Setting it up

This feature adds a column. After pulling this version:

```sh
npm run db:push
```

New: `learner_admin` on `users`, off for everyone to start.
