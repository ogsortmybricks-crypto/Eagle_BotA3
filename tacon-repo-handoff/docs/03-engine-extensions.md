# Engine extensions

Read this only when a Tac-On needs something TacScript can't express. Most
don't.

## What an extension is

An extension is **trusted TypeScript** that adds keywords to TacScript and
renders them with custom server logic and React screens. Accountability Partners
is the reference example: the `partners ap { ... }` block, the pairing screen,
check-ins, screenshot uploads, certified work and public `/ap/verify/:token`
pages are all extension code.

Extensions are not uploaded. They're **compiled into Eagle Bot's build**. Eagle
Bot discovers them from its own `built-tacons/<id>/` folder at build time
(`npm run tacons:generate`, which runs before `dev`, `check` and `build`). So:

- An extension only works on a server whose deployed engine includes it.
- Only maintainers can ship one. Learner devs can't.
- The `.tacon` that uses it still publishes normally. It declares
  `extension <id>`, and compiles only on an engine that has that extension.

## Where the code lives

Extensions are developed **here**, in the same layout they'll have in the
engine, and copied into the engine's `built-tacons/<id>/` to ship:

```
tacons/<id>/
  extension.json            # { "id", "compiler", "server", "client" }
  extension.compiler.ts     # default export: TaconCompilerExtension
  extension.server.ts       # default export: TaconServerExtension
  extension.client.tsx      # default export: ClientExtension
  <id>.tacon                # declares `extension <id>`
  shared/  server/  client/ # package-owned implementation
  sandbox.test.mjs          # scenario test against the sandbox
  architecture.test.ts      # asserts no package code leaks into the engine
  README.md
```

To try an extension in the sandbox before it ships, ask for it to be copied
into the engine's `built-tacons/` (an engine request), or, while this folder
lives inside the engine repo, copy it there yourself on a branch. Then
`testing/sandbox up` registers it and `try` exercises it like any other
Tac-On. Use `tacon-test.mjs api` to call its routes as different personas.

Package files import engine code by **relative path** from the
`built-tacons/<id>/` location, for example `../../shared/tacons/parse` or
`../../server/tacons/extensions`. Keep those paths exactly as they'll resolve
inside the engine. When this repo's tests need them to resolve, run them from
inside the engine checkout after copying, or symlink the folder in. Don't
rewrite the imports for this repo's layout.

`extension.json` rules (enforced by the generator):

- `id` must equal the folder name and match `^[a-z][a-z0-9-]{1,48}$`.
- `compiler`, `server`, `client` must each be a file named
  `extension.<word>.ts` or `.tsx` that exists.

## The three contracts

These are defined by the engine. Read the current versions there before writing
code. They may have changed since this was written.

**Compiler:** `shared/tacons/extensions.ts → TaconCompilerExtension`

```ts
{
  id: string;
  definitionKeywords: readonly string[];  // top-level blocks, e.g. ["partners"]
  widgetKeywords: readonly string[];      // widgets inside page/position/panel
  compileDefinitions(ctx, nodes): unknown;          // -> manifest.extensions[id]
  compileWidget(ctx, node, configuration): Record<string, unknown> | null;
  describe(manifest): { title; description }[];     // install-review lines
}
```

Report every problem with `ctx.diagnostics.push({ line, column, severity:
"error", message })`. Messages are read by kids. Say what's wrong and show the
right form, for example ``"`due` takes a day of the week, like `due friday`, or
`due none`."``

**Server:** `server/tacons/extensions.ts → TaconServerExtension`

```ts
{
  id: string;
  legacyWidgetKinds?: readonly string[];  // read pre-extension manifests
  render(runtime, configuration, index): Promise<unknown | null>;
  routes?: Router;        // authenticated API
  publicRoutes?: Router;  // unauthenticated (keep minimal)
}
```

`runtime` carries the viewer (`user`, null in hooks), `academyId`, studio
`scope`, the `install`, and the viewer's held positions. Every query must filter
by academy, install and studio scope, and check permissions as the **viewer**.

**Client:** `client/src/tacons/Extensions.tsx → ClientExtension`

```ts
{
  id: string;
  render({ data, target }): ReactNode;   // data = what server render() returned
  publicPages: { path; render(params) }[];
}
```

## Boundary rules

These came from explicit corrections. Treat them as hard requirements.

- **No package feature code in Eagle Bot Main.** Package compiler logic,
  contracts, storage rules, routes and screens all live in the package folder.
  The engine may only gain **generic** interfaces and shared services. An
  `architecture.test.ts` should assert that engine files don't mention your
  package's types, routes or id.
- **Need a new generic capability?** Add an entry to `ENGINE-REQUESTS.md`
  ([04](04-engine-requests.md)) describing the generic interface, not a
  package-specific hook.
- **Reuse core services. Don't duplicate them.** Example: the six-digit account
  confirmation code belongs to Eagle Bot Main. Extensions verify it through the
  shared service. They never read it in plaintext or invent their own codes.
- **Fail closed.** A widget payload for another extension id returns null. A
  `.tacon` naming an extension the engine lacks must fail to compile.
- **Backwards compatibility belongs to the package.** If manifests from earlier
  versions are installed, the package reads both shapes (see
  `legacyWidgetKinds` and the AP `partnerDefinitions()` helper). Keep old URLs
  working.
- **Uploads and public data:** serve files one at a time, only to people who can
  see the record they belong to. Public pages show the minimum and send
  `Cache-Control: no-store` and `X-Robots-Tag: noindex`.

## Database changes

If an extension needs new tables or columns, they go in the engine's
`shared/schema.ts`. That's an engine change, so add it to `ENGINE-REQUESTS.md`. The
engine applies it with `npm run db:push`.

Integration tests that touch a database must run only against an **isolated
development database**, behind an explicit env flag, for example:

```sh
NODE_ENV=development RUN_TACON_<NAME>_DB_TESTS=true npx tsx --test .../<name>.integration.test.ts
```

They create a temporary academy and delete it in `finally`. Never point them at
production.

## Shipping checklist

1. Copy `tacons/<id>/` into the engine's `built-tacons/<id>/`.
2. In the engine: `npm run check`, the package tests, `npm run build`.
3. Engine is published and deployed. Until it is, the live compiler will reject
   `extension <id>`.
4. Publish the `.tacon` (dev portal → Publish official → Choose folder).
5. Academies install, or press **Update** on an existing install. Never remove
   and reinstall, because that deletes records.
