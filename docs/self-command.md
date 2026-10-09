# Mod: self-command

Lets a Claude Code session inside lich run one of its own built-in slash
commands when the user asks for it ("run /compact"). There is no lich contract
behind it and nothing is sent to lich: lich's `control` refuses a session
controlling itself on purpose (`docs/ceilings.md` in lich, "A session cannot
control itself"), and the mod runs in the session's own process anyway.

| client                  | Claude Code                                             | Codex               | Antigravity         | opencode            | omp                 | Crush               |
|-------------------------|---------------------------------------------------------|---------------------|---------------------|---------------------|---------------------|---------------------|
| `hooks/self-command.js` | mod, registered by `hooks/lich.js`, the `modules` entry | none: no mod system | none: no mod system | none: no mod system | none: no mod system | none: no mod system |

## How the model asks

Through a tool it already reaches for: the Skill tool, or lich's own
`control_session`. Measured on Claude Code
2.1.295, asked to "run /compact", the model answered that it could not because
`/compact` is a CLI command and not a skill; called on `compact`, the Skill tool
refuses with `compact is a built-in CLI command, not a skill. Ask the user to
run /compact themselves — it cannot be invoked via the Skill tool.`

Asked the same with only the Skill tool taken, sessions still went to
`control_session`, whose description says "never your own": one called it on
itself, another asked a peer session to run it on it. Claude Code names that
tool `mcp__lich__control_session` in `tool.call` and `tool.describe`, the call's
input arrives as `{ session, action, value, args }`, and lich refuses a session
named by its own label with an error result whose text is `"<label>" is this
session, and a session cannot control itself: …` (measured on 2.1.295).
`tool.describe` fires for it even while it is deferred behind ToolSearch.

A session cannot look its own label up through `list_sessions` or `lich
sessions`, which leave it out. Before lich 0.64 lich also answered its
`LICH_SESSION_ID` with `no session named`, and told to target itself, a session
measured on 2.1.295 tried that id and gave up. From lich 0.64 every tool that
names a session takes its id too, and `lich whoami --json` prints the session it
runs in, `{label, name, project, kind, state, id}` (`docs/cli.md` in lich).

A tool of the mod's own was the first design and does not work: Claude Code
lists a mod's tool as `mcp__<plugin>__<name>`, this plugin is `lich`, and
`$.tool.register` refuses with `the session already has an MCP server named
"lich" in its MCP config; registering would replace it`, which is every lich
session (measured on 2.1.295).

## How it behaves

It does nothing unless `LICH_SESSION_ID` is set and the session is interactive
(a `claude -p` started from a tool inside a lich session inherits the
variables).

- `tool.describe` on `Skill` appends one paragraph to the tool's description:
  a built-in slash command can be named there too when the user asks for it,
  and it runs once the turn ends.
- `tool.describe` on `mcp__lich__control_session` appends one too: action
  `command` is accepted with this session as the target, named by its
  `LICH_SESSION_ID`, which the paragraph spells out, and it runs once the turn
  ends.
- `tool.call` on `mcp__lich__control_session` lets lich answer first, so a
  command for another session stays lich's. Only an error answer to action
  `command` is looked at, and only when the target is this session: its
  `LICH_SESSION_ID`, or the label or name `lich whoami --json` prints for it,
  matched without regard to case as lich matches them. `lich whoami` runs only
  for such an error answer, and when it fails only the id counts. The command
  then goes the way a Skill call's does below, `/model` and `/effort` refused
  alike, and the call is answered with a text saying it is queued and to end
  the turn.
- `tool.call` on `Skill` lets the Skill tool run first, so a skill, and a
  built-in it serves as a prompt (`/init`, `/review`), stay its own. Only a call
  it answered with an error is looked at, and only when `$.command.list()`
  names it as a `builtin` command; anything else gets the Skill tool's own
  answer back.
- That call is answered as a loaded skill (`{ success: true, commandName }`),
  with a note telling the model the command is queued and to end its turn, and
  the command goes to `$.command.run` from a `$.clock.after(0)` timer:
  `$.command.run` rejects inside a hook the turn is waiting on. It queues the
  command, which runs once the session is idle, after the turn that asked.
- A command that fails once queued has no turn left to answer, so its error is
  a toast.
- `/model` and `/effort` are refused, and never run: run through a mod, Claude
  Code saves what they set as the default for every new session (measured on
  2.1.288 and 2.1.289). The refusal points at lich's per-session `model` and
  `effort` override instead, which another session or lich itself sets.

## Measured

Claude Code 2.1.295, the plugin loaded with `--plugin-dir`, lich's MCP server in
the MCP config: asked "roda /compact pra mim", the model called
`Skill(compact)`, said the command would run once the turn ended, the turn
ended, and `/compact` then ran and compacted the conversation.

The same, from a new lich session handed "roda um /compact" by another session:
`Skill(compact)`, then a `compact_boundary` in its transcript. Told to use
`control_session` on itself instead, it called it with its `LICH_SESSION_ID`
from the description, got `/compact is queued on this session`, ended the turn,
and compacted.

## Known ceilings

- **A session named by its label needs lich 0.64 or later.** An older lich has
  no `whoami`, so only the `LICH_SESSION_ID` the description names is taken as
  this session, and lich answers that id with `no session named` rather than its
  refusal; the mod queues the command either way.

- **The transcript shows the call as `Successfully loaded skill`.** The answer
  takes the Skill tool's own `inline` shape, which is what Claude Code draws.
- **A command that opens a dialog holds the command queue until someone closes
  it**, as with lich's `command` ([mod-control.md](mod-control.md), Known
  ceilings): `/cost` waits for an Esc in the session's terminal. Since the user
  asked for it, they are at that terminal; nothing tells such a command apart in
  `$.command.list()`, so none is refused.
- **`/compact` and `/clear` start the session again** (`SessionStart` fires),
  which runs the mod's `session.start` again; it only switches it on again.
