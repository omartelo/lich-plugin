# Hook: session touched

Client side of the [session-touched contract](https://github.com/omartelo/lich/blob/main/docs/hooks/session-touched.md)
— the contract (transport, endpoint, payload, accepted values) is defined in
the lich repository; this plugin only implements it.

Signals that the session likely changed files on disk, so lich refreshes that
session's git status immediately instead of waiting for its ~3s poll. Latency
optimization only — without the plugin the poll catches the same changes, up
to a poll interval later.

| script              | Claude Code hook                                        | Codex hook                                              |
|---------------------|---------------------------------------------------------|---------------------------------------------------------|
| `report-touched.sh` | `PostToolUse` matcher `Edit\|Write\|NotebookEdit\|Bash`  | `PostToolUse` matcher `apply_patch\|Edit\|Write\|Bash`  |

`POST /session-touched` with `{"session_id": $LICH_SESSION_ID}`.

The matcher is deliberate: only tools that write to disk. Read-only tools
(`Read`, `Grep`, `Glob`) must not fire it — a git-status refresh per read
would cost more than the poll it front-runs. No stdin parsing, no `jq`.

Codex writes files through `apply_patch` rather than `Edit`/`Write`, and runs
commands as `Bash`; `Edit` and `Write` stay in its matcher because Codex
accepts them as aliases for `apply_patch`, so the same intent holds if a tool
is renamed.
