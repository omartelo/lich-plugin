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

payload=$(cat)
command -v jq >/dev/null 2>&1 && has_jq=1 || has_jq=

# Prefer jq; fall back to sed so the hook works on Windows, where jq is usually
# absent but sed (Git Bash) is not. A tool name is an identifier, so sed reading
# it out of the raw payload is safe in a way arbitrary text would not be.
if [ -n "$has_jq" ]; then
  tool=$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null)
else
  tool=$(printf '%s' "$payload" | \
    sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
fi
[ -n "$tool" ] || exit 0

# What the call is about, taken from whichever field the harness filled rather
# than from the tool's name: one rule then covers both, because a Codex shell
# call arrives as `Bash` with the same `command` field Claude Code uses. Only
# with jq — the value is arbitrary text, and a hand-built body cannot escape it.
#
# `apply_patch` is the exception. Codex passes the whole patch as the command,
# so the plain rule would put "*** Begin Patch" on the card; the file the patch
# names is the readable half of it. A patch touching several files shows the
# first, which is the one the eye would land on anyway.
#
# A path is shortened against the session's own directory, because a card is
# 240px wide and both harnesses report absolute ones: a full path fills the line
# with the part every card shares. Outside that directory only the file name is
# left, which at least names the file. Commands are never shortened — a leading
# slash there belongs to a binary, not to a path worth cutting.
detail=""
if [ -n "$has_jq" ]; then
  detail=$(printf '%s' "$payload" | jq -r '
    .cwd as $cwd
    | def short: if ($cwd // "") != "" and startswith($cwd + "/") then ltrimstr($cwd + "/")
                 elif startswith("/") then sub(".*/"; "")
                 else . end;
      (.tool_input // {})
    | if ((.command? // "") | tostring) != "" then
        (.command | tostring
         | if startswith("*** Begin Patch")
           then ((capture("\\*\\*\\* (?:Add|Update|Delete) File: (?<p>[^\n]*)") // {}) | .p // "")
           else . end)
      else
        ((.file_path? // .path? // .pattern? // .url? // .query? // "") | tostring | short)
      end' 2>/dev/null | head -n 1)
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
