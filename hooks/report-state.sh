#!/bin/sh
# Reports session state to lich. Contract: docs/session-state.md
# Usage: report-state.sh <busy|done|waiting>

# Outside lich (vars absent) → no-op. Safe to install globally.
[ -n "$LICH_PORT" ] && [ -n "$LICH_TOKEN" ] && [ -n "$LICH_SESSION_ID" ] || exit 0

curl -s -o /dev/null --max-time 1 \
  -X POST "http://127.0.0.1:${LICH_PORT}/hook?token=${LICH_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "{\"session_id\":\"${LICH_SESSION_ID}\",\"state\":\"$1\"}" \
  || true

# Never blocks or fails the turn.
exit 0
