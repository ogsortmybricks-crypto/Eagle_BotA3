---
name: Replit Vite preview hosts
description: Vite dev servers must accept Replit's changing proxied preview hostname.
---

Configure Vite's development server with `server.allowedHosts: true` for Replit preview use.

**Why:** Replit previews arrive through a generated `*.replit.dev` host, which Vite rejects by default.

**How to apply:** Include this setting in Vite projects before diagnosing a blank or blocked preview as an application failure.