# Hook: session title

Client side of the [session-title contract](https://github.com/omartelo/lich/blob/main/docs/hooks/session-title.md)
— the contract (transport, endpoint, payload, accepted values) is defined in
the lich repository; this plugin only implements it.

Reports the title the agent CLI gives its own session, so lich can name the
session card after it. lich only applies it while the card's label is still
automatic, so re-sending on every `Stop` is idempotent.

| script            | action                    | Claude Code hook | Codex hook | opencode event    | Crush hook |
|-------------------|---------------------------|------------------|------------|-------------------|------------|
| `report-title.sh` | send the session's title  | `Stop`           | `Stop`     | `session.updated` | —          |

`POST /session-title` with `{"session_id": $LICH_SESSION_ID, "title": <title>}`.
Both providers keep the title in the transcript file (`transcript_path` on
stdin), in their own shape — the script reads whichever is there:

- **Claude Code** — the last line matching `"type":"ai-title"`, field
  `aiTitle`. An actual generated title.
- **Codex** — the first `user_message` event, field `payload.message`, first
  line, cut to 80 characters. Codex generates no title: it names a thread after
  its first user message verbatim (`threads.title` in its state database), so
  this reports the same label Codex shows, only trimmed to card size.

Both formats are internal and undocumented — extraction failures are swallowed
and the hook no-ops. Requires `jq`; absent → no-op.

- **opencode** — no transcript to read: `session.updated` carries the whole
  session, title included, so `opencode/lich.js` forwards it. The title a
  session is created with is a placeholder built from its timestamp, so the
  module keeps that first value and reports only a title that differs from it.
  It arrives more than once per turn, which the idempotence above covers.
- **Crush** — nothing to report. Its one event, `PreToolUse`, is about the tool;
  a Crush card keeps the name lich gave it.
