# Tac-On extension engine: manifest format 2 / SDK 1

## Existing architecture and scope

Eagle Bot remains React/Vite with Express, existing cookie sessions, real academy
roles/dev status/position memberships, studio scopes/groups and Drizzle/PostgreSQL.
The existing catalog, learner Dev menu and developer portal remain the publishing
flows. Nothing is replaced with a separate app or marketplace.

- `shared/tacons`: one compiler produces the canonical versioned manifest from
  Tac-Script; SDK contract and validation are shared by client and server.
- `server/tacons`: runtime permissions, setup transactions, scoped interop and
  code compilation. Uploaded modules are compiled, **never executed here**.
- `server/routes/tacons.ts`: immutable publishing and installation lifecycle.
- `client/src/tacons`: native widgets, permission review, configuration and the
  narrowly scoped program bridge.
- `client/public/tacon-sandbox.html`: opaque-origin iframe and isolated worker.
- `shared/schema.ts`: extension-scoped records, installation approvals and event
  inboxes. Approval state is not package-editable configuration.

No actual Tac-On feature package is seeded, checked into the host or hardcoded
in the engine. Developers publish their package folders through the app.

## Author a reviewed package

Continue using one `.tacon` file plus local JS/TS/JSX/TSX/CSS files. The compiler
generates a **format 2 manifest** when `engine 1` is present; `1` is the SDK
contract version, independent of the package's semantic `version`.

```tacon
tacon shared-notes {
  name "Shared Notes"
  version 1.0.0
  about "An example, published by its author."
  icon puzzle
  category general
  tags collaboration notes

  engine 1 {
    view everyone
    configure admin guide
    read admin guide learner
    write admin guide learner
    capability storage.read storage.write extensions.discover events.send events.receive
    emit note.created
    listen note.created
  }

  setting heading {
    default "Our notes"
  }
  store note {
    field body text required
  }
  page home {
    nav true
    program "src/main.ts" {
      read note
      submit 1
      height 400
    }
    form "Add a note" {
      into note
      ask body
      allow admin guide learner
    }
    list note {
      columns body, by, created
    }
  }
}
```

```ts
// src/main.ts — no Node.js or host DOM access
export default async function(eagle: any) {
  const notes = eagle.read("note");
  eagle.render({tag: "section", children: [
    {tag: "h2", text: `${eagle.settings.heading}: ${notes.length} notes`},
    {tag: "input", attrs: {name: "body", placeholder: "Write a note"}},
    {tag: "button", text: "Save", action: "save"},
    {tag: "button", text: "Read event inbox", action: "inbox"}
  ]});
  eagle.on("save", async ({values}: any) => {
    await eagle.submit(1, values);
    const peers = await eagle.extensions.discover();
    if (peers.some((peer: any) => peer.name === "Shared Notes")) {
      await eagle.events.send("broadcast", "note.created", {body: values.body});
    }
  });
  eagle.on("inbox", async () => {
    const inbox = await eagle.events.read({after: 0, limit: 20});
    eagle.render({tag: "pre", text: JSON.stringify(inbox, null, 2)});
  });
}
```

Native form indexes are zero-based, include **all** widgets in the owner, and
must be declared by the program. A native write refresh waits until its current
SDK event handler/initialization and pending calls finish, allowing an awaited
event send after a submission. Record writes and event sends are separate
transactions: handle errors and deduplicate business events if retrying.
Unmanaged timers are not durable/background jobs.

## Access and grants

The four independent audiences are `view`, `configure`, `read`, and `write`.
Omitted audiences default to everyone, except configuration defaults to admins.
Use `none` to deny an operation. Existing role/dev audiences, own position
names and `position "Existing Studio Seat"` work as in native Tac-Script.
Native page/form/button/remove audiences still apply **in addition**.

Admins can override installation audiences in **Market → listing → Manage
permissions & setup**. Admins always retain configuration/recovery access;
this does not automatically grant read/write access to extension records.
Other authorized configurers use **Tac-On settings** on pages, panels or desks.
If configuration is allowed but viewing is not, a settings-only sidebar entry
opens `/t/:installId/__configuration` without opening the private extension UI.
Settings are validated against their declared names/types/options; not for secrets.
Declared settings/defaults are exposed read-only as `eagle.settings` to authorized
program viewers. Changing them refreshes the program. Undeclared keys are not sent.

For new contracts all requested capabilities start **unchecked** at install.
An API operation needs the author declaration, installation grant, correct
audience and host scope. An admin may revoke capabilities later. A program
cannot grant itself access, choose its caller, install context, or bridge URL.

| Capability | Additional boundary |
|---|---|
| `storage.read` | Read audience; own declared stores, or explicitly approved sharing |
| `storage.write` | Write audience and native form/action validation |
| `host.read` | `needs` declarations and viewer's real host permissions |
| `host.hooks` | Declared native activity hooks; no arbitrary JS server execution |
| `sharing.read` | Explicit `use`, readable studio and provider access |
| `sharing.provide` | Only stores/computations under `provides` |
| `extensions.discover` | Only enabled, viewer-accessible compatible installations |
| `events.send` | Declared topics, write audience, `storage.write`, approved recipient |
| `events.receive` | Declared topics; inbox reads need read audience and `storage.read` |

