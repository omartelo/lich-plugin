# Mod: agent cards

Runs a subagent Claude Code starts as a lich session: its own worktree and a
card the user can watch and steer, where Claude Code would otherwise run the
agent hidden inside the asking session.

There is no HTTP contract behind it. It drives the lich CLI the asking session
already has, `$LICH_BIN open`, so what it reads is what that command prints
(`docs/cli.md` in the lich repository: `open --json`, Exit status).

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
- it names no `team_name` and no `isolation: remote`, so a teammate and a
  remote agent keep Claude Code's own route;
- the session is not itself a worker: a branch under `subagent/` is one this
  mod opened, and a worker's own subagents stay native instead of opening cards
  from cards;
- the session is interactive (`session.start` saw `isInteractive`), since a
  `claude -p` started from a tool inside a lich session inherits its variables;
- `LICH_BIN` and `LICH_SESSION_ID` are set, which is to say the session runs
  inside lich;
- `LICH_SUBAGENT_CARDS` is not `off`. lich sets it to `off` in a Claude Code
  session it starts while "Subagents as lich sessions" is off in Settings ›
  Providers › Claude Code, and leaves it out otherwise, so the default is on.
  A session's environment is fixed when it starts, so turning the setting over
  reaches the sessions started after that.

A taken call runs:

1. `git branch --show-current` in the session's directory, for the base.
2. `$LICH_BIN open --kind claude --worktree <branch> [--base <current>] [--model <model>] --prompt <prompt> --json`,
   given two minutes, the sum of the waits lich's own client allows an open
   with a task.

Nothing runs after that: the delivery `lich open` printed decides the answer.

| delivery                      | the Agent call answers                                              |
|-------------------------------|---------------------------------------------------------------------|
| `pending`                     | `async_launched` at once, plus a note on how the report comes back  |
| `answered`                    | `completed`: the report, then the branch and checkout it is on      |
| `unanswered`                  | `completed`: the worker ended its turn without reporting, and where to look |
| `unread`, `undelivered`       | denied: the task never reached the card                             |
| a status it does not know     | denied, naming the card and its branch                              |
| the open failed               | the native agent runs, with a toast saying why                      |

`pending` is the usual case: a worker rarely reports within the open's own
wait. Both results are the Agent tool's own arms, and `agentId` is the worker's
roster name in each. `async_launched` carries the call's description and prompt
and an empty `outputFile`, which is the value Claude Code gives its own agents
that have no output file: there is nothing to read, and without
`canReadOutputFile` Claude Code never shows the model the field. `completed`
carries the worker's checkout in `worktreePath` and `worktreeBranch`, and token
and tool counts of zero because they are the worker's session's, not this one's.

## How it behaves

- **The call runs in the background**, as a background subagent does: once lich
  has the task it answers `async_launched` and the asking turn goes on. Parallel
  Agent calls run their hooks concurrently, so each opens its own card at once.
- **The report comes back through lich, not Claude Code.** The task is an
  ordinary lich errand (not `--private`), so when the worker replies lich types
  a `[lich]` note at the asking session's prompt (through mod-control's `prompt`
  when the session runs the mod), and the model collects it with
  `wait_for_answer` or `lich wait`. Claude Code's own text for a background
  agent promises a task notification and names `SendMessage`, so the result
  carries a `context` line the model reads after it: where the worker is, how
  its report arrives, its ticket, and that `send_to_session` or `lich send`
  reaches it where `SendMessage` cannot.
- **It falls back to the native agent only before lich has the task.** Claude
  Code runs the native agent in place of any hook that throws, overruns its
  budget or lets a `$.process.run` reject, so the module catches every failure
  and decides. A task over lich's 8192-byte limit, or an open that failed, runs
  natively with a toast saying why, naming the card when one was opened. Esc
  while the open is still running denies the call instead, because lich may
  already have handed the task over and a native agent beside the worker would
  do the work twice; a report that worker sends still arrives as a `[lich]` note.
- **The branch is named from the call.** The description is slugged the way
  lich's own worktree dialog slugs a typed name (2 to 5 words, 10 to 40
  characters, letters and digits in any script), `agent` when nothing is left,
  under `subagent/`, plus `-` and the last four letters or digits of the call's id. lich checks out
  a branch that already exists as it stands, and the suffix keeps a call from
  landing on one.
- **The base is the asking session's branch, as last committed.** Uncommitted
  changes are not in the worker's checkout. On a detached HEAD, or when git
  cannot answer, the base is left to lich, which uses the project's current branch.
- **The worker runs with the permissions lich opens any Claude Code session
  with**, not the asking session's mode, so a permission prompt waits on its card.
- **A model the call names is the worker's model**, passed as `--model`. With
  none, the worker starts on the model lich opens Claude Code with, not the
  asking session's, which a native agent would inherit.

## Known ceilings

- **Claude Code only.** No other harness has a mod system, so their subagents
  stay inside their CLI.
- **Workflow steps never reach the Agent tool's hook** (measured on 2.1.289),
  so they stay native.
- **The result reports no tokens and no tool uses.** Both are counted in the
  worker's own session.
- **Claude Code does not track the worker as a task.** It is not in the
  background-task list, Claude Code sends no completion notification for it,
  and stopping it is done on its card, not from Claude Code.
- **A report nobody collects within an hour is lost.** lich drops an
  unanswered ticket an hour after anyone last waited on it, and a result left
  in the inbox on the same clock; the work itself stays on the worker's card
  and branch.
- **A reload of the module mid-session forgets that the session is
  interactive** until its next `session.start`, and Agent calls run natively
  until then.
