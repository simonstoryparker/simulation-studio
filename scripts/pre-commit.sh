#!/usr/bin/env bash
set -euo pipefail

# Ensure cargo/rust binaries are available for GUI Git clients or non-interactive shells
if [ -d "$HOME/.cargo/bin" ] && ! command -v cargo >/dev/null 2>&1; then
  export PATH="$HOME/.cargo/bin:$PATH"
fi

DIRTY_BEFORE=$(git diff --name-only)
npm run format
DIRTY_AFTER=$(git diff --name-only)

# Only stage files that were modified by the formatter
CHANGED=$(comm -13 <(echo "$DIRTY_BEFORE" | sort) <(echo "$DIRTY_AFTER" | sort))
if [ -n "$CHANGED" ]; then
  echo "$CHANGED" | xargs git add
fi
