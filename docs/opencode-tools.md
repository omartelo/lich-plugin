# opencode tools

The other contracts in this directory are about **reporting**: they tell lich
what a session is doing. This one is the other direction — what a session can
*do* to the sessions beside it: list them, hand one a task, answer one, open a
new one, close one, look at the worktrees.

lich exposes those operations twice, and both are documented in
[`docs/cli.md`](https://github.com/omartelo/lich/blob/main/docs/cli.md) there:
as the `lich` command line, and as MCP tools it registers at spawn for the
harnesses that can be told on their own command line — Claude Code and Codex.
**opencode cannot be**, and a plugin there cannot register an MCP server either.
What it can do is define tools, so that is what `opencode/lich.js` does.

## What is registered

The same seven the MCP server offers, under the same names, because an agent
that learns one surface should find the other under the names it already knows:

| Tool | What it does |
|---|---|
| `list_sessions` | The live sessions that can be given work, as JSON. |
| `send_to_session` | Hand a task to one and wait for its agent's answer. |
| `wait_for_answer` | Wait again on a ticket an earlier send handed back. |
| `reply_to_session` | Answer a task another session sent you. |
| `open_session` | Open a session, optionally on a fresh git worktree. |
| `close_session` | Close one, and settle what happens to its checkout. |
| `list_worktrees` | The checkouts, what is uncommitted, who is in them. |

## They shell out to `lich`

Each tool builds an argv and runs the `lich` binary. It would have been fewer
moving parts to POST to the same loopback endpoint the reports use — and it
would have been the third implementation of one contract, in a repository lich
cannot see. An argument that moved in `docs/cli.md` would have gone red in
neither.

Shelling out keeps the argv here and everything else there: which arguments are
required, what a refusal says, the rule that a worktree's last session decides
that checkout's fate, and every wording written for an agent to act on. A
command that fails answers with its own stderr, unedited, for the same reason.

The binary is `$LICH_BIN`, never `lich` off `PATH`: a machine running an
installed lich beside a `task dev` build has two, and only the one in the
environment belongs to this session.

## When they are absent

Two cases, both deliberate, and in both the **reports keep working** — they need
neither of the things below:

- **Outside lich.** No `LICH_PORT` / `LICH_TOKEN` / `LICH_SESSION_ID` in the
  environment means no tools registered at all. Seven tools that could only
  answer "no lich is running" would be seven tools in the prompt of every
  unrelated opencode session on the machine.
- **Without opencode's plugin package.** The `tool` helper is imported at run
  time, inside a `try`: it resolves from opencode's own plugin dependencies, and
  a module dropped where those do not reach would otherwise fail at import and
  take the reports down with it.

## The wait is capped

`send_to_session` and `wait_for_answer` cap their wait at 90 seconds, mirroring
lich's own MCP server. The ticket is what makes that cheap: a wait that ends
unanswered costs one more tool call, and the answer arrives at your prompt when
it exists.
