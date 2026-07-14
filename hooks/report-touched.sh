#!/bin/sh
# Signals that this session likely changed files on disk, so lich refreshes
# its git status ahead of the poll. Contract: docs/session-touched.md

# Outside lich (vars absent) → no-op. Safe to install globally.
[ -n "$LICH_PORT" ] && [ -n "$LICH_TOKEN" ] && [ -n "$LICH_SESSION_ID" ] || exit 0

curl -s -o /dev/null --max-time 1 \
  -X POST "http://127.0.0.1:${LICH_PORT}/session-touched?token=${LICH_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "{\"session_id\":\"${LICH_SESSION_ID}\"}" \
  || true

# Never blocks or fails the turn.
exit 0
