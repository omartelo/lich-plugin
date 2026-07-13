# Hook: session start

Client side of the [session-start contract](https://github.com/omartelo/lich/blob/main/docs/hooks/session-start.md)
— the contract (transport, endpoint, payload, accepted values) is defined in
the lich repository; this plugin only implements it.

Reports Claude Code's own session id so lich can persist the link between its
session (the card) and the Claude session running inside it.

| Claude Code hook | script                    | action                          |
|------------------|---------------------------|---------------------------------|
| `SessionStart`   | `report-session-start.sh` | send Claude's `session_id`      |

`POST /session-start` with `{"session_id": $LICH_SESSION_ID,
"claude_session_id": <session_id from the hook payload on stdin>}`.

`SessionStart` fires on startup, resume, `/clear` and compaction; each report
overwrites the stored id, so lich always holds the session currently in the
card. Requires `jq`; absent → no-op.
