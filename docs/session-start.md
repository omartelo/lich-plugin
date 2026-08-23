# Hook: session start

Client side of the [session-start contract](https://github.com/omartelo/lich/blob/main/docs/hooks/session-start.md)
— the contract (transport, endpoint, payload, accepted values) is defined in
the lich repository; this plugin only implements it.

Reports the agent CLI's own session id so lich can persist the link between its
session (the card) and the agent session running inside it. lich stores it as
the *provider* session id — the field is provider-agnostic.

| script                             | action                          | Claude Code hook | Codex hook     | Antigravity hook | opencode event    | omp event       | Crush hook   |
|------------------------------------|---------------------------------|------------------|----------------|------------------|-------------------|-----------------|--------------|
| `report-session-start.sh <provider>` | send the CLI's `session_id`   | `SessionStart`   | `SessionStart` | `PreInvocation`  | `session.created` | `session_start` | `PreToolUse` |

`POST /session-start` with `{"session_id": $LICH_SESSION_ID,
"provider_session_id": <session_id/conversationId from the hook payload on stdin>, "provider":
<$1>}`.

The provider id comes from the registration, not from the payload: the scripts
are shared, the hook files are not, so `hooks.json` passes `claude`,
`codex-hooks.json` passes `codex`, `antigravity-hooks.json` passes `antigravity` and `crush-hooks.json` passes `crush`.
`opencode/lich.js` and `omp/lich.js` have no registration to read it from and
spell their own.
lich keys the card's icon on it — a hand-run `codex` inside a shell session
marks that card as Codex, not as Claude. An omitted argument defaults to
`claude`, which is also how lich reads a report from a plugin older than this
one.

Sent as `claude_session_id` up to v0.2.0; lich still accepts that alias for
older plugins, but this plugin no longer sends it.

`SessionStart` fires on startup, resume, `/clear` and compaction; each report
overwrites the stored id, so lich always holds the session currently in the
card. All three script harnesses name the field `session_id` on the payload —
Crush included, whose hooks are Claude Code-compatible — so one script serves
them. It uses `jq` to read the payload when present, and falls back to `sed`
otherwise — so it also works on Windows, where `jq` is usually absent.

The module harnesses report from the earliest place each offers. opencode raises
`session.created` before the first turn, as early as `SessionStart`; omp's
`session_start` fires at the same point, and the id itself is read off
`ctx.sessionManager.getSessionId()` rather than off the event, which carries
nothing but its type. **Crush only has `PreToolUse`**, so its id rides the first
tool call and a conversation that answers without a tool never sends one — late,
not wrong.

**`omp` is not a registered provider id upstream yet.** This client sends it
because it is the only correct value, and the day lich adds it to its provider
list the card wears omp's icon and resumes with `omp -r <id>` — omp keeps a
session per file, so that check has something to find, unlike opencode's and
Crush's SQLite. Until then lich rejects the report and the card holds no id.

The report doubles as proof that an agent runs in that PTY, so lich also marks
the card as running that provider (its icon) until the mark is cleared — which
is what [`SessionEnd → idle`](session-state.md) does on the session-state
contract. Nothing extra to send: both hooks already ship.

The id is what a restored lich card resumes from — `claude --resume <id>` or
`codex resume <id>`, chosen by the card's kind. lich only offers the prompt
while the conversation is still on disk, so an id whose transcript the provider
has pruned starts a fresh session instead of failing in the PTY. That check is
also why opencode and Crush report an id lich stores and does not yet act on:
both keep their conversations in SQLite, where there is no per-session file to
find.
