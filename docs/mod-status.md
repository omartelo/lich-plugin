# Mod: status

Client side of the [mod-status contract](https://github.com/omartelo/lich/blob/main/docs/hooks/mod-status.md)
(the endpoint and the response are defined in the lich repository; this plugin
only implements them).

Shows, in the status line under the prompt, the relay errands the session is
part of: who it owes an answer, the tasks it handed out that are still running,
and the answers waiting to be collected. The card shows these in the window;
this puts them in front of the person at the terminal.

| client                | Claude Code                                             | Codex               | Antigravity         | opencode            | omp                 | Crush               |
|-----------------------|---------------------------------------------------------|---------------------|---------------------|---------------------|---------------------|---------------------|
| `hooks/mod-status.js` | mod, registered by `hooks/lich.js`, the `modules` entry | none: no mod system | none: no mod system | none: no mod system | none: no mod system | none: no mod system |

| when                                        | read                                                     |
|---------------------------------------------|----------------------------------------------------------|
| `session.start`, then every 5 seconds       | `GET /mod/status?token=…&session_id=…`, `X-Lich-Plugin`  |

## What the line reads

Each list that is not empty adds a piece, in this order, joined by commas:

| list    | piece                                                                                   |
|---------|-----------------------------------------------------------------------------------------|
| `owed`  | `owes "Session 26" an answer` for one asked by a session, `owes N answers` otherwise    |
| `open`  | `N tasks out`, plus `(M waiting)` for those whose session waits on a human               |
| `ready` | `N answers to collect`                                                                  |

Claude Code puts the plugin's name before it: `lich: 1 task out, 1 answer to
collect`. With all three lists empty the piece is gone. It shares the one status
line Claude Code gives the plugin through `hooks/status-line.js`, and while it
shows, the worker count of [agent-cards.md](agent-cards.md) is left out of the
line: every worker that mod opens is an errand of this session, so `open`
already counts it.

## How it behaves

- **Outside lich it never reads.** It reads the three variables in
  `session.start` and stops there when one is missing.
- **Only an interactive session reads.** A `claude -p` run from a tool inside a
  lich session inherits that session's variables, and would show the parent's
  errands. Its `session.start` hook matches `isInteractive: true`.
- **Reading never collects.** An answer under `ready` stays in the inbox for
  the agent's `wait_for_answer`.
- **A failed read is not retried.** The piece is cleared until a read works
  again, 5 seconds later.
- **A `404` stops the reads for the session**: that lich predates the contract.

## Limits

- **Up to 5 seconds late.** lich pushes nothing; an errand that opens or
  closes shows at the next read.
- **Labels are the ones at send time**, as lich keeps them.
- **Claude Code only.** Every other harness has no mod system; there the card
  is the only place these errands show.
