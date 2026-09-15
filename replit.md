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

Optional features:

- AI features require the `ANTHROPIC_API_KEY` secret.
- Email invitations require `SMTP_USER` and `SMTP_PASS`; `SMTP_HOST`, `SMTP_PORT`, and `SMTP_FROM` can override the Gmail defaults.
- `APP_URL` should be set to the public app URL when email invitations are enabled.

Useful checks:

```sh
npm run check
npm run build
```