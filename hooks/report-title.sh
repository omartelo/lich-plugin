#!/bin/sh
# Reports the provider's own session title to lich.
# Contract: docs/session-title.md
# stdin: hook payload (JSON with "transcript_path").
#
# `once` is how the in-turn registrations run it: report at most one title per
# session, then stop looking. Without it — the Stop registration — every call
# scans, which is what carries a later retitle.

# Outside lich (vars absent) → no-op. Safe to install globally.
[ -n "$LICH_PORT" ] && [ -n "$LICH_TOKEN" ] && [ -n "$LICH_SESSION_ID" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

# Checked before stdin is read, because it is the whole point: finding a title
# means scanning a transcript that grows all turn — 324ms on a 168MB one — and
# the in-turn registration fires on every tool call. Claude writes the title ~3s
# into the turn, so the first scan that finds it is the last one worth paying
# for. The file is empty; its existence is the signal.
latch=""
if [ "$1" = "once" ]; then
  latch="${TMPDIR:-/tmp}/lich-title-${LICH_SESSION_ID}"
  [ -e "$latch" ] && exit 0
fi

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
    | head -n 1)
fi

# Antigravity: names a thread after its first USER_INPUT content.
if [ -z "$title" ]; then
  title=$(grep '"type":"USER_INPUT"' "$transcript_path" 2>/dev/null \
    | head -n 1 | jq -r '.content // empty' 2>/dev/null \
    | sed -e 's/<USER_REQUEST>//g' -e 's/<\/USER_REQUEST>//g' \
    | sed -n '/[^[:space:]]/{p;q}')
fi

# lich rejects a blank title (400): a Codex first line can be nothing but
# spaces, and an ai-title could in principle be padded. Trim before deciding
# there is a title at all — command substitution above only ate the newlines.
title=$(printf '%s' "$title" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
[ -n "$title" ] || exit 0

# Capped to a card's worth, in jq rather than with `cut -c`: a hook inherits
# whatever locale the harness spawned it with, and `cut -c` counts bytes under a
# C locale — enough to slice a title mid-character and put a replacement glyph on
# the card. Nothing errors when that happens (jq substitutes, lich accepts, the
# hook exits 0), so it shows up only as a mangled tail, and only on a title long
# enough to cut. That makes it a bug that a title written in English never sees.
# jq slices by codepoint whatever the locale, and it is already required above.
body=$(jq -cn --arg sid "$LICH_SESSION_ID" --arg title "$title" \
  '{session_id: $sid, title: ($title[0:80])}')

# -f so a refusal counts as one: a title lich did not take is one worth looking
# for again on the next tool call, where latching on it would wait for Stop.
if curl -sf -o /dev/null --max-time 1 \
  -X POST "http://127.0.0.1:${LICH_PORT}/session-title?token=${LICH_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$body"
then
  [ -n "$latch" ] && : >"$latch" 2>/dev/null
fi

# Never blocks or fails the turn.
exit 0
