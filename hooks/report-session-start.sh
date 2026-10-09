#!/bin/sh
# Reports the agent CLI's session id to lich. Contract: docs/session-start.md
# $1: which provider is reporting (lich provider id); defaults to claude.
# stdin: hook payload (JSON with "session_id").

# Outside lich (vars absent) → no-op. Safe to install globally.
[ -n "$LICH_PORT" ] && [ -n "$LICH_TOKEN" ] && [ -n "$LICH_SESSION_ID" ] || exit 0

# Sent as X-Lich-Plugin on every report; bumped at release (CLAUDE.md, Release).
plugin_version=0.19.2
provider=${1:-claude}

# A file-shipped install that lacks conversation-id.sh says so and still
# runs: sourcing a missing file would end the script. `${0%/*}` rather than
# dirname: it needs no tool on PATH.
if [ -r "${0%/*}/conversation-id.sh" ]; then
  . "${0%/*}/conversation-id.sh"
else
  echo "lich-plugin: hooks/conversation-id.sh missing; session-start not reported" >&2
  conversation_id() { :; }
fi

payload=$(cat)
provider_session_id=$(printf '%s' "$payload" | conversation_id)
[ -n "$provider_session_id" ] || exit 0

# Values are ids (UUID / lich-controlled / this file's own literal), no JSON
# escaping needed — same trust model as report-state.sh.
body="{\"session_id\":\"${LICH_SESSION_ID}\",\"provider_session_id\":\"${provider_session_id}\",\"provider\":\"${provider}\"}"

curl -s -o /dev/null --max-time 1 \
  -X POST "http://127.0.0.1:${LICH_PORT}/session-start?token=${LICH_TOKEN}" \
  -H 'Content-Type: application/json' \
  -H "X-Lich-Plugin: ${plugin_version}" \
  -d "$body" \
  || true

# Never blocks or fails the turn.
exit 0
