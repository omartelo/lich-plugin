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

Through the Skill tool, the one it already reaches for. Measured on Claude Code
2.1.295, asked to "run /compact", the model answered that it could not because
`/compact` is a CLI command and not a skill; called on `compact`, the Skill tool
refuses with `compact is a built-in CLI command, not a skill. Ask the user to
run /compact themselves — it cannot be invoked via the Skill tool.`

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

## Known ceilings

- **The transcript shows the call as `Successfully loaded skill`.** The answer
  takes the Skill tool's own `inline` shape, which is what Claude Code draws.
- **A command that opens a dialog holds the command queue until someone closes
  it**, as with lich's `command` ([mod-control.md](mod-control.md), Known
  ceilings): `/cost` waits for an Esc in the session's terminal. Since the user
  asked for it, they are at that terminal; nothing tells such a command apart in
  `$.command.list()`, so none is refused.
- **`/compact` and `/clear` start the session again** (`SessionStart` fires),
  which runs the mod's `session.start` again; it only switches it on again.
