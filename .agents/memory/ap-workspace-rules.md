---
name: AP workspace rules
description: User's AP planning, verification-code scope, history and attendance requirements.
---

None of the AP Tac-On's feature code should be in Eagle Bot Main. The AP Tac-On
belongs in `built-tacons`. Update the generic engine when a package needs new
capabilities rather than implementing its feature in the main app.

**Why:** The user explicitly corrected this boundary after AP-specific screens,
routes and rules were implemented in the main app.

**How to apply:** Keep AP compiler logic, contracts, storage rules, routes and
screens package-owned. Main may supply generic extension interfaces and shared
services, but must not directly dispatch AP-specific functions or screens.

The six-digit confirmation code belongs to Eagle Bot Main and is reusable by
Tac-Ons, not owned by an individual AP installation.

**Why:** The user explicitly clarified this in their attached notes: "the six
digit code thing should be part of Eagle Bot Main, and can simply be pulled by
Tac-Ons".

**How to apply:** Future Tac-Ons should verify the account-level credential,
never retrieve its plaintext or introduce installation-specific competing codes.

All admins, including learner admins, may plan weekly academic work in Writers'
Workshop, Civilization, Quest and custom categories. Learners certify their
partners' work, not their own. Adding another pair must preserve existing pairs,
and re-pairing must preserve check-in history.

**Why:** These are explicit user requirements; the user reported losing the
previous pair when adding another.

**How to apply:** Keep the learner-admin planning path functional and protect
pair history during future pairing or archive changes.

Attendance and check-ins are independent facts. A missing check-in does not
prove a missed school day.

**Why:** The user records usual attendance and specific sick absences separately
from check-in records. Inferring absence would falsely label attendance.

**How to apply:** Show missing check-ins as unrecorded check-ins, and show absence
only when explicitly recorded by the learner.

Public verification links disclose the assignment, learner, reviewer, academy,
dates and completion/excellence status—not private notes, evidence or attendance.

**Why:** Links are intended to be shared in Journey Tracker; private learning and
absence records should not become public just because a certificate is shared.

**How to apply:** Preserve this minimal disclosure unless the user explicitly
requests additional public fields.
