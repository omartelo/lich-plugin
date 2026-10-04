# Mod: agent cards

Runs a subagent Claude Code starts as a lich session: its own worktree and a
card the user can watch and steer, where Claude Code would otherwise run the
agent hidden inside the asking session.

There is no HTTP contract behind it. It drives the lich CLI the asking session
already has, `$LICH_BIN open` and `$LICH_BIN wait`, so what it reads is what
those commands print (`docs/cli.md` in the lich repository: `open --json`,
`wait --json`, Exit status).

| client                 | Claude Code                                           | Codex               | Antigravity         | opencode            | omp                 | Crush               |
|------------------------|-------------------------------------------------------|---------------------|---------------------|---------------------|---------------------|---------------------|
| `hooks/agent-cards.js` | mod, registered by `hooks/lich.js` (`hooks/hooks.json` `modules`) | none: no mod system | none: no mod system | none: no mod system | none: no mod system | none: no mod system |

It hooks Claude Code's `Agent` tool (`tool.call`). A call is taken only when all
of these hold, and every other one goes on to Claude Code untouched:

- the model made it on the main loop: `next.origin` is the engine and the call
  carries no `agentId`, so another plugin's `$.agent.spawn` and a subagent's own
  subagents stay native;
- its `subagent_type` is `general-purpose` or absent, so Explore, Plan, project
  and plugin agent types keep their own behaviour, and an unknown type keeps
  Claude Code's own error;
- it names no `team_name`;
- the session is interactive (`session.start` saw `isInteractive`), since a
  `claude -p` started from a tool inside a lich session inherits its variables;
- `LICH_BIN` and `LICH_SESSION_ID` are set, which is to say the session runs
  inside lich.

A taken call runs:

1. `git branch --show-current` in the session's directory, for the base.
2. `$LICH_BIN open --kind claude --worktree <branch> [--base <current>] [--model <model>] --prompt <prompt> --json`,
   given two minutes, the sum of the waits lich's own client allows an open
   with a task.
3. While the delivery is `pending`, `$LICH_BIN wait --timeout 540 --json <ticket>`,
   each given ten minutes, which is the most `$.process.run` allows.

| outcome                       | the Agent call answers                                              |
|-------------------------------|---------------------------------------------------------------------|
| `answered`                    | `completed`: the report, then the branch and checkout it is on      |
| `unanswered`                  | `completed`: the worker ended its turn without reporting, and where to look |
| `unread`, `undelivered`       | denied: the task never reached the card                             |
| the open failed               | the native agent runs, with a toast saying why                      |
| the wait failed, or a status it does not know | denied, naming the card and its branch              |

The `completed` result is the Agent tool's own arm: `agentId` is the worker's
roster name, `worktreePath` and `worktreeBranch` are its checkout, and the token
and tool counts are zero because they are the worker's session's, not this one's.

## How it behaves

- **The call is held until the worker reports**, as a foreground subagent holds
  it: the asking turn waits. Claude Code's hook budget does not count the time a
  `$.process.run` is in flight, so a held call can last as long as the worker
  does (measured past 12 minutes on 2.1.289). Parallel Agent calls run their
  hooks concurrently, so each opens its own card at once. Answering at once
  (`async_launched`) was turned down: it promises a background task Claude Code
  can notify about, read and stop, and none of that exists for a lich session.
- **It falls back to the native agent only before lich has the task.** Claude
  Code runs the native agent in place of any hook that throws, overruns its
  budget or lets a `$.process.run` reject, so the module catches every failure
  and decides. A task over lich's 8192-byte limit, or an open that failed, runs
  natively with a toast saying why, naming the card when one was opened. Once
  the task reached the worker, a failure denies the call instead: a native agent
  beside the worker would do the work twice. A worker's later report still
  arrives at the asking session's prompt as a `[lich]` note.
- **Esc stops the wait, never the worker.** Claude Code aborts the call and
  ends the `lich wait` child; the worker keeps running on its card, its ticket is
  no longer waited on, and its report arrives as a `[lich]` note. Esc while the
  open is still running denies the call too, because lich may already have
  handed the task over.
- **The branch is named from the call.** The description is slugged the way
  lich's own worktree dialog slugs a typed name (2 to 5 words, 10 to 40
  characters, letters and digits in any script), `agent` when nothing is left,
  plus `-` and the last four letters or digits of the call's id. lich checks out
  a branch that already exists as it stands, and the suffix keeps a call from
  landing on one.
- **The base is the asking session's branch, as last committed.** Uncommitted
  changes are not in the worker's checkout. On a detached HEAD, or when git
  cannot answer, the base is left to lich, which uses the project's current branch.
- **The worker runs with the permissions lich opens any Claude Code session
  with**, not the asking session's mode, so a permission prompt waits on its card.
- **A model the call names is the worker's model**, passed as `--model`.

## Known ceilings

- **Claude Code only.** No other harness has a mod system, so their subagents
  stay inside their CLI.
- **Workflow steps never reach the Agent tool's hook** (measured on 2.1.289),
  so they stay native.
- **The result reports no tokens and no tool uses.** Both are counted in the
  worker's own session.
- **A reload of the module mid-session forgets that the session is
  interactive** until its next `session.start`, and Agent calls run natively
  until then. Claude Code defers a reload while a turn runs, so a held call is
  never cut by one.
