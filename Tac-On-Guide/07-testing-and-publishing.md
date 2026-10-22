# Testing and publishing

There's no separate test environment. You test in the real app, safely, by
publishing as a **Draft**, which only your own academy can see.

How much of this you do yourself depends on the access the user gives you.
Without an Eagle Bot account, hand the user the app folder and the steps
below, and ask them to paste back exactly what the checklist and the app show.

## 1. Check it on your own computer first

Most of your app is ordinary HTML and JavaScript, so you can open
`index.html` in a browser while you build. `window.EagleBot` won't exist
there. A small stand-in at the top of a test page lets you click through:

```html
<script>
  // Test stand-in only — never put this in the folder you publish.
  window.EagleBot = window.EagleBot || {
    user: { id: 1, name: "Test Learner", email: null, role: "learner" },
    academy: { id: 1, name: "Test Academy" }, studio: null, display: "inline",
    tacon: { installId: 0, name: "Test", version: "0.0.0", icon: "🧪" },
    api: (() => {
      const records = []; let next = 1;
      return {
        getRecords: async (o) => records.filter((r) => !o?.store || r.store === o.store).slice().reverse(),
        createRecord: async (data, o) => { const r = { id: next++, store: o?.store ?? "records", data, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: 1, created_by_name: "Test Learner" }; records.push(r); return r; },
        updateRecord: async (id, data) => Object.assign(records.find((r) => r.id === id), { data }),
        deleteRecord: async (id) => { records.splice(records.findIndex((r) => r.id === id), 1); return { ok: true }; },
      };
    })(),
    positions: { list: async () => [] }, members: { list: async () => [] },
  };
</script>
```

Remember what the stand-in can't show you: the sandbox (no network, no
`localStorage`, no CDN scripts) and the server saying no.

## 2. Check

**Dev menu → New Tac-On → Choose folder.** Eagle Bot bundles the folder on
your device and shows:

- the files it read (and how many it left out),
- the manifest as admins will see it, with every setup action,
- a checklist: every line has to be ✓ before **Publish** unlocks.

**Ready to publish** means it will publish. It doesn't mean it works. See the
traps in [06](06-limits-and-workarounds.md).

## 3. Publish a Draft

**Publish** with visibility **Draft**. Only your academy sees it in the
market.

Published versions are frozen, so each new test needs a new `version` in
`manifest.json`. Use patch numbers while testing (`0.1.0`, `0.1.1`,
`0.1.2` ...). Save `1.0.0` for the first version other academies will see.

## 4. Install it somewhere harmless

As an admin: **Tac-Ons → Market**, open your Tac-On, **Install** into one
studio (not academy-wide). Check the install screen lists your setup actions
the way you meant: required ones under "What will be created", optional ones
as tickboxes with your `prompt` and `why`.

Then check what setup did: the positions on **Positions**, the wiki section in
the **Wiki**. Install it once more somewhere else with the optional boxes
unticked, and check your app copes (the "finish setting up" card).

## 5. Use it as each kind of person

| As | Check |
| --- | --- |
| **Admin** | Installing, setup, everything they're allowed to do, including admin-only tools in your app |
| **Learner** | What they see. Anything they can't do is hidden, or fails with a clear message rather than a blank screen. |
| **The position holder** | Appoint someone on **Positions**. Their tools appear in your app; the next person's do when the term changes. |
| **Another learner** | They can't change or delete someone else's record. Your app shows Eagle Bot's message when they try. |
| **Someone in another studio** | A studio install doesn't appear for them at all |
| **Guide** | They aren't accidentally made the keeper of something learners should own |

Then:

- **Watch for the yellow box.** "This app hit an error" above your app means
  an uncaught error. Fix every one.
- **Try the narrow column** (a Chromebook, or a phone), and full screen if you
  use it: **Exit full screen**, Escape, and **Open full screen** again.
- **Type something nasty.** A topic called `<b>hi</b>` should show exactly
  that, not bold text.
- **Try the update path.** With records saved, raise the version, publish,
  press **Update** on the install, and check the old records still display
  correctly.

## 6. Publish for real

Once it works:

1. Set `version` to `1.0.0`, or the next proper version for an update.
2. Publish as **Unlisted** (anyone with the link) to let one other academy try
   it, then **Public** for everyone.
3. Fill in the listing's blurb and details, written for an admin deciding
   whether to install it.

**Official Tac-Ons**, from Eagle Bot's maintainers, are published from the dev
portal (Ctrl+D): **Tac-Ons → Publish official**, then choose the folder or a
`.taconapp` file. The server checks it before **Publish official** unlocks.

## Versioning rules

- Raise `version` on every publish. Patch for wording and fixes, minor for new
  features, major when installs need care.
- **Never rename a store or a `data` key that already has records.** Add a new
  key, keep reading the old one.
- Keep `name` forever. A different name is a different Tac-On, with none of
  the old one's records.
- Changing a `createPosition` title makes a *new* position on update (titles
  are how setup recognises them). Say so in the changelog, or keep the title.
- Academies move to a new version only when they press **Update**. Tell them
  what changed and why it's worth it.
- Never tell anyone to remove and reinstall. **Removing deletes every
  record.**

## Keep your source

The live app keeps only the bundled version. Keep the folder itself, with a
short README (what it does, who sees what, setup, version history), in your
own workspace, so you can publish the next version. An admin's **Export** gives
back the bundled `.taconapp` if the folder is ever lost.
