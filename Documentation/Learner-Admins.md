# Learner admins

*For admins.*

Plenty of Actons hand the job of running Eagle Bot to a learner. That learner
needs admin powers: settings, invites, the roster. But they are still a
learner. They sit in Town Hall as a learner, and nobody
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
marks them as a learner: their profile says **learner admin**, and anything
that treats learners differently from staff can tell them apart.

---

## Setting it up

This feature adds a column. After pulling this version:

```sh
npm run db:push
```

New: `learner_admin` on `users`, off for everyone to start.
