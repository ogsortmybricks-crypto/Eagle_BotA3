---
name: Drizzle push prompts
description: A non-interactive Drizzle schema push can appear successful while leaving the database unchanged.
---

When reviewing a Drizzle schema push in this Replit shell, `--strict` prints the proposed changes and a confirmation selector but can exit with code 0 without applying them. Piping arrow-key input did not make it apply.

**Why:** The shell does not provide the interactive terminal expected by the confirmation prompt, so command success alone is misleading.

**How to apply:** First inspect a strict/verbose preview for data-loss or destructive changes. If the proposed changes are safe and additive, run the normal verbose push, then independently verify the resulting database schema. Never use `--force` to bypass a destructive warning.

Apply schema-source changes to the development database before publishing.
Successful builds do not prove that either database matches the schema source.

**Why:** Publish compares the actual development and production schemas, not the
TypeScript schema declarations. Unapplied development changes can leave a
successful published build querying fields absent from both databases.

**How to apply:** For missing-column production errors, inspect both schemas,
apply safe missing changes in development, then ask the user to republish using
schema synchronization without overwriting production data. Do not add
production migration scripts or startup-time schema changes.