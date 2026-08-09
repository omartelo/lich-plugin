#!/bin/sh
# Reports the agent CLI's session id to lich. Contract: docs/session-start.md
# $1: which provider is reporting (lich provider id); defaults to claude.
# stdin: hook payload (JSON with "session_id").

# Outside lich (vars absent) → no-op. Safe to install globally.
[ -n "$LICH_PORT" ] && [ -n "$LICH_TOKEN" ] && [ -n "$LICH_SESSION_ID" ] || exit 0
provider=${1:-claude}
# Parse session_id from the stdin payload. Prefer jq; fall back to sed so the
# hook works on Windows, where jq is usually absent but sed (Git Bash) is not.
if command -v jq >/dev/null 2>&1; then
  provider_session_id=$(jq -r '.session_id // empty' 2>/dev/null)
else
  provider_session_id=$(sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
fi
[ -n "$provider_session_id" ] || exit 0

# Values are ids (UUID / lich-controlled / this file's own literal), no JSON
# escaping needed — same trust model as report-state.sh.
body="{\"session_id\":\"${LICH_SESSION_ID}\",\"provider_session_id\":\"${provider_session_id}\",\"provider\":\"${provider}\"}"

curl -s -o /dev/null --max-time 1 \
  -X POST "http://127.0.0.1:${LICH_PORT}/session-start?token=${LICH_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$body" \
  || true

# Never blocks or fails the turn.
exit 0
