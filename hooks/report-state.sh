#!/bin/sh
# Reports session state to lich. Contract: docs/session-state.md
# Usage: report-state.sh <busy|done|waiting|idle>
# stdin: the hook payload — read for `waiting` alone, for the reason below.

# Outside lich (vars absent) → no-op. Safe to install globally.
[ -n "$LICH_PORT" ] && [ -n "$LICH_TOKEN" ] && [ -n "$LICH_SESSION_ID" ] || exit 0

state=$1
body="{\"session_id\":\"${LICH_SESSION_ID}\",\"state\":\"${state}\"}"

# `reason` says what the agent is blocked on, and belongs to `waiting` alone —
# lich drops it on every other state, so no other branch reads stdin. It is
# optional in both directions: an absent one still rings the bell, and a value
# lich finds too long is capped there rather than refused, so nothing here
# measures it.
if [ "$state" = waiting ]; then
  payload=$(cat)
  if command -v jq >/dev/null 2>&1; then
    # Claude Code's Notification is the one payload carrying a sentence written
    # for a human ("Claude needs your permission to use Bash"), and it writes one
    # for the plain idle-at-the-prompt nudge too — which is a reason as well.
    # `strings` guards against a harness that ever sends something else there,
    # `\S` against whitespace, and `head` keeps it to the one line a card is.
    reason=$(printf '%s' "$payload" | \
      jq -r '.message | strings | select(test("\\S"))' 2>/dev/null | head -n 1)
    if [ -z "$reason" ]; then
      # Codex's PermissionRequest has no message field at all, so its report is
      # the tool it is asking about, qualified with the words the busy report
      # already puts on the card.
      tool=$(printf '%s' "$payload" | jq -r '.toolCall.name // .tool_name // empty' 2>/dev/null | head -n 1)
      detail=$(printf '%s' "$payload" | \
        jq -r -f "$(dirname "$0")/detail.jq" 2>/dev/null | head -n 1)
      if [ -n "$tool" ]; then
        reason=$tool
        [ -n "$detail" ] && reason="$tool: $detail"
      fi
    fi
    [ -n "$reason" ] && body=$(jq -cn --arg sid "$LICH_SESSION_ID" --arg reason "$reason" \
      '{session_id: $sid, state: "waiting", reason: $reason}')
  else
    # Without jq (Windows, usually) the message does not go out: it is arbitrary
    # text, and a hand-built body cannot escape it. A tool name is an identifier
    # and can, which is the whole of what Codex — the harness that needs the
    # Windows wrapper — sends anyway.
    tool=$(printf '%s' "$payload" | \
      sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
    [ -n "$tool" ] && \
      body="{\"session_id\":\"${LICH_SESSION_ID}\",\"state\":\"waiting\",\"reason\":\"${tool}\"}"
  fi
fi

curl -s -o /dev/null --max-time 1 \
  -X POST "http://127.0.0.1:${LICH_PORT}/hook?token=${LICH_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$body" \
  || true

# Never blocks or fails the turn.
exit 0
