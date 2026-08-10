# Hook: session state

Client side of the [session-state contract](https://github.com/omartelo/lich/blob/main/docs/hooks/session-state.md)
— the contract (transport, endpoint, payload, accepted values) is defined in
the lich repository; this plugin only implements it.

Reports the session's processing state so the lich card shows a spinner while
the agent works, a check when the turn ends, and a bell (plus an actionable
toast) when the agent is blocked on the user.

| script                    | state            | Claude Code hook   | Codex hook          |
|---------------------------|------------------|--------------------|---------------------|
| `report-state.sh busy`    | `busy`           | `UserPromptSubmit` | `UserPromptSubmit`  |
| `report-tool.sh`          | `busy` + `tool`  | `PreToolUse`       | `PreToolUse`        |
| `report-state.sh busy`    | `busy`           | `PostToolUse`      | `PostToolUse`       |
| `report-state.sh done`    | `done`           | `Stop`             | `Stop`              |
| `report-state.sh waiting` | `waiting`        | `Notification`     | `PermissionRequest` |
| `report-state.sh idle`    | `idle`           | `SessionEnd`       | — (never fires)     |

`POST /hook` with `{"session_id": $LICH_SESSION_ID, "state":
"busy"|"done"|"waiting"|"idle"}`, plus the optional `tool` / `detail` pair the
pre-tool report adds.

`Notification` fires when Claude needs a permission decision or has been idle
waiting for input — both mean "your turn". A later `busy` or `done` clears it.
Codex has no `Notification`; the same meaning arrives as `PermissionRequest`,
which fires when Codex asks to run a command or write outside its sandbox.
There, the hook's own exit code is an approval decision — exit `2` would deny
the request — so `report-state.sh` staying silent and always exiting 0 is what
keeps the report an observation instead of an answer.

`SessionEnd → idle` clears the card's indicator (no spinner/check/bell). It
fires when the session ends or is reset, so a stale state does not linger on a
dead session, and a `/clear` starts the next session with a clean card. Codex
has no such event — see [providers.md](providers.md) — so a Codex card holds its
last indicator until lich respawns its terminal. The registration keeps the
`SessionEnd` entry: an unknown event name is ignored rather than rejected, so
the report starts working the day Codex adds one.

`PostToolUse` is the recovery from `waiting`: answering a permission request,
approving a plan (`ExitPlanMode`) or answering a question (`AskUserQuestion`)
does not fire `UserPromptSubmit`, but the tool that resumes work fires
`PostToolUse` — so the spinner comes back. It posts `busy` on every tool call
(loopback, idempotent). Known ceiling: a denied permission where Claude ends
the turn without another tool call stays `waiting` until `Stop`. Codex recovers
the same way: an approved request runs the tool it was asking about, and that
tool's `PostToolUse` re-arms the spinner.

## The tool report

`report-tool.sh` rides `PreToolUse` and reports the same `busy`, with the tool
the agent is about to run: `tool` is the harness's own name for it, `detail` its
own words for what it acts on. lich shows the pair under the session's label and
drops it when the state leaves `busy`, so this script never has to report an
end.

**This is the one hook on the agent's critical path.** In both harnesses a
`PreToolUse` hook exiting `2` blocks the tool call — the client rules (silent,
always exit 0) stop being merely polite here.

What the two harnesses actually send, taken off a real run of each against a
stub listener rather than off their documentation:

| Action        | Claude Code       | Codex                     |
|---------------|-------------------|---------------------------|
| run a command | `Bash`            | `Bash`                    |
| edit a file   | `Edit` / `Write`  | `apply_patch`             |
| read a file   | `Read`            | — (goes through `Bash`)   |
| search        | `Grep` / `Glob`   | — (goes through `Bash`)   |

The `detail` is read by field, never by tool name — `command`, then
`file_path` / `path`, then `pattern` / `url` / `query` — which is what makes one
rule cover both: a Codex shell call arrives as `Bash` carrying the same
`command` string Claude Code sends.

Two shapes need more than the plain rule:

- **`apply_patch`** passes the *whole patch* as its command, so the plain rule
  would put `*** Begin Patch` on the card. The file its `*** Add/Update/Delete
  File:` line names is the readable half; a patch touching several shows the
  first, and one naming none sends no detail at all.
- **A path** is shortened against the payload's `cwd`, because both harnesses
  report absolute paths and a lich card is 240px wide. Outside that directory
  only the file name survives. Commands are never shortened — a leading slash
  there is a binary, not a path worth cutting.

Without `jq` (Windows, usually) the tool name still goes out, read with `sed`
like the session id is; the detail does not, because a hand-built body cannot
escape arbitrary text.
