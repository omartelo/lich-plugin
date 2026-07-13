#!/bin/sh
# Reports the Claude Code session id to lich. Contract: docs/session-start.md
# stdin: Claude Code hook payload (JSON with "session_id").

# Outside lich (vars absent) → no-op. Safe to install globally.
[ -n "$LICH_PORT" ] && [ -n "$LICH_TOKEN" ] && [ -n "$LICH_SESSION_ID" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

claude_session_id=$(jq -r '.session_id // empty' 2>/dev/null)
[ -n "$claude_session_id" ] || exit 0

body=$(jq -cn --arg sid "$LICH_SESSION_ID" --arg csid "$claude_session_id" \
  '{session_id: $sid, claude_session_id: $csid}')

curl -s -o /dev/null --max-time 1 \
  -X POST "http://127.0.0.1:${LICH_PORT}/session-start?token=${LICH_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$body" \
  || true

# Never blocks or fails the turn.
exit 0
