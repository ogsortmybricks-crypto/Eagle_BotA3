---
name: Tac-On contract evolution
description: Compatibility and approval decisions for changes to installed Tac-On behavior.
---

Keep legacy native packages working rather than silently reinterpreting their
permissions when the engine gains a new contract. New interop privileges require
an explicit contract and installer grants; backward compatibility is not a
reason to give old code newly invented APIs.

**Why:** The major engine reconfiguration explicitly required preserving existing
functionality and installation data. Requiring every existing publisher to
rewrite a package would turn an engine update into an academy outage.

**How to apply:** Leave installed versions pinned. Review upgrades against the
exact immutable version, show new capabilities and setup before mutation, and
keep installer approvals separate from package-editable configuration. Preserve
record/seat history on updates and retries; destructive uninstall remains a
separate, clearly explained action.
