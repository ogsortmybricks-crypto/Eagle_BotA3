# Eagle Bot

## Run locally on Replit

- Runtime: Node.js 20
- Web workflow: `npm run dev`
- Preview port: `5000`
- Database: Replit PostgreSQL, configured through `DATABASE_URL`

The development database schema is managed with Drizzle:

```sh
npm run db:push
```

Run `npm run db:push` after pulling a change that adds tables - the Tac-Ons
feature added seven (`tacons`, `tacon_versions`, `tacon_installs`,
`tacon_records`, `portal_devs`, `portal_invites`, `portal_notices`) and three
columns on `users`.

Optional features:

- AI features require the `ANTHROPIC_API_KEY` secret.
- The dev portal (Ctrl+D) needs `DEV_PORTAL_SETUP_KEY` before its head dev
  account can be claimed in production. See
  [Documentation/Tac-Ons.md](Documentation/Tac-Ons.md).
- Email invitations require `SMTP_USER` and `SMTP_PASS`; `SMTP_HOST`, `SMTP_PORT`, and `SMTP_FROM` can override the Gmail defaults.
- `APP_URL` should be set to the public app URL when email invitations are enabled.

Useful checks:

```sh
npm run check
npm run build
```