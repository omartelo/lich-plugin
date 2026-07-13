# lich ⇄ plugin communication contract

## Transport

HTTP loopback. lich injects into the environment of every PTY (inherited by `claude` and its hooks):

| Var               | Purpose                      |
|-------------------|------------------------------|
| `LICH_PORT`       | endpoint port (loopback)     |
| `LICH_TOKEN`      | auth token                   |
| `LICH_SESSION_ID` | target session/card id       |

## Request

```
POST http://127.0.0.1:${LICH_PORT}/hook?token=${LICH_TOKEN}
Content-Type: application/json

{"session_id": "<LICH_SESSION_ID>", "state": "<busy|done>"}
```

States: only `busy` and `done`. The backend rejects anything else.

Responses: `204` ok · `401` invalid token · `400` invalid body.

## Event → state mapping

| Hook               | state  |
|--------------------|--------|
| `UserPromptSubmit` | `busy` |
| `Stop`             | `done` |

## Client rules

- Missing vars (outside lich) → no-op, exit 0. Safe to install globally.
- ~1s timeout, errors swallowed, always exit 0. Never blocks or fails the turn.
