#!/bin/sh
# Reports Claude's auto-generated session title (ai-title) to lich.
# Contract: docs/session-title.md
# stdin: Claude Code hook payload (JSON with "transcript_path").

# Outside lich (vars absent) → no-op. Safe to install globally.
[ -n "$LICH_PORT" ] && [ -n "$LICH_TOKEN" ] && [ -n "$LICH_SESSION_ID" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

transcript_path=$(jq -r '.transcript_path // empty' 2>/dev/null)
[ -f "$transcript_path" ] || exit 0

# ai-title is an internal transcript line; swallow extraction failures.
title=$(grep '"type":"ai-title"' "$transcript_path" 2>/dev/null | tail -n 1 \
  | jq -r '.aiTitle // empty' 2>/dev/null)
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
