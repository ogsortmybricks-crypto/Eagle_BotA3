---
name: Roster loading errors
description: Failed directory requests must never masquerade as empty rosters.
---

A failed roster request is not an empty roster. Show a retryable loading error
and disable appointment submission while the roster is unavailable. Do not
relax studio eligibility rules to compensate for missing options.

**Why:** A published schema mismatch made existing accounts appear absent in
both People and appointment controls, even though the accounts still existed.

**How to apply:** Check query error states before using an empty-array fallback
in roster displays and person selectors. Keep genuine empty states separate
from loading failures and preserve server-side academy/studio boundaries.
