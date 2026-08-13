# Providers

lich drives an agent CLI inside a PTY and injects the same three variables
(`LICH_PORT`, `LICH_TOKEN`, `LICH_SESSION_ID`) into every one it spawns. The
[hook contracts](https://github.com/omartelo/lich/blob/main/docs/hooks/README.md)
are therefore provider-agnostic: what changes per provider is only *how the
harness registers hooks* and *what its lifecycle events are called*.

This repository is one plugin, packaged for each harness it supports:

| File                            | Read by     | Purpose                       |
|---------------------------------|-------------|-------------------------------|
| `.claude-plugin/plugin.json`    | Claude Code | plugin manifest               |
| `.claude-plugin/marketplace.json` | Claude Code | marketplace, points at `./` |
| `.codex-plugin/plugin.json`     | Codex       | plugin manifest               |
| `.agents/plugins/marketplace.json` | Codex    | marketplace, points at `./`   |
| `hooks/hooks.json`              | Claude Code | hook registration             |
| `hooks/codex-hooks.json`        | Codex       | hook registration             |
| `hooks/crush-hooks.json`        | Crush       | hook registration, merged by hand |
| `hooks/*.sh`                    | the three   | the reports themselves        |
| `hooks/win-run.cmd`             | Codex       | runs a script on Windows      |
| `opencode/lich.js`              | opencode    | the whole client, as a module |
| `skills/`                       | all         | skills, same layout           |

The repository root is the plugin root for Claude Code and Codex, so a single
clone installs on either CLI. The scripts are shared because those harnesses —
and Crush — expose the same things a report needs: the payload arrives as JSON
on stdin with `session_id` and `transcript_path` (and `tool_name` /
`tool_input` / `cwd` on a pre-tool event), and `$CLAUDE_PLUGIN_ROOT` points at
the installed plugin — Codex sets that same variable, so the command lines are
identical.

**opencode is the exception, and it is a packaging one.** It has no notion of a
hook command: a plugin there is a JavaScript module the opencode server imports,
which subscribes to an event bus instead of being spawned per event. So the four
reports live in one file, `opencode/lich.js`, which posts the same payloads to
the same endpoints. Nothing about the contracts changes; what changes is that
there is no process to exit 0 from, so the module swallows its own errors and
never awaits a report.

## Event vocabulary

| Report              | Claude Code                  | Codex                        | opencode                  | Crush                       |
|---------------------|------------------------------|------------------------------|---------------------------|-----------------------------|
| session id          | `SessionStart`               | `SessionStart`               | `session.created`         | `PreToolUse`                |
| `busy`              | `UserPromptSubmit`, `PostToolUse` | `UserPromptSubmit`, `PostToolUse` | `session.status` (`busy`) | —              |
| `busy` + tool       | `PreToolUse`                 | `PreToolUse`                 | `tool.execute.before`     | —                           |
| `waiting`           | `Notification`               | `PermissionRequest`          | any `*.asked`             | —                           |
| `done`              | `Stop`                       | `Stop`                       | `session.status` (`idle`) | —                           |
| title               | `Stop`                       | `Stop`                       | `session.updated`         | —                           |
| `idle`              | `SessionEnd`                 | — (registered, never fires)  | — (nothing outlives it)   | —                           |
| touched             | `PostToolUse` (write tools)  | `PostToolUse` (write tools)  | `file.edited`             | `PreToolUse` (write tools)  |

Every cell above was taken off a real run of that harness against a stub
listener, not off its documentation.

Two differences matter. Codex has no `Notification`, so "your turn" arrives as
`PermissionRequest` — where a hook exiting `2` would *deny* the request, which
is why every script exits 0 and prints nothing. And Codex has no `SessionEnd`
either: its events are `PreToolUse`, `PermissionRequest`, `PostToolUse`,
`PreCompact`, `PostCompact`, `SessionStart`, `UserPromptSubmit`,
`SubagentStart`, `SubagentStop` and `Stop` — 0.144.5 carries a payload schema
for each of those and none for `SessionEnd` — so nothing reports `idle` there.
The registration keeps its `SessionEnd` entry anyway: an unregistered event name
is ignored rather than rejected, so the report starts working the day Codex adds
one. Until then a Codex card holds its last indicator (and its provider mark)
until lich respawns that PTY.

opencode's `waiting` is the one cell that is a rule rather than an event name.
It asks the user in more than one way — `permission.asked` and `question.asked`,
each with a `.v2.` spelling published beside it — and its catalogue is not
exhaustive: a real run emits types (`server.heartbeat`) absent from its own
schema. Enumerating names there is how a prompt goes unreported, so the module
matches the suffix. See [session-state.md](session-state.md).

The session id carries the provider that reported it (`report-session-start.sh
codex`), which is what puts Codex's icon rather than Claude's on the card, and
what lets lich resume the conversation with `codex resume <id>`. Both need lich
≥ 0.28.0; an older lich ignores the field and treats the report as Claude's.
opencode and Crush report the same field, so their cards wear their own icon
too — but lich does not resume either yet, so for them the id is stored and
waits.

## Codex specifics

- **Hooks need to be trusted once.** Codex asks you to review the exact hook
  definitions of a non-managed plugin before it runs them — `/hooks` inside a
  session. Until then the plugin is installed but silent: untrusted hooks are
  skipped without a word, so "nothing reports" is the expected first run, not a
  broken install. Trust is recorded against the hook's hash, so an update that
  changes a command asks again.
- **Hooks are a feature flag.** Stable and on by default in current Codex; on
  older versions, `[features] hooks = true` in `~/.codex/config.toml`.
- **Start a new session after installing** — bundled hooks and skills load at
  session start.
- **`codex exec` is not the whole picture.** A non-interactive run reports the
  session id, `busy`, touched, the title and `done` — all verified against a
  real session — but never `waiting`: it runs with approvals off, so no
  `PermissionRequest` is ever raised. That path needs an interactive session,
  which is what lich spawns anyway.
- **Only the manifest's hook file is read.** Codex falls back to a default
  `hooks/hooks.json` when a plugin manifest declares none; this one declares
  `./hooks/codex-hooks.json`, so the Claude Code registration sitting beside it
  is not also loaded — a session reports each event once, not twice.
- **The plugin root is spelled `${CLAUDE_PLUGIN_ROOT}`, braces included.** Codex
  substitutes the braced form and nothing else before handing the line to a
  shell, so a bare `$CLAUDE_PLUGIN_ROOT` only survives where the shell itself
  expands it. That is every Unix run — hooks go to `$SHELL -lc` — and no Windows
  one, where they go to `cmd.exe /C`.
- **Windows runs the scripts through `hooks/win-run.cmd`.** `cmd.exe` cannot
  execute a `.sh`, so each hook registers a `commandWindows` handing the same
  script and the same argument to that wrapper, which looks for Git Bash — on
  `PATH`, then at its default install — and always exits 0, bash or no bash.
  Codex picks `commandWindows` over `command` on Windows and ignores it
  everywhere else, so one registration still serves both.

## opencode specifics

- **It is a module, not a command.** `opencode/lich.js` goes in opencode's
  plugin directory — `~/.config/opencode/plugin/` globally, `.opencode/plugin/`
  per project (`plugins/` works too; opencode globs both). There is no
  marketplace to install from and no manifest: the file being there is the
  install.
- **One module, one card.** The plugin is loaded by the opencode *server* and
  reads `LICH_SESSION_ID` from the environment it was started in. A session lich
  spawns gets its own server, so that is one card; a server shared between two
  top-level sessions would report both onto the same one.
- **Sub-sessions are filtered out.** The `task` tool runs a sub-agent as its own
  session with its own `session.status`, and its `idle` is not the turn ending.
  They are recognised by the `parentID` their session events carry and dropped.
- **Nothing reports `idle`.** The event that would say "the CLI has left" is the
  server exiting with this module inside it, so there is nobody left to send it.
  Like a Codex card, an opencode card holds its last indicator until lich
  respawns its terminal.
- **The title is handed over, not read.** `session.updated` carries the whole
  session including its title. The one at creation is a placeholder built from
  the timestamp, so the module holds it and only reports a title that differs
  from it — no matching on its wording.
- **Never awaited.** opencode awaits its plugin hooks, so a report that blocked
  would sit in front of the agent's next step. Every `fetch` here is fired and
  dropped, with a 1s timeout, and its failure is swallowed — the module's version
  of "always exit 0".

## Crush specifics

- **One event exists: `PreToolUse`.** Crush's hooks are Claude Code-compatible
  down to the stdin payload and the exit codes, so the scripts run unchanged —
  but with nothing that fires at the end of a turn, only two of the four reports
  can be honest. Crush reports its session id and refreshes git status; it shows
  no spinner, no check, no bell, and keeps the card's own name.
- **`busy` is deliberately not registered.** A `busy` with no `Stop` behind it
  would pin a spinner to the card until the next turn — wrong for longer than it
  is right. The day Crush ships an end-of-turn event, `report-state.sh` and
  `report-tool.sh` are already here.
- **The session id arrives late.** It rides the first tool call, because that is
  the first event there is. A conversation that answers without a tool never
  reports one.
- **The touched refresh runs one tool early**, for the same reason: `PreToolUse`
  fires before the write, so the immediate git fetch sees the tree the tool has
  not changed yet. What it front-runs in practice is the previous tool's write.
- **Registration is a hand-merge.** Crush has no plugin system: its hooks live in
  the user's own `crush.json`, and `command` is resolved against the working
  directory, not the config file — so a global install needs an absolute path.
  `hooks/crush-hooks.json` is that block with `<lich-plugin>` where the clone's
  path goes.
- **Tool names are lower case**: `bash`, `edit`, `write`, `multiedit`, `view`,
  `ls`, `grep`, `glob`, `mcp_*`. `view` is the read tool — the matcher for the
  touched report lists the writers only.

## Adding a provider

1. Confirm the harness exposes the session lifecycle to something it will run or
   load, and that it names the session id.
2. Add its manifest and marketplace file if it has them, and a hook-registration
   file mapping its events onto the existing scripts.
3. Only write a new script if a report cannot be derived from what the existing
   ones read — extend one instead (`report-title.sh` reads two transcript
   formats). A harness that takes no commands at all is the one case for a
   client of its own, which is what `opencode/lich.js` is.
4. Register only the reports the harness can actually close. A state nothing can
   end is worse on a card than no state.
5. Add the provider's column to each doc in this directory.
