# Mod: worker answer

Client side of the [mod-answer contract](https://github.com/omartelo/lich/blob/main/docs/hooks/mod-answer.md)
(the endpoint and the payload are defined in the lich repository; this plugin
only implements them).

Makes a lich subagent worker (a session opened with `lich open --subagent`,
which is what [agent-cards](agent-cards.md) opens for an Agent call) answer the
task it was handed the way a native subagent does: the final message of its
turn is its result. lich hands such a worker its task with no ticket and no
reply instructions, and answers the errand with what this mod posts.

| client                   | Claude Code                                              | Codex               | Antigravity         | opencode            | omp                 | Crush               |
|--------------------------|----------------------------------------------------------|---------------------|---------------------|---------------------|---------------------|---------------------|
| `hooks/worker-answer.js` | mod, registered by `hooks/lich.js`, the `modules` entry  | none: no mod system | none: no mod system | none: no mod system | none: no mod system | none: no mod system |

| event                                     | sent                                                        |
|-------------------------------------------|-------------------------------------------------------------|
| `classic.Stop`, then `turn.complete{reason=answer}` | `POST /mod/answer` with `{"session_id", "text"}`  |
| `classic.Stop` with a blank message, then `turn.complete{reason=answer}` | `POST /mod/answer` with `{"session_id", "unanswered": "blank"}` |

## How it behaves

- **Only a worker answers.** It reads `LICH_SUBAGENT_DEPTH` in `session.start`,
  which lich sets on every Claude Code session it starts, and reports only when
  it is an integer above `0`: a session opened `n` `--subagent` levels down
  carries `n`, any other `0`. Under a lich older than that variable it reads
  `LICH_SUBAGENT_CARDS` instead and reports only when it is `off`, which that
  lich sets on every `--subagent` session. A session the user turned subagent
  cards off for carries it too; lich ignores a report from a session with no
  subagent errand open.
- **A turn that handed work to the background does not answer.** Its main-loop
  `classic.Stop` lists what is still running in `background_tasks` (a shell, a
  subagent, a monitor, a workflow); Claude Code resumes in a new turn when that
  work finishes, and that turn's `Stop`, with nothing listed, is the one that
  answers.
- **A blank turn says so.** One whose final message is blank posts
  `unanswered: "blank"`, so the caller hears the errand ended instead of
  waiting on it, and only when the turn's own `classic.Stop` lists nothing
  running. The plugin reports blank turns only.
- **An aborted turn does not report**: its user took the worker over, and the
  turn they start next is the one that answers.
- **A refused or failed turn does not report either**, though the contract has
  `unanswered: "refusal"` and `"error"` for them. Measured on Claude Code
  2.1.296, both end through `StopFailure` (a refusal with error
  `invalid_request`) and then `turn.complete`, with no `Stop`, and neither
  carries `background_tasks`, nor does any mod engine call list them: the mod
  cannot tell a failed turn with nothing running from one whose background
  work resumes it later and answers then, so a report would answer the errand
  twice. Both are pending until Claude Code exposes that list on the failure.
- `turn.complete` is matched once per `reason` (`answer`, `refusal`,
  `error`, `aborted`), which keeps the hooks beside mod-control's own
  `turn.complete` hook: Claude Code refuses one plugin's second hook on an event
  with no matcher. Every one of them drops the `Stop` it read.
- **A subagent's turn inside the worker does not answer.** `classic.Stop` fires
  on the main loop only, and a `turn.complete` that carries an `agentId` is
  skipped.
- **A Stop answers only for its own turn.** The text is posted when the
  completion's `answer` equals the Stop's `last_assistant_message`, a blank
  Stop only beside a blank `answer`, and the Stop is dropped once a completion
  read it: an aborted turn fires no Stop, and must not inherit the last one.
- **The text is cut at 16,000 UTF-16 units** and marked `[truncated]`, as an
  `ask`'s answer is.
- **The turn is never held up.** The answer is posted beside the chain; one
  that fails is dropped, never retried.
- **Outside lich, and in a non-interactive run, it never reports.**

Measured on Claude Code 2.1.289: `classic.Stop` fires on the main loop before
`turn.complete`, its `last_assistant_message` equals the completion's `answer`,
and its `background_tasks` is `[]` when nothing runs. `classic.SubagentStop`
fires for engine forks too, and a background subagent lists itself as still
running there, which is why only the main loop's `Stop` is read. A worker that
asks with `AskUserQuestion` blocks with no `Stop` until someone answers in its
card.
