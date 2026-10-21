# Programs and reviewed engine contracts

TacScript remains the integration layer. For custom logic and interactive UI,
include JavaScript or TypeScript in the **Tac-On's own uploaded package**.
Do not put feature code in Eagle Bot's main source or change the engine just
to install a package.

This chapter covers the current **manifest format 2 / SDK 1** contract. Older
native packages still work without rewriting, but do not automatically receive
new event/discovery privileges.

## Package and publish

A folder contains exactly one `.tacon` source plus its local JS, TS, JSX, TSX
or CSS files. For example:

```text
shared-notes/
  shared-notes.tacon
  src/
    main.ts
```

Use **Dev menu → Upload folder**, or the developer portal's publishing screen.
Both editors support adding, editing and removing code files. Keep the whole
folder in your own workspace; published versions retain their own code files.
The server compiles the package without executing uploaded modules. Missing
imports/files and invalid syntax block publication.

Imports must resolve to supported local package files. There is no Node.js,
runtime npm installation, remote import, DOM or unrestricted network access.
Browser-compatible dependencies must be bundled into permitted package files,
not fetched by the program while it runs.

## Complete example

Save this as `shared-notes.tacon`:

```tacon
tacon shared-notes {
  name "Shared Notes"
  version 1.0.0
  about "Notes and explicitly approved notifications."
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

Save this as `src/main.ts`:

```ts
export default async function(eagle: any) {
  const notes = eagle.read("note");
  eagle.render({tag: "section", children: [
    {tag: "h2", text: `${eagle.settings.heading}: ${notes.length} notes`},
    {tag: "input", attrs: {name: "body", placeholder: "Write a note"}},
    {tag: "button", text: "Save and notify", action: "save"},
    {tag: "button", text: "Read inbox", action: "inbox"}
  ]});
  eagle.on("save", async ({values}: any) => {
    await eagle.submit(1, values);
    await eagle.events.send("broadcast", "note.created", {body: values.body});
  });
  eagle.on("inbox", async () => {
    const inbox = await eagle.events.read({after: 0, limit: 20});
    eagle.render({tag: "pre", text: JSON.stringify(inbox, null, 2)});
  });
}
```

The form's index is **1**: widgets are numbered from zero, counting every widget
in the page/panel/desk, not just forms. Programs must declare each readable store
and submittable native form. Submissions retain native audience, field and
personal confirmation-code checks. Keep secret confirmation codes in native
forms; never embed a code or credential in program files.

Install with the requested grants approved to try every button. A broadcast
does not deliver to its sender, so zero deliveries is normal without another
eligible installed recipient. For a self-delivery test, discover this install
and send to its numeric `id` instead.

## Understand the versions

- Package `version 1.0.0` is the author's immutable release version.
- `engine 1` requests **SDK contract 1**; the compiler generates a **format 2**
  manifest. Do not upload a hand-written replacement JSON manifest.
- `eagle.sdkVersion` is `1`. Unsupported contracts fail validation rather than
  silently receiving different privileges.
- Installing/updating requires review of the exact published version.
  Publishing does not automatically upgrade anyone's installed copy.

## Four independent audiences

| Rule | What it controls |
| --- | --- |
| `view` | Opening pages, panels and desks |
| `configure` | Editing declared settings |
| `read` | Reading stored extension data |
| `write` | Native record mutations and event writes |

Use `everyone`, `none`, existing roles, own positions or
`position "Existing Studio Seat"` as with other TacScript audiences.
Omitted rules default to everyone except configuration, which defaults to admin.
Native widget/form/remove audiences still apply in addition.

An admin can override these rules under **Manage permissions & setup**.
Admins always retain configuration/recovery access, not unrestricted data access.
Authorized configurers get **Tac-On settings** controls and a settings sidebar
entry, even when they cannot open the private extension UI.

`eagle.settings` contains only declared public settings/defaults, read-only.
Changes refresh the program. Settings are not secrets: viewers can receive them.

## Capabilities are requests, not grants

New-contract capabilities start **unchecked** in installation review. The admin
must approve them; changing ordinary settings cannot approve a capability.

| Capability | Purpose and additional requirements |
| --- | --- |
| `storage.read` | Read extension records; requires the read audience |
| `storage.write` | Write extension records; requires the write audience and native validation |
| `host.read` | Read declared Eagle Bot sources; never bypasses the viewer's host permissions |
| `host.hooks` | Run declared native activity reactions; not uploaded server-side JS |
| `sharing.read` | Consume explicitly provided data in an accessible studio scope |
| `sharing.provide` | Expose only declared `provides` stores/computations to eligible consumers |
| `extensions.discover` | Discover enabled, accessible, scope-compatible installs |
| `events.send` | Send declared topics; requires write access and `storage.write` |
| `events.receive` | Accept declared topics; inbox reads require read access and `storage.read` |

Grants, author declarations, audiences, studio scope and native host permissions
are checked server-side. Hiding a button is not an access check. Revocation
blocks future server operations, not copies already shown to a browser.

## Reviewed setup and lifecycle

New-contract packages declaring positions must include setup in their engine
block, for example:

```tacon
engine 1 {
  setup positions optional "Create review seats for this studio to appoint"
}
```

Use `required` instead of `optional` if the package cannot function without it.
Installers see the purpose and proposed seat titles/counts before host changes.
Optional setup defaults off. Setup currently supports **ordinary positions**,
not arbitrary scripts or writes to other host tables.

Setup is transactional and repeatable: retries synchronize the same positions
instead of duplicating them. Failed host changes roll back, a visible failed
result remains, and admins can use **Retry setup**. Seat creation emits normal
activity only after successful commit.

- Repeated install requests keep the existing install/settings/data.
- Reviewed updates preserve installation identity, records and settings.
- Disabling stops use while retaining data and archiving owned positions.
- Re-enabling restores only approved positions.
- Uninstall deletes the installation's records and incoming/outgoing messages,
  including sent copies in recipient inboxes. Positions/history are archived.
  Reinstall starts empty; do not recommend it as an update workaround.

## Program SDK and event inboxes

| API | Use |
| --- | --- |
| `read(store)` | Snapshot of a declared store, not arbitrary host data |
| `render(tree)` | Validated UI nodes; no raw HTML |
| `styles(css)` | Styles scoped inside the isolated frame |
| `on(name, handler)` | Named UI events; handlers receive input values |
| `submit(index, values)` | Declared native form submission; errors reject |
| `h`, `Fragment` | Sandbox factories for JSX/TSX, not a DOM renderer |
| `viewer` | Public current-viewer identity, not a session/token |
| `settings`, `sdkVersion` | Public configuration and SDK version |
| `await extensions.discover()` | `{id, slug, name, version, studioId}[]` |
| `await events.send(id \| "broadcast", topic, payload)` | `{delivered}` |
| `await events.read({after, limit})` | `{events, nextCursor, hasMore}` |

Event envelopes contain `id`, `senderId`, `recipientId`, `topic`, `payload` and
`createdAt`. Topics must match both sender `emit` and recipient `listen`.
Discovery/delivery stay within the academy and compatible studios/studio groups;
academy-wide installs can bridge accessible studios. User code cannot choose
a different caller or bypass a recipient's grant and visibility.

Topics start with a lowercase letter and use lowercase letters, numbers, dots,
hyphens or underscores, up to 80 characters. Limits: 16 KB UTF-8 JSON object
payload, 25 broadcast recipients, inbox page size 1–100, 120 SDK calls/minute
per user/install per server process and 120 persisted deliveries/minute per
user/academy. Handle rejected operations instead of silently ignoring failures.

For continued reading, persist `nextCursor` and pass it as the next `after`.
The example starts at zero deliberately to reread history. There is no automatic
acknowledgment, exactly-once processing, or background execution of uploaded JS.
Inboxes persist while closed; program handlers run only while the program is open.
Disabling a sender does not erase its already delivered messages.

After a successful native submission, refresh waits for the current awaited
handler and pending SDK calls. This lets a handler submit and then send an event.
Those are **separate transactions**: catch failures and design business-event
deduplication where needed. Timers are not durable scheduled jobs.

## Safety and testing

Uploaded programs run inside an opaque-origin iframe's isolated worker, never
as trusted host/server code. The SDK exposes no session secrets, Node APIs,
database connection, DOM or unrestricted network. Invalid UI is rejected and
nonresponsive workers are terminated. This does not prove a publisher's claims
or make every package trustworthy; review requested access and what it displays.

Before release, test compilation/import failures; desktop/mobile layout; each
role including disjoint view/configure permissions; denied studios/academies;
grant revocation; targeted/broadcast events and cursors; setup opt-out/retries;
native confirmation checks; and updates with existing records/settings.
See [testing and publishing](06-testing-and-publishing.md).

For more SDK detail, see [programs](../Documentation/Tac-On-Programs.md).
Host-engine maintainers should also read the
[architecture/deployment reference](../Documentation/Tac-On-Engine.md):
the new approval/inbox tables require additive production schema synchronization
when publishing Eagle Bot itself, **without copying or overwriting academy data**.
Publishing a Tac-On package is not permission to run production migrations.
