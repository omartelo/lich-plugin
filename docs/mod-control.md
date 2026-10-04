# Mod: control

Client side of the [mod-control contract](https://github.com/omartelo/lich/blob/main/docs/hooks/mod-control.md)
(the endpoints, the commands and the ack are defined in the lich repository;
this plugin only implements them).

Lets lich drive a Claude Code session, through `lich control` on the command
line or the `control_session` MCP tool an agent calls: start a turn with a
prompt, stop the running turn, override the model or the effort of every
request, and run one of its slash commands; and ask it a side question it
answers without stopping, through `lich ask` or the `ask_session` MCP tool. It
runs the other way from the
hooks: instead of reporting what happened, it holds a long poll open on lich,
applies the commands that come back, and acks each one.

| client                 | Claude Code                                           | Codex               | Antigravity         | opencode            | omp                 | Crush               |
|------------------------|-------------------------------------------------------|---------------------|---------------------|---------------------|---------------------|---------------------|
| `hooks/mod-control.js` | mod, registered by `hooks/lich.js` (`hooks/hooks.json` `modules`) | none: no mod system | none: no mod system | none: no mod system | none: no mod system | none: no mod system |

A Claude Code mod is a module Claude Code runs inside its own process, listed
under `modules` in the same `hooks/hooks.json` that registers the scripts. Both
kinds live in one file and both fire. Claude Code takes one entry there, so the
entry is `hooks/lich.js`, which registers this module and
[agent-cards](agent-cards.md). lich refuses to queue a command for a
session whose mod is not polling, so on every other harness `lich control` and
`control_session` fail at once, naming what to fix, instead of waiting on
nothing.

| command   | applied with                         | ack `ok: true` once                     |
|-----------|--------------------------------------|-----------------------------------------|
| `prompt`  | `$.prompt.submit({ text })`          | its turn started                        |
| `abort`   | `$.turn.abort({ turnId })`, the id `turn.start` gave | the turn ended          |
| `model`   | every `turn.step` sent with `model`  | the override is set, or dropped when absent |
| `effort`  | every `turn.step` sent with `effort` | the override is set, or dropped when absent |
| `command` | `$.command.run({ command: name, args })` | it ran, once the session was idle    |
| `ask`     | `$.model.fork({ prompt })`, the question behind a preamble | the fork answered; `answer` carries it |

`GET /mod/commands?token=…&session_id=…` to fetch, `POST /mod/acks` with
`{"session_id", "id", "kind", "ok", "error"?, "answer"?}` to ack, `X-Lich-Plugin` on both.

## How it behaves

- **Outside lich it never polls.** It reads the three variables in
  `session.start` and stops there when one is missing. Its `turn.step` hook
  still runs on every request and passes it on unchanged.
- **Only an interactive session polls.** A `claude -p` with a parked poll stays
  open until the poll returns, up to 25 seconds after its turn ended, and one run
  from a tool inside a lich session inherits that session's variables, so it
  would also take the parent's commands. `session.start` says which one it is
  (`isInteractive`).
- **Polling never waits on a command.** Commands are applied one after another,
  apart from the poll, which goes out again at once. A `prompt` resolves only
  when the session is idle and its turn starts, and lich stops queueing for a
  mod that has not polled in 30 seconds: a poll held behind that prompt would
  get the abort meant for the running turn refused.
- **Nor does a command wait on a `prompt` or a slash command.** The prompt is
  submitted in its place and acked when its turn starts, and a `command` is
  acked once Claude Code ran it, which is only when the session is idle. What
  comes after either runs at once: an `abort` held behind a prompt, or a
  `/compact` queued during a turn, would reach the running turn only after that
  turn ended, and behind a prompt it would then cancel the prompt's own turn
  instead. A `model` or `effort` sent meanwhile likewise applies to the running
  turn's next request.
- **An `ask` waits on nothing and nothing waits on it.** A fork runs beside the
  turn and can take over a minute (measured at 109 seconds for a long answer on
  2.1.289), so it starts the moment its poll returns and acks whenever it
  answers, outside the order the other commands keep. Several run at once.
- **The question goes behind a preamble.** It says the question is a side one,
  that the answer stays out of the conversation, and that tools are unavailable.
  Without it, a fork made mid-turn reaches for a tool, is refused, and answers
  in a second request: twice the latency and the uncached tokens (measured on
  2.1.289).
- **An answer is cut at 16,000 UTF-16 units**, with `\n[truncated]` after it,
  which keeps the ack under lich's 64 KiB body limit. A fork that does not
  answer acks `ok: false` with its reason: `nothing-to-fork`,
  `api-error <status> <kind>`, `empty-reply` or `aborted`.
- **Every other ack is awaited before the next command.** That is the
  contract's rule for an `abort`: lich ends the turn it has open when the ack
  lands, so a late one would end the turn the next `prompt` opened. An ack that
  cannot be sent is dropped, and the next command runs.
- **An effort outside `low`, `medium`, `high`, `xhigh` and `max` is refused**
  (`unknown effort`). Claude Code would take it and fail the hook only at the
  next model request, long after an `ok` ack. A model name has no such check
  before a request uses it, so it is acked as set.
- **A `404` stops polling for the session**, a network error or a `5xx` backs off
  1 second doubling to 10, and a `200` resets it. Any other status backs off the
  same way rather than poll in a tight loop.
- **A kind it does not know is acked `ok: false`, `unknown kind`**, its kind
  echoed so a lich newer than the plugin hears of it.

## Which Claude Code runs it

Measured against a stub lich on each release:

- **2.1.280 and later** load and run the module.
- **2.1.260 to 2.1.278** load the plugin and skip the module: the switch Claude
  Code rolls mods out under (`tengu_plugin_hooks_modules`) is off for installed
  plugins there.
- **2.1.250** knows mods with an older event set: `claude plugin validate`
  fails on `session.start`, but a session loads the plugin and skips the module.
- **2.1.200** ignores the `modules` key.

On every one of them the scripts keep reporting as before. What an older Claude
Code loses is the controls: `lich control` and `control_session` refuse the
session, naming what to fix. The same happens on a current one when the rollout switch is off: it is
a server-side flag Claude Code caches on disk, and an older `claude` run under
the same home can save it off for the next session.

A mod also loads only once the folder is trusted. The scripts register before
the trust prompt is answered, the module after.

## Known ceilings

- **Overrides live in the module.** A reload of the module (a new plugin
  release, a hot reload while developing) starts it fresh, with no model or
  effort override and without telling lich. The reload itself cancels a parked
  poll, so lich's "client gone" path covers it.
- **The classic hooks do not see the effort override.** `Stop`'s payload still
  names the session's own effort. The transcript's assistant rows carry the one
  the request used.
- **An effort sent to a model without effort is dropped by Claude Code**, and
  the ack still says `ok`: the override is set, it just changes nothing for that
  model.
- **A slash command that opens a dialog never acks until someone closes it.**
  Measured on 2.1.288 and 2.1.289: `/cost` holds Claude Code's command queue
  until Esc is pressed in the session's terminal, and every later slash command
  waits behind it. `abort`, `model` and `effort` still apply, since the mod
  does not wait on a `command`, and a dialog opens only on an idle session, so
  there is no turn behind it to abort.
- **`/model` and `/effort` are refused by lich, not by the mod.** Run through a
  mod, Claude Code saves what they set as the default for every new session;
  the `model` and `effort` commands are the per-session route.
- **A fork sees the conversation as the session's last request sent it.** A
  reply being written, or a tool call running, when the question lands is not
  in it. Measured on 2.1.289.
- **A fork cannot be cancelled, and survives an Esc on the turn.** It takes no
  signal; measured on 2.1.289, it answered in full after the turn it ran beside
  was interrupted. A module reload is what kills one, and then nothing is acked:
  lich's wait runs out.
- **A fork's tokens are not in the transcript**, so nothing that reads cost
  from it counts an `ask`.