Existing packages without `engine` retain legacy native behavior and gain **no**
new discovery/event privileges. They can still receive installation audience
overrides. Publishing a newer version does not update installed copies.
Upgrades involving a new contract require explicit review of that exact version.

## Setup and lifecycle

The audited host setup primitive is ordinary Eagle Bot **positions**, not custom
scripts or arbitrary host-table mutations. When a new-contract package declares
positions, it must declare their reviewed setup:

```tacon
engine 1 {
  setup positions optional "Create review seats that this studio can appoint"
}
```

Use `required` instead of `optional` when the package cannot work without them.
The installer sees purpose, seat titles/counts and consequences before mutation.
Optional setup defaults off. Selecting no seat setup can leave position-only
views inaccessible until an admin opts in through the management review.

Creation/update, setup and grant changes use transactional locks. Setup retries
synchronize the same owned host records. Failures roll back host setup together,
persist an actionable failed result and offer **Retry setup**. Successful
`position.created` activity is emitted only after commit, retaining native hooks.

Repeated installation requests return the existing installation without
overwriting data/settings/grants or creating duplicates. Updates preserve the
installation ID, records and settings. Reviews are tied to immutable version IDs;
a stale/conflicting review is rejected.

Disable blocks program, record and event operations while preserving data.
Re-enable restores only approved positions. Configuration and admin recovery
remain available while disabled. Uninstall explicitly deletes installation
records and all incoming/outgoing message copies, including recipient inbox
copies of sent messages; positions and appointment history are archived, not
deleted. Reinstall after uninstall starts a new empty installation.

## SDK event contract

Programs receive `eagle.sdkVersion === 1` and:

- `await eagle.extensions.discover()` → `{id, slug, name, version, studioId}[]`.
- `await eagle.events.send(installId | "broadcast", topic, payload)` →
  `{delivered}`. Targeted self-delivery is allowed; broadcasts exclude the sender.
- `await eagle.events.read({after?: number, limit?: number})` →
  `{events, nextCursor, hasMore}`. Save the last cursor, not an array offset.
- Existing `read`, `submit`, `render`, `styles`, `on`, `h` and `Fragment`:
  [complete program SDK](Tac-On-Programs.md).

An event contains `id`, `senderId`, `recipientId`, `topic`, `payload`, `createdAt`.
Topic names are exact lowercase identifiers with dots/hyphens/underscores,
max 80 characters. Both sender and recipient must declare the topic. Recipients
must be enabled, opted in, visible to the caller and academy/studio compatible.
Studio-group peers use the host's existing studio-circle membership; unrelated
studio installs are excluded. Academy-wide installs bridge accessible studios.
No sender/actor identity supplied by program code is trusted.

Limits: 16 KB UTF-8 JSON object payload, at most 25 broadcast recipients, inbox
page size 1–100, 120 SDK calls/minute per user/installation per server process,
and 120 persisted message deliveries/minute per user/academy (database-enforced).
There is no exactly-once guarantee or automatic business-event processing.
Inboxes persist while closed; JS listeners only run while the program is open.
Already stored messages remain history after sender disable/revocation; future
sends stop. Receiver read/receive revocation blocks subsequent inbox reads.

The host posts only fixed-context SDK calls to
`POST /api/tacons/sdk/:installId/rpc` with `{sdk:1, page|panel|position,
index, method, args}`. The server validates owner/widget visibility as well as
permissions, not merely the iframe's declarations. Host configuration and
installation controls use separate authenticated endpoints.

## Security limits and deployment

Untrusted modules run only inside the existing opaque-origin iframe's worker.
No session secrets, DOM, Node APIs, raw SQL, arbitrary HTML, remote imports or
network access are exposed. UI is a validated declarative tree. CSP, bounded
messages and the nonresponsive-worker watchdog remain enabled.

Revocation stops future server operations, not requests already in flight or
copies already shown to a browser. The sandbox cannot prove a publisher's
business claims, prevent misleading text or guarantee efficient code. Review
publishers and requested data access; do not treat a capability grant as proof
that uploaded code is trustworthy.

Two additive development tables hold controls and messages. Existing tables,
records, installed versions and authentication are retained. Run reviewed
`npm run db:push` in development and verify actual metadata. For the managed
production database, use owner-approved Publish schema synchronization with
**all data-copy/overwrite options off**. Do not run production DDL or startup
schema repair. See [project publishing procedure](../replit.md).

Verification:

```sh
npm run check
npm run test:tacons
# Development workspace only, with npm run dev already running:
npm run test:tacons:integration
npm run build
```

Integration tests create their own temporary academies, use real login sessions
and clean up those academies. They do not bypass authentication or operate on
existing academy data.
