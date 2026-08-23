# Hook: session state

Client side of the [session-state contract](https://github.com/omartelo/lich/blob/main/docs/hooks/session-state.md)
— the contract (transport, endpoint, payload, accepted values) is defined in
the lich repository; this plugin only implements it.

Reports the session's processing state so the lich card shows a spinner while
the agent works, a check when the turn ends, and a bell (plus an actionable
toast) when the agent is blocked on the user.

| script                    | state            | Claude Code hook   | Codex hook          | Antigravity hook   | opencode event            | omp event       |
|---------------------------|------------------|--------------------|---------------------|--------------------|---------------------------|-----------------|
| `report-state.sh busy`    | `busy`           | `UserPromptSubmit` | `UserPromptSubmit`  | `PreInvocation`    | `session.status` (`busy`) | `input`         |
| `report-tool.sh`          | `busy` + `tool`  | `PreToolUse`       | `PreToolUse`        | `PreToolUse`       | `tool.execute.before`     | `tool_call`     |
| `report-state.sh busy`    | `busy`           | `PostToolUse`      | `PostToolUse`       | —                  | `session.status` (`busy`) | `turn_start`    |
| `report-state.sh done`    | `done`           | `Stop`             | `Stop`              | `Stop`             | `session.status` (`idle`) | `session_stop`  |
| `report-state.sh waiting` | `waiting`+`reason`| `Notification`    | `PermissionRequest` | — (not measured)   | any `*.asked`             | — (not measured)|
| `report-state.sh idle`    | `idle`           | `SessionEnd`       | — (never fires)     | — (never fires)    | — (never fires)           | — (never fires) |

opencode and omp run no scripts: `opencode/lich.js` and `omp/lich.js` send the
same payloads off the events their harness hands a loaded module. opencode's
`session.status` carries the state rather than implying it — `idle` there is the
turn ending, which is this contract's `done`. omp implies it like the script
harnesses do, and its `turn_start` is the `PostToolUse → busy` of that column:
every turn passes through it, including the ones no `input` precedes. **Crush is
absent from the table on purpose**: its only event is `PreToolUse`, and a `busy`
nothing can end would pin a spinner to a card. See [providers.md](providers.md).

**omp reports no `waiting`.** It raises `tool_approval_requested` when it asks to
run something, but that event was never observed on a real run here, and a name
taken off a type declaration is a report that silently never fires. An omp card
therefore shows a spinner, not a bell, while the agent waits on you — one state
late, never wrong. The event is the first thing to measure when someone can drive
an approval prompt.

The endpoint, the accepted states and the optional fields (`tool` / `detail`
on the pre-tool report, `reason` on the waiting one) are spelled out once, in
[lich's contract](https://github.com/omartelo/lich/blob/main/docs/hooks/session-state.md).
What is below is only what each harness gives this plugin to fill them with.

`Notification` fires when Claude needs a permission decision or has been idle
waiting for input — both mean "your turn". A later `busy` or `done` clears it.
Codex has no `Notification`; the same meaning arrives as `PermissionRequest`,
which fires when Codex asks to run a command or write outside its sandbox.
There, the hook's own exit code is an approval decision — exit `2` would deny
the request — so `report-state.sh` staying silent and always exiting 0 is what
keeps the report an observation instead of an answer.

**opencode's `waiting` is matched by suffix, not by name.** It asks the user in
more than one way — a permission and an interactive question, each with a `.v2.`
spelling alongside — and its event catalogue is not exhaustive: a real run emits
types (`server.heartbeat`) that its own published schema does not list. So
`lich.js` reports `waiting` for any event type ending in `.asked` rather than for
a list of names. The failure modes are not symmetric: a surplus bell is cleared
by the next status report, which follows a reply within ~100ms, while a name
nobody enumerated leaves a session waiting behind a card that shows a spinner.
Answering (`question.replied` → `session.status busy`) and dismissing
(`question.rejected` → `session.status idle`) both re-arm the card on their own,
which is why neither is registered here.

## The reason

A `waiting` report carries what the agent is blocked on, so the bell on the card
says *why* rather than only *that*. It rides `waiting` alone — lich drops it on
every other state — and it is optional in both directions: the bell has to land
whether or not a reason could be built, so no shape below is ever a reason to
refuse the report.

| harness     | where the reason comes from                                            |
|-------------|------------------------------------------------------------------------|
| Claude Code | the `Notification` payload's `message`                                  |
| Codex       | `tool_name`, qualified with the same `detail` a busy report would carry |
| opencode    | `permission`, the v2 `action`, or a question's `header`                 |
| omp, Crush  | — neither reports `waiting` at all                                      |

Claude Code is the only harness that hands over a sentence written for a human
("Claude needs your permission to use Bash"), and it writes one for the plain
idle-at-the-prompt nudge too — which is a reason as much as a permission is, so
both go out unchanged and lich still decides which arrived. Codex's
`PermissionRequest` has no message field at all: its payload is the `PreToolUse`
envelope plus `model`, `permission_mode` and `turn_id`, so the report is the
tool it is asking about with the words the busy report already puts on the card
behind it — `apply_patch: internal/terminal/usage.go`. That second half is
[`detail.jq`](../hooks/detail.jq), shared with `report-tool.sh` so the two
readings of a tool call cannot drift.

opencode's four `.asked` events spell it four ways, so `lich.js` reads it by
field the way it reads a tool call's detail: `permission`, then the v2 `action`,
then the first question's `header` — opencode's own ≤30-character label, built
for exactly this kind of surface — with the full question behind it when a
caller left the header out. A field rule covers the next prompt type too, and
one that carries none of them still reports `waiting` with nothing attached,
which is the documented degrade rather than a bug.

Nothing here measures the reason's length: lich caps it, and a cap is not a
refusal. Without `jq` (Windows, usually) the message stays home for the same
reason the detail does — a hand-built body cannot escape arbitrary text — but
Codex's tool name is an identifier and goes out alone, and Codex is the harness
that needs the Windows wrapper.

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

| Action        | Claude Code       | Codex                     | Antigravity                        | opencode         | omp              |
|---------------|-------------------|---------------------------|------------------------------------|------------------|------------------|
| run a command | `Bash`            | `Bash`                    | `run_command`                      | `bash`           | `bash`           |
| edit a file   | `Edit` / `Write`  | `apply_patch`             | `propose_code` / `file_change`     | `edit` / `write` | `edit` / `write` |
| read a file   | `Read`            | — (goes through `Bash`)   | `view_file`                        | `read`           | `read`           |
| search        | `Grep` / `Glob`   | — (goes through `Bash`)   | `grep_search` / `code_search`      | `grep` / `glob`  | `grep` / `glob`  |

The `detail` is read by field, never by tool name — `command` / `CommandLine`,
then `file_path` / `path` / `TargetFile`, then `url` / `query` / `Query` — one
chain over both spellings, which is what makes one
rule cover both: a Codex shell call arrives as `Bash` carrying the same
`command` string Claude Code sends. opencode spells the same fields in camel
case (`filePath`) and hands over paths already relative to the session, so
`lich.js` reads the same list and skips the shortening below. omp's built-ins
spell it `path` (read, write, edit, glob), `command` (bash) or `pattern`
(grep) — also already relative — and `omp/lich.js` keeps the camel-case and
`query` / `url` spellings after them, for the tools omp does not define itself:
an extension's or an MCP server's, named however their author named them.

Two shapes need more than the plain rule, and both live in
[`detail.jq`](../hooks/detail.jq) — one copy, because the waiting report reads
the same tool call for the second half of its reason:

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
