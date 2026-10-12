#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Restore exactly the merged lockfile's dependencies without interactive prompts.
npm ci --no-audit --no-fund
npm run check
npm run build

# Database changes require review; do not mutate development or production
# schemas automatically, force destructive pushes, or overwrite academy data.
echo "Post-merge setup complete. Review any database schema changes separately."
