# Mod: usage

Client side of the [mod-usage contract](https://github.com/omartelo/lich/blob/main/docs/hooks/mod-usage.md)
(the endpoint and the payload are defined in the lich repository; this plugin
only implements them).

Reports what a Claude Code session measured about itself, the figures its
status line draws: the context window and how full it is, the account's
rate-limit windows, and what the conversation has cost. lich shows those
instead of the figures it derives from the transcript and from a request it
would otherwise spend measuring a token login's plan.

| client               | Claude Code                                              | Codex               | Antigravity         | opencode            | omp                 | Crush               |
|----------------------|----------------------------------------------------------|---------------------|---------------------|---------------------|---------------------|---------------------|
| `hooks/mod-usage.js` | mod, registered by `hooks/lich.js`, the `modules` entry  | none: no mod system | none: no mod system | none: no mod system | none: no mod system | none: no mod system |

Claude Code takes one hooks module per plugin and refuses a second `modules`
entry, so `hooks/lich.js` is that module and registers each mod of the plugin
from its own file.

| event             | sent                                                                 |
|-------------------|----------------------------------------------------------------------|
| `session.measure` | `POST /mod/usage` with `{"session_id", "conversation_id", "context", "rate_limits", "cost_usd"?}` |

`conversation_id` is `$.session.id()`. `context` is `{window, tokens?, percent?}`
and each of `rate_limits` is `{kind, percent_used, resets_at?}`, Claude Code's
own figures renamed: one it does not have is left out, never zeroed.

## How it behaves

- **Outside lich it never reports.** It reads the three variables in
  `session.start` and stops there when one is missing.
- **Only an interactive session reports.** A `claude -p` run from a tool inside
  a lich session inherits that session's variables, and its figures would land
  on the parent's card. Its `session.start` hook matches `isInteractive: true`,
  so a non-interactive run never reads the link.
- **A measurement taken before `session.start` waits for it.** Claude Code
  measures the session as it starts.
- **Reports go out one at a time, in order.** lich keeps the latest, so an older
  one landing last would put stale figures back.
- **The event is never held up.** The report is posted beside the chain, a
  failed one is dropped and never retried (the next carries the whole figures
  again), and a `404` stops reporting for the session.

Claude Code fires `session.measure` once at start, at the end of every
main-thread turn, and when a rate-limit window moves a whole point; never
mid-turn (measured on 2.1.289). A compaction fires it once more, just before
the `SessionStart` it reports as `compact` (measured on 2.1.295).
