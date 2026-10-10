# Studio guides

*For admins and guides.*

Every studio has its guides, and plenty of Actons have a guide who looks after
two studios run as one. **Studio guides** is how Eagle Bot knows who they are.

---

## Assigning guides

**Settings → Studios.** Each studio has a **Guides** line. Press **Assign** and
pick someone. Press the × on a name to take them off.

To make someone a guide of a whole [studio group](Studio-Groups.md), do the same
on **Settings → Studio groups**. They become a guide of every studio in the
group, including any studio added to the group later.

- Only **admins** assign guides. Guides can see the lists on the Studio groups
  tab, but can't change them.
- You can assign **guides and admins**. Small academies often have an owner who
  guides too. Learners and secretaries can't be assigned.
- One person can guide any number of studios and groups.
- Every change is written to the activity log.

---

## What it changes

**Where guides are listed.** On **People**, each studio shows its guides above
its members, even when a guide's own home studio is somewhere else. The
[calendar](Calendar.md) shows the guides of whatever you're looking at.

**Which studios a guide can open.** Being assigned never takes anything away.
With **Settings → Governance → Guides see every studio** on (the default),
guides still open any studio. With it off, a guide can open their home studio
and every studio they're assigned to.

**Where a guide starts.** A guide with no home studio opens Eagle Bot on the
first studio they guide, not on every studio at once.

**Simple view.** A studio's simple view is only for its learners. Guides
looking at that studio, assigned or not, always get the standard view, because
they're the ones who have to fix things.

---

## Setting it up

This feature adds a table. After pulling this version:

```sh
npm run db:push
```

New: the `studio_guides` table. No one is assigned to start with.
