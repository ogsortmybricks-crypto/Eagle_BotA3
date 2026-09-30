---
name: Drizzle push prompts
description: A non-interactive Drizzle schema push can appear successful while leaving the database unchanged.
---

When reviewing a Drizzle schema push in this Replit shell, `--strict` prints the proposed changes and a confirmation selector but can exit with code 0 without applying them. Piping arrow-key input did not make it apply.

**Why:** The shell does not provide the interactive terminal expected by the confirmation prompt, so command success alone is misleading.

**How to apply:** First inspect a strict/verbose preview for data-loss or destructive changes. If the proposed changes are safe and additive, run the normal verbose push, then independently verify the resulting database schema. Never use `--force` to bypass a destructive warning.