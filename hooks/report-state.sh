#!/bin/sh
# Reports session state to lich. Contract: docs/session-state.md
# Usage: report-state.sh <busy|done|waiting|idle>
# stdin: the hook payload — read for the conversation id, and on `waiting` for
# the reason below.

# Outside lich (vars absent) → no-op. Safe to install globally.
[ -n "$LICH_PORT" ] && [ -n "$LICH_TOKEN" ] && [ -n "$LICH_SESSION_ID" ] || exit 0

# Sent as X-Lich-Plugin on every report; bumped at release (CLAUDE.md, Release).
plugin_version=0.19.2

# A file-shipped install that lacks conversation-id.sh says so and still
# runs: sourcing a missing file would end the script. `${0%/*}` rather than
# dirname: it needs no tool on PATH.
if [ -r "${0%/*}/conversation-id.sh" ]; then
  . "${0%/*}/conversation-id.sh"
else
  echo "lich-plugin: hooks/conversation-id.sh missing; reporting without provider_session_id" >&2
  conversation_id() { :; }
fi

state=$1
body="{\"session_id\":\"${LICH_SESSION_ID}\",\"state\":\"${state}\"}"

# Read with the bound curl has below: `busy`, `done` and `idle` ride events
# whose payload only names the conversation, and a harness that left the pipe
# open and unwritten must not hold the turn. The reader's input is fd 3 because
# an asynchronous command's stdin is /dev/null unless redirected, and the timer's
# output goes nowhere so the substitution never waits on it.
exec 3<&0
payload=$(cat <&3 & reader=$!; (exec >/dev/null 2>&1; sleep 1 && kill "$reader") & wait "$reader")
exec 3<&-

# `reason` says what the agent is blocked on, and belongs to `waiting` alone —
# lich drops it on every other state, so no other branch looks for one. It is
# optional in both directions: an absent one still rings the bell, and a value
# lich finds too long is capped there rather than refused, so nothing here
# measures it.
if [ "$state" = waiting ]; then
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

# The conversation that fired the hook, so lich can drop a report from an agent
# CLI nested in the session (docs/session-state.md, Nested agent CLIs). An id
# needs no escaping, and none is left out rather than sent empty.
provider_session_id=$(printf '%s' "$payload" | conversation_id)
[ -n "$provider_session_id" ] && body="${body%\}},\"provider_session_id\":\"${provider_session_id}\"}"

curl -s -o /dev/null --max-time 1 \
  -X POST "http://127.0.0.1:${LICH_PORT}/hook?token=${LICH_TOKEN}" \
  -H 'Content-Type: application/json' \
  -H "X-Lich-Plugin: ${plugin_version}" \
  -d "$body" \
  || true

# Never blocks or fails the turn.
exit 0
