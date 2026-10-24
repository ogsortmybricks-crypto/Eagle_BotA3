# Eagle Bot

## Run locally on Replit

- Runtime: Node.js 20
- Web workflow: `npm run dev`
- Preview port: `5000`
- Database: Replit PostgreSQL, configured through `DATABASE_URL`

Automatic task-merge setup runs `scripts/post-merge.sh`: it restores locked
dependencies, checks TypeScript, and rebuilds the app. Database changes are
deliberately separate so an unattended merge cannot apply an unreviewed
destructive schema change. Follow the reviewed development/publishing procedure
below when a merge changes the schema.

The `shell-quote` and `proxy-addr` dependency overrides select patched releases:
older locked transitive versions were blocked by the package security firewall,
even when updating their parent dependencies. Keep these safety pins until the
parent dependency graph reliably selects patched versions without them.

The development database schema is managed with Drizzle:

```sh
npm run db:push
```

Run `npm run db:push` after pulling a change that adds tables - the Tac-Ons
feature added seven (`tacons`, `tacon_versions`, `tacon_installs`,
`tacon_records`, `portal_devs`, `portal_invites`, `portal_notices`) and three
columns on `users`.

The calendar also requires `calendar_events` and `studio_guides`. Compare the
actual development schema with `shared/schema.ts`, including defaults,
constraints, and indexes; apply reviewed, safe missing changes in development
only and verify the result independently. A successful build or command exit
does not establish that the schema is synchronized.

For the published app's managed production database, use Replit's supported
Publish / Republish schema synchronization, **only with the owner's explicit
approval**. Keep the existing production database and leave all
copy-development-data / overwrite options off to preserve academy data and
Tac-On installations. Review unexpected or destructive changes and any rename
prompts before proceeding. Never add production DDL, custom production
migrations, deploy-build schema mutation, or startup-time schema repair.

After publishing, verify production metadata read-only and test both the
original installed Tac-On page and `/calendar` while signed in. If production
already matches development, check the pages and logs before republishing.
Report pending publishing or authenticated verification explicitly; do not
claim the live problem is fixed from a development check alone.
Full procedure: [Documentation/Calendar.md](Documentation/Calendar.md#setting-it-up).

Optional features:

- AI features require the `ANTHROPIC_API_KEY` secret.
- The dev portal (Ctrl+D) needs `DEV_PORTAL_SETUP_KEY` before its head dev
  account can be claimed in production. See
  [Documentation/Tac-Ons.md](Documentation/Tac-Ons.md).
- Email invitations require `SMTP_USER` and `SMTP_PASS`; `SMTP_HOST`, `SMTP_PORT`, and `SMTP_FROM` can override the Gmail defaults.
- `APP_URL` should be set to the public app URL when email invitations are enabled.
- Paid plans need `STRIPE_SECRET_KEY` and the four `STRIPE_PRICE_*` IDs;
  `SUPPORT_EMAIL` receives survey answers and Help messages. See
  [Documentation/Plans-and-Support.md](Documentation/Plans-and-Support.md).

Useful checks:

```sh
npm run check
npm run build
```