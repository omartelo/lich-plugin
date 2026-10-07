# Mod: agent cards

Runs a subagent Claude Code starts as a lich session: a card the user can watch
and steer, where Claude Code would otherwise run the agent hidden inside the
asking session. It follows the native agent's semantics: it works in the asking
session's checkout, or in a worktree of its own when the call asks for
`isolation: "worktree"`.

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
- the session is not itself a worker, so a worker's own subagents stay native
  instead of opening cards from cards. lich starts every `--subagent` session
  with `LICH_SUBAGENT_CARDS=off` (below), which covers a worker in the asking
  session's checkout; an isolated call also stays native when the session is on
  a branch under `subagent/`, which only this mod opens;
- the session is interactive (`session.start` saw `isInteractive`), since a
  `claude -p` started from a tool inside a lich session inherits its variables;
- `LICH_BIN` and `LICH_SESSION_ID` are set, which is to say the session runs
  inside lich;
- `LICH_SUBAGENT_CARDS` is not `off`. lich sets it to `off` in a Claude Code
  session it starts while "Subagents as lich sessions" is off in Settings ›
  Providers › Claude Code, and in every session opened with `--subagent`, and
  leaves it out otherwise, so the default is on.
  A session's environment is fixed when it starts, so turning the setting over
  reaches the sessions started after that.

A taken call runs:

1. With `isolation: "worktree"` only, `git branch --show-current` in the
   session's directory, for the base.
2. `$LICH_BIN open --kind claude --subagent [--worktree <branch> [--base <current>]] [--model <model>] --prompt <prompt> --json`,
   given two minutes, the sum of the waits lich's own client allows an open
   with a task. `--worktree` and `--base` go only with `isolation: "worktree"`;
   without them lich opens the worker in the asking session's directory.

Nothing runs after that: the delivery `lich open` printed decides the answer.

| delivery                      | the Agent call answers                                              |
|-------------------------------|---------------------------------------------------------------------|
| `pending`                     | `async_launched` at once, plus a note on how the report comes back; the worker is counted in the footer |
| `answered`                    | `completed`: the report, then the checkout (and branch) it is on    |
| `unanswered`                  | `async_launched`, as for `pending`: a turn that ended unanswered usually left a background command running, and the report still arrives as a [lich] note |
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
Like a native agent's, its `worktreePath` and `worktreeBranch` are there only
for an isolated call.

## How it behaves

- **The call runs in the background**, as a background subagent does: once lich
  has the task it answers `async_launched` and the asking turn goes on. Parallel
  Agent calls run their hooks concurrently, so each opens its own card at once.
- **The report comes back through lich, not Claude Code.** `--subagent` makes
  lich type the worker's whole report at the asking session's prompt as a
  `[lich]` note (through mod-control's `prompt` when the session runs the mod),
  so the model has nothing to collect; `wait_for_answer` and `lich wait` still
  work. Claude Code's own text for a background agent promises a task
  notification and names `SendMessage`, so the result carries a `context` line
  the model reads after it: where the worker is (and, without isolation, that
  it edits this same checkout), that its report arrives on its own, and that
  `send_to_session` or `lich send` reaches it where `SendMessage` cannot.
- **The worker answers by itself.** Its own copy of this plugin posts the final
  message of a turn that ends with nothing left running in the background as
  its answer ([mod-answer](mod-answer.md)), so lich hands it the task with no
  ticket and no reply instructions, as a native subagent gets its prompt.- **Without isolation the worker shares the checkout**, as a native subagent
  does: both edit the same files, and nothing keeps their changes apart. With
  `isolation: "worktree"` it gets a branch and worktree of its own.
- **It falls back to the native agent only before lich has the task.** Claude
  Code runs the native agent in place of any hook that throws, overruns its
  budget or lets a `$.process.run` reject, so the module catches every failure
  and decides. A task over lich's 8192-byte limit, or an open that failed, runs
  natively with a toast saying why, naming the card when one was opened. Esc
  while the open is still running denies the call instead, because lich may
  already have handed the task over and a native agent beside the worker would
  do the work twice; a report that worker sends still arrives as a `[lich]` note.
- **An isolated worker's branch is named from the call.** The description is slugged the way
  lich's own worktree dialog slugs a typed name (2 to 5 words, 10 to 40
  characters, letters and digits in any script), `agent` when nothing is left,
  under `subagent/`, plus `-` and the last four letters or digits of the call's id. lich checks out
  a branch that already exists as it stands, and the suffix keeps a call from
  landing on one.
- **An isolated worker's base is the asking session's branch, as last
  committed.** Uncommitted
  changes are not in the worker's checkout. On a detached HEAD, or when git
  cannot answer, the base is left to lich, which uses the project's current branch.
- **The prompt footer counts the workers still running**, as Claude Code's own
  "N agents" hint counts background agents: `lich: N workers` in the lich line
  of the footer (`hooks/status-line.js`, see [mod-status.md](mod-status.md)),
  cleared at none, and left out while that line shows lich's errands, which
  count every worker. Every 5 seconds while any runs, the mod reads
  `$LICH_BIN sessions --json`. A worker in this checkout is finished once lich
  no longer lists it: lich closes it after it reported and its turn ended
  (`lich open --subagent` in lich's docs/cli.md), while a turn it ended with a
  command left in the background is done without being finished. An isolated
  worker keeps its card after it reported, so a turn lich lists `done` ends it.
  A list lich could not give leaves the count as it was until the next read.
- **Esc does not stop a worker, and TaskStop does**, as with a native background
  agent. Measured on Claude Code 2.1.289: Esc in the asking session interrupts
  its own turn and leaves its background agents running (a second Esc at the
  idle prompt too; Claude Code stops them all with its own `ctrl+x ctrl+k`,
  pressed twice), and the model stops one with `TaskStop({ task_id })`, the
  `agentId` the Agent call answered, which answers
  `{ message, task_id, task_type: "local_agent", command }`. The mod takes a
  TaskStop whose `task_id` (or the deprecated `shell_id`) is a worker it opened
  and is still counting: a worker in this checkout is closed with
  `$LICH_BIN close <name>`, having nothing of its own to keep, and an isolated
  one has its turn stopped with `$LICH_BIN control <name> abort`, its card and
  worktree left for the user. A closed worker's task just ends: lich sends
  the asking session no note about it. Either answers TaskStop's own result shape; a
  command lich refused denies the call with lich's reason. Any other task id
  goes to Claude Code.
- **The worker runs with the permissions lich opens any Claude Code session
  with**, not the asking session's mode, so a permission prompt waits on its
  card, and lich tells the asking session when the worker is waiting on one.
- **lich files the worker in a folder named after the asking session**, and its
  errand never expires.
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
  background-task list and Claude Code sends no completion notification for it;
  the status line and TaskStop above are the mod's, not Claude Code's. So
  `ctrl+x ctrl+k` does not stop a worker, and a worker is counted only while
  this module remembers it: a reload forgets the count, and TaskStop then goes
  to Claude Code, which does not know the id.
- **The status line lags a worker's end by up to 5 seconds**, the period of the
  `lich sessions --json` read, and matches a worker by the roster name `lich
  open` printed, so a worker renamed in Claude Code is read as finished.
- **Needs a lich that takes `lich open --subagent`.** An older one refuses the
  flag, and every subagent runs inside Claude Code with a toast saying why.
- **A reload of the module mid-session forgets that the session is
  interactive** until its next `session.start`, and Agent calls run natively
  until then.
