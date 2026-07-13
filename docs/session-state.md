# Hook: session state

Client side of the [session-state contract](https://github.com/omartelo/lich/blob/main/docs/hooks/session-state.md)
— the contract (transport, endpoint, payload, accepted values) is defined in
the lich repository; this plugin only implements it.

Reports the session's processing state so the lich card shows a spinner while
Claude works and a check when the turn ends.

| Claude Code hook   | script                 | state  |
|--------------------|------------------------|--------|
| `UserPromptSubmit` | `report-state.sh busy` | `busy` |
| `Stop`             | `report-state.sh done` | `done` |

`POST /hook` with `{"session_id": $LICH_SESSION_ID, "state": "busy"|"done"}`.
