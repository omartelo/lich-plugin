#!/bin/sh
# Reports the provider's own session title to lich.
# Contract: docs/session-title.md
# stdin: hook payload (JSON with "transcript_path").

# Outside lich (vars absent) → no-op. Safe to install globally.
[ -n "$LICH_PORT" ] && [ -n "$LICH_TOKEN" ] && [ -n "$LICH_SESSION_ID" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

transcript_path=$(jq -r '.transcriptPath // .transcript_path // empty' 2>/dev/null)
[ -f "$transcript_path" ] || exit 0

# Claude Code: ai-title is an internal transcript line; swallow extraction
# failures.
title=$(grep '"type":"ai-title"' "$transcript_path" 2>/dev/null | tail -n 1 \
  | jq -r '.aiTitle // empty' 2>/dev/null)

# Codex: no generated title — it names a thread after its first user message,
# which is the rollout's first user_message event. Trimmed to one line so a
# pasted spec still yields a card label.
if [ -z "$title" ]; then
  title=$(grep '"type":"user_message"' "$transcript_path" 2>/dev/null \
    | head -n 1 | jq -r '.payload.message // empty' 2>/dev/null \
    | head -n 1 | cut -c 1-80)
fi

# Antigravity: names a thread after its first USER_INPUT content.
if [ -z "$title" ]; then
  title=$(grep '"type":"USER_INPUT"' "$transcript_path" 2>/dev/null \
    | head -n 1 | jq -r '.content // empty' 2>/dev/null \
    | sed -e 's/<USER_REQUEST>//g' -e 's/<\/USER_REQUEST>//g' \
    | sed -n '/[^[:space:]]/{p;q}' | cut -c 1-80)
fi

# lich rejects a blank title (400): a Codex first line can be nothing but
# spaces, and an ai-title could in principle be padded. Trim before deciding
# there is a title at all — command substitution above only ate the newlines.
title=$(printf '%s' "$title" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
[ -n "$title" ] || exit 0

body=$(jq -cn --arg sid "$LICH_SESSION_ID" --arg title "$title" \
  '{session_id: $sid, title: $title}')

curl -s -o /dev/null --max-time 1 \
  -X POST "http://127.0.0.1:${LICH_PORT}/session-title?token=${LICH_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$body" \
  || true

# Never blocks or fails the turn.
exit 0
