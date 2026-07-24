# Hook: session start

Client side of the [session-start contract](https://github.com/omartelo/lich/blob/main/docs/hooks/session-start.md)
— the contract (transport, endpoint, payload, accepted values) is defined in
the lich repository; this plugin only implements it.

Reports Claude Code's own session id so lich can persist the link between its
session (the card) and the Claude session running inside it. lich stores it as
the *provider* session id — the field is provider-agnostic, Claude Code is just
the only provider reporting one today.

| Claude Code hook | script                    | action                          |
|------------------|---------------------------|---------------------------------|
| `SessionStart`   | `report-session-start.sh` | send Claude's `session_id`      |

`POST /session-start` with `{"session_id": $LICH_SESSION_ID,
"provider_session_id": <session_id from the hook payload on stdin>}`.

Sent as `claude_session_id` up to v0.2.0; lich still accepts that alias for
older plugins, but this plugin no longer sends it.

`SessionStart` fires on startup, resume, `/clear` and compaction; each report
overwrites the stored id, so lich always holds the session currently in the
card. Uses `jq` to read the payload when present, and falls back to `sed`
otherwise — so it also works on Windows, where `jq` is usually absent.

The report doubles as proof that Claude runs in that PTY, so lich also marks
the card as running Claude (its icon) until the mark is cleared — which is what
[`SessionEnd → idle`](session-state.md) does on the session-state contract.
Nothing extra to send: both hooks already ship.
