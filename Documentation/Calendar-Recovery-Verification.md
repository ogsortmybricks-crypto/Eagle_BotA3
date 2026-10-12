# Calendar recovery verification

## Checked on 2026-10-12

The earlier report of missing `calendar_events` and `studio_guides` no longer
matches the current production metadata. Both tables now exist. No publishing,
database schema mutation, package installation, or package publishing was
performed during this verification.

### Schema evidence

- The published deployment is an autoscale deployment with a successful build.
  The application uses the environment's runtime-managed `DATABASE_URL` through
  `server/env.ts` and `server/db.ts`; no alternative production connection is
  selected in application code.
- Development and managed production have the same 31 public tables and 368
  columns. Types, lengths, timestamp precision, nullability, and defaults match
  across environments.
- Development was independently compared with Drizzle's declared table
  configuration in `shared/schema.ts`: all 368 columns, defaults, nullability
  and types; 31 primary keys; 81 foreign keys with their target columns and
  actions; and 57 declared secondary indexes match. No development push is
  required.
- `calendar_events` has all 19 declared columns; `studio_guides` has all seven.
  Their primary keys, foreign keys, and secondary indexes match production.
- The only constraint/index naming difference across environments is the
  session table's primary key: `user_sessions_pkey` in development versus
  `session_pkey` in production. Both are the same unique primary key on `sid`;
  this is not a missing schema object or a reason to delete sessions.
- Read-only production counts showed one academy, seven users, four studios,
  two Tac-On installations and 23 Tac-On records. The two newly required tables
  were empty, which is valid. These are current observations, not a
  before/after proof of the publish operation that created the tables.

### Development behavior

Temporary, isolated development academies, studios, accounts, events, and guide
assignments were used, then removed. Authentication stayed enabled.

- Admin, learner, and assigned guide signed in through `/api/auth/login`.
- Ordinary calendar requests returned HTTP 200, including guide assignments.
- Academy-wide and studio-group events were readable where expected.
- Learner and assigned-guide requests could not read a disallowed studio;
  cross-academy targets were refused, and cross-academy events were excluded.
- Signed-out calendar requests returned HTTP 401.
- An in-memory, compiler-validated Tac-On manifest rendered `calendar`,
  `calendar.sessions`, and `session_start` using the learner's studio scope.
  Hidden-studio and foreign-academy data were excluded. No Tac-On package or
  installation was seeded or changed.
- `npm run check` and `npm run build` passed. The build reported the existing
  large-bundle warning.

### Live status and owner confirmation

The published `/api/health` returned HTTP 200. Recent deployment logs checked
during verification contained no application missing-relation errors for the
calendar or studio guides. Log absence alone does not prove page recovery.

The screenshot browser was signed out and showed the development setup screen,
not the authenticated calendar. Signed-in UI rendering was **not** independently verified by the agent.
Development API/runtime tests are not a substitute for checking the originally
affected live installation.

**Owner confirmation, 2026-10-12:** In response to the request to check the
published Calendar and originally affected Tac-On page while signed in, the
owner reported: “Everything works fine now.” This completes the user-assisted
live recovery check. The precise Tac-On page URL was not supplied, so this is
owner-reported recovery rather than an independently reproduced live browser
test. No additional publish or production data replacement was performed.

If subsequent inspection finds real schema drift, follow the owner-approved
schema synchronization procedure in [Calendar setup](Calendar.md#setting-it-up),
with production data replacement disabled. If a page fails again, capture its
API status/error and inspect recent deployment logs before changing anything.
