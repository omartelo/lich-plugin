# Hook: session touched

Client side of the [session-touched contract](https://github.com/omartelo/lich/blob/main/docs/hooks/session-touched.md)
— the contract (transport, endpoint, payload, accepted values) is defined in
the lich repository; this plugin only implements it.

Signals that the session likely changed files on disk, so lich refreshes that
session's git status immediately instead of waiting for its ~3s poll. Latency
optimization only — without the plugin the poll catches the same changes, up
to a poll interval later.

| script              | Claude Code hook                                        | Codex hook                                              | Antigravity hook                                        | Crush hook                                             | opencode event | omp event                                        |
|---------------------|---------------------------------------------------------|---------------------------------------------------------|---------------------------------------------------------|--------------------------------------------------------|----------------|--------------------------------------------------|
| `report-touched.sh` | `PostToolUse` matcher `Edit\|Write\|NotebookEdit\|Bash`  | `PostToolUse` matcher `apply_patch\|Edit\|Write\|Bash`  | `PostToolUse` matcher `propose_code\|file_change\|edit_notebook\|write_blob\|delete_directory\|run_command` | `PreToolUse` matcher `^(edit\|write\|multiedit\|bash)$` | `file.edited`  | `tool_result` for `write`/`edit`/`bash`/`notebook` |

`POST /session-touched` with `{"session_id": $LICH_SESSION_ID}`.

The matcher is deliberate: only tools that write to disk. Read-only tools
(`Read`, `Grep`, `Glob`, Crush's `view`) must not fire it — a git-status refresh
per read would cost more than the poll it front-runs. No stdin parsing, no `jq`.

Codex writes files through `apply_patch` rather than `Edit`/`Write`, and runs
commands as `Bash`; `Edit` and `Write` stay in its matcher because Codex
accepts them as aliases for `apply_patch`, so the same intent holds if a tool
is renamed. Crush spells the same set in lower case and anchors the matcher,
because its tool names are whole words (`ls` would otherwise be matched by a
loose `s`).

opencode needs no matcher at all: `file.edited` fires only when a file actually
changed, which is what the matchers above approximate. omp has no such event and
keeps the matcher, in its own lower-case spelling and on `tool_result` rather
than `tool_call` — the same "after the write" position the `PostToolUse` column
has, so the refresh sees the tree the tool has already changed. Its `python`
tool can write too and is deliberately left out: it is a general evaluator, so
including it would fire a refresh on every computation. Crush is the opposite —
`PreToolUse` is its only event, so the refresh runs *before* the write and sees
the tree the tool has not touched yet. What it front-runs there is the previous
tool's write; the last write of a turn waits for the poll.
