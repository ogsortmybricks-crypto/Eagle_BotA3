---
name: Browser testing fallback
description: Environment-specific fallback when documented browser testing callbacks are unavailable.
---

The documented testing subagent kind was rejected as unsupported in this
environment. An existing Chromium executable plus the Python websocket client
successfully drove the protected portal through CDP, including native directory
file selection.

**Why:** A screenshot cannot inspect an authenticated import modal, and the
workspace did not have Playwright or Puppeteer installed. The existing browser
tools avoided adding browser libraries to this application's dependencies.

**How to apply:** Try the documented testing interface first; availability may
change. If it is unavailable, check for an existing Chromium/CDP client before
installing dependencies. Authenticate temporary test accounts through the real
login endpoint, and clean up only their own accounts, sessions and fixtures.
Running Python may auto-add a Python module to `.replit`; remove that extra test
runtime when finished if the application itself is still Node-only.