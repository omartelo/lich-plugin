# Hook: session state

Client side of the [session-state contract](https://github.com/omartelo/lich/blob/main/docs/hooks/session-state.md)
— the contract (transport, endpoint, payload, accepted values) is defined in
the lich repository; this plugin only implements it.

Reports the session's processing state so the lich card shows a spinner while
Claude works, a check when the turn ends, and a bell (plus an actionable
toast) when Claude is blocked on the user.

| Claude Code hook   | script                    | state     |
|--------------------|---------------------------|-----------|
| `UserPromptSubmit` | `report-state.sh busy`    | `busy`    |
| `Stop`             | `report-state.sh done`    | `done`    |
| `Notification`     | `report-state.sh waiting` | `waiting` |

`POST /hook` with `{"session_id": $LICH_SESSION_ID, "state":
"busy"|"done"|"waiting"}`.

`Notification` fires when Claude needs a permission decision or has been idle
waiting for input — both mean "your turn". A later `busy` or `done` clears it.
