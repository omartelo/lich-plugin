#!/bin/sh
# Reports the tool the agent is about to run, so lich's card can name it.
# Contract: docs/session-state.md
# stdin: PreToolUse payload (JSON with "tool_name" and "tool_input").
#
# PreToolUse is the one event on the agent's critical path: a hook exiting 2
# there *blocks the tool call* in both harnesses. Everything below swallows its
# own failures and exits 0, which is load-bearing here rather than merely tidy.

# Outside lich (vars absent) → no-op. Safe to install globally.
[ -n "$LICH_PORT" ] && [ -n "$LICH_TOKEN" ] && [ -n "$LICH_SESSION_ID" ] || exit 0

here=$(dirname "$0")
payload=$(cat)
command -v jq >/dev/null 2>&1 && has_jq=1 || has_jq=

# Prefer jq; fall back to sed so the hook works on Windows, where jq is usually
# absent but sed (Git Bash) is not. A tool name is an identifier, so sed reading
# it out of the raw payload is safe in a way arbitrary text would not be.
if [ -n "$has_jq" ]; then
  tool=$(printf '%s' "$payload" | jq -r '.toolCall.name // .tool_name // empty' 2>/dev/null)
else
  tool=$(printf '%s' "$payload" | \
    sed -n -e 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
           -e 's/.*"toolCall"[[:space:]]*:[[:space:]]*{[^}]*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
fi
[ -n "$tool" ] || exit 0

# What the call is about, taken from whichever field the harness filled rather
# than from the tool's name — detail.jq, shared with the waiting report. Only
# with jq: the value is arbitrary text, and a hand-built body cannot escape it.
detail=""
if [ -n "$has_jq" ]; then
  detail=$(printf '%s' "$payload" | jq -r -f "$here/detail.jq" 2>/dev/null | head -n 1)
fi

# The detail is omitted rather than sent empty: the contract's optional field is
# absent when there is nothing to say.
if [ -n "$detail" ]; then
  body=$(jq -cn --arg sid "$LICH_SESSION_ID" --arg tool "$tool" --arg detail "$detail" \
    '{session_id: $sid, state: "busy", tool: $tool, detail: $detail}')
else
  body="{\"session_id\":\"${LICH_SESSION_ID}\",\"state\":\"busy\",\"tool\":\"${tool}\"}"
fi

curl -s -o /dev/null --max-time 1 \
  -X POST "http://127.0.0.1:${LICH_PORT}/hook?token=${LICH_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$body" \
  || true

# Never blocks or fails the turn.
exit 0
