# JavaScript and TypeScript Tac-On programs

Tac-Script is the integration and permission layer. Write feature logic in
JavaScript or TypeScript and keep it in your uploaded package, not Eagle Bot's
source tree. Programs are installed and versioned with their Tac-On.

Upload the folder in either **Dev menu → Upload folder** or the developer
portal's **Publish a Tac-On** screen. Both editors let you add, edit and remove
code files. Publishing compiles the package on the server without executing it.
Missing files, invalid imports and syntax errors block publication. Code files
are retained with the immutable published version; reopening your learner Dev
menu listing restores them.

## A working package

```text
my-package/
  main.tacon
  src/
    main.ts
    labels.js
    theme.css
```

`main.tacon`:

```tacon
tacon coded-notes {
  name "Coded notes"
  version 1.0.0

  store note {
    field title text required
  }

  page home {
    title "My coded page"
    nav true

    program "src/main.ts" {
      read note
      submit 1
      height 400
    }

    form "Save note" {
      into note
      ask title
      allow learner, guide, admin
    }
  }
}
```

Widget indexes start at **zero** and include every widget, including the
program. Here the program is index 0 and the native form is index 1.
`submit 1` permits that program to submit that form on the same page. It does
not grant authority beyond the form's own audience, visibility, required fields
or confirmation requirements.

`src/labels.js`:

```js
export const heading = "Notes written with real JavaScript";
```

`src/theme.css`:

```css
h2 { color: #004aad; }
.notes { display: grid; gap: 12px; }
input { padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; }
```

`src/main.ts`:

```ts
import { heading } from "./labels.js";
import css from "./theme.css";

// This small type is optional. Use your own local types and tsc for semantic
// type checking; the publishing compiler transpiles TS and checks syntax/imports.
type Eagle = {
  viewer: { id: number; name: string; role: string };
  read(store: string): Record<string, unknown>[];
  styles(css: string): void;
  render(tree: unknown): void;
  on(event: string, handler: (event: { values: Record<string, unknown> }) => unknown): void;
  submit(index: number, values: Record<string, unknown>): Promise<unknown>;
};

export default function(eagle: Eagle) {
  const notes = eagle.read("note");
  eagle.styles(css);
  eagle.render({
    tag: "section",
    attrs: { class: "notes" },
    children: [
      { tag: "h2", text: heading },
      { tag: "p", text: `${notes.length} notes saved` },
      { tag: "input", attrs: { name: "title", placeholder: "Write a note" } },
      { tag: "button", text: "Save", action: "save" },
      { tag: "ul", children: notes.map(note => ({
        tag: "li", text: String(note.title),
      })) },
    ],
  });
  eagle.on("save", async ({ values }) => {
    await eagle.submit(1, values);
    // Eagle Bot refetches the native view and restarts the program with fresh data.
  });
}
```

## Runtime API

- `viewer`: the signed-in viewer's id, name and role; never session credentials.
- `read(store)`: a cloned snapshot of a declared, package-owned store for this
  installation. No built-in/foreign stores or undeclared reads. Read data is
  shared with viewers allowed to open the containing page, panel or position
  desk; do not use a broadly visible store for private personal records.
- `render(tree)`: draw a safe UI tree. Nodes have `tag`, optional `text`,
  `attrs`, `children`, and an `action` event name.
- `styles(css)`: apply package CSS inside the isolated frame. CSS imports return
  strings; they are not automatically injected.
- `on(name, handler)`: handle a named UI event. Buttons emit clicks, inputs and
  selects emit changes, and forms emit submits. Events include `values` from
  named inputs and the triggering element's `value`.
- `submit(index, values)`: submit a declared native Tac-Script form. Errors reject
  the promise. The host fixes the installation and page/panel/position context;
  code cannot choose a different academy, studio or URL. Personal confirmation
  codes are intentionally not available to programs: use the native form for
  actions that require those codes.
- `h` / `Fragment`: a small JSX factory. JSX/TSX can call
  `eagle.render(<section><button action="save">Save</button></section>)` inside
  the exported function. Function components can return UI trees; use named
  `action` handlers rather than JavaScript DOM event attributes.

Allowed UI elements include headings, text, sections, lists, tables, forms,
inputs, selects, buttons, progress bars, details, and code blocks. Standard safe
attributes include names, values, classes, labels and input constraints.
`className` is supported by the JSX factory. Scripts, raw HTML, URL attributes,
frames, image elements and browser DOM event attributes are not accepted.

## Isolation and limits

This is **full browser JavaScript/TypeScript logic**, not a Node.js server
runtime or a React DOM host. You can use classes, modules, promises, collections,
calculations, state and event handlers. Code runs in a worker inside an
opaque-origin, scripts-only iframe. It cannot access Eagle Bot's DOM, cookies,
session, database connections, filesystem, secrets or arbitrary API endpoints.
Network access is blocked by the sandbox's Content Security Policy.

Local relative imports are bundled exclusively from the uploaded files.
Prebundle worker-compatible third-party libraries into local files yourself.
Bare npm imports, Node built-ins, remote imports and filesystem imports fail
publication. Package install scripts are never run. Do not upload credentials.

Limits: 40 code files, 500 KB total source code, 200 KB per code file, 1 MB per
compiled entry / 2 MB combined bundles, 500 KB per data view/message, 50 KB CSS,
1,500 UI nodes and 25 levels of nesting. `height` is 120–1200 pixels.
Bridge submission requests are rate-limited, and a nonresponsive worker is
terminated after roughly five seconds. These safeguards are not a general
server-compute service or a guarantee against every possible browser resource
exhaustion issue.

No schema migration is required: package files and bundles are stored in the
existing version manifest. Existing declarative Tac-Ons remain valid.
Republish Eagle Bot before using this syntax on the live site; uploading a
folder cannot update an older deployed compiler.
