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
| `plugin.json`                   | Antigravity | plugin manifest               |
| `hooks/hooks.json`              | Claude Code | hook registration             |
| `hooks/codex-hooks.json`        | Codex       | hook registration             |
| `hooks.json`                    | Antigravity | hook registration, name and place both fixed |
| `hooks/crush-hooks.json`        | Crush       | hook registration, merged by hand |
| `hooks/*.sh`                    | the four    | the reports themselves        |
| `hooks/win-run.cmd`             | Codex       | runs a script on Windows      |
| `opencode/lich.js`              | opencode    | the whole client, as a module |
| `omp/lich.js`                   | omp         | the whole client, as a module |
| `skills/`                       | all         | skills, same layout           |

The repository root is the plugin root for Claude Code, Codex and Antigravity,
so a single clone installs on any of the three. The scripts are shared because
those harnesses — and Crush — expose the same things a report needs: the payload
arrives as JSON on stdin naming the session (`session_id`, or `conversationId`
on Antigravity), the transcript (`transcript_path` / `transcriptPath`) and, on a
pre-tool event, the call (`tool_name` + `tool_input` + `cwd`, or `toolCall` +
`workspacePaths`). Every script reads both spellings, so one script still serves
every harness.

**How the command finds the script is where Antigravity parts company.** Claude
Code, Codex and Crush all give the command line a plugin root to start from:
`$CLAUDE_PLUGIN_ROOT` for the first two, a `<lich-plugin>` placeholder the user
replaces for Crush. Antigravity sets no such variable — it runs the command
through `sh -c` with the working directory set to the folder holding
`hooks.json`, which for a plugin is the plugin root. So its registration alone
spells relative paths (`hooks/report-state.sh busy`), and a `${CLAUDE_PLUGIN_ROOT}`
copied in from the Claude Code file expands to nothing there: every hook then
runs `/hooks/<script>` and exits 127, silently, on every event.

**opencode and omp are the exceptions, and both are packaging ones.** Neither
has a notion of a hook command. In opencode a plugin is a JavaScript module the
server imports, which subscribes to an event bus instead of being spawned per
event. omp arrives at the same place from the other side: it *has* a `--hook`
flag, but `--hook` and `--extension` are one list and every entry is loaded with
`import()` — even the files it calls hooks are modules, never scripts fed a
payload on stdin. So each gets one file, `opencode/lich.js` and `omp/lich.js`,
posting the same payloads to the same endpoints. Nothing about the contracts
changes; what changes is that there is no process to exit 0 from, so the module
swallows its own errors and never awaits a report.

## Event vocabulary

| Report              | Claude Code                  | Codex                        | Antigravity                  | opencode                  | omp                      | Crush                       |
|---------------------|------------------------------|------------------------------|------------------------------|---------------------------|--------------------------|-----------------------------|
| session id          | `SessionStart`               | `SessionStart`               | `PreInvocation`              | `session.created`         | `session_start`          | `PreToolUse`                |
| `busy`              | `UserPromptSubmit`, `PostToolUse` | `UserPromptSubmit`, `PostToolUse` | `PreInvocation`        | `session.status` (`busy`) | `input`, `turn_start` | —              |
| `busy` + tool       | `PreToolUse`                 | `PreToolUse`                 | `PreToolUse`                 | `tool.execute.before`     | `tool_call`              | —                           |
| `waiting` + reason  | `Notification`               | `PermissionRequest`          | — (not measured)             | any `*.asked`             | — (see below)            | —                           |
| `done`              | `Stop`                       | `Stop`                       | `Stop`                       | `session.status` (`idle`) | `session_stop`           | —                           |
| title               | `Stop`                       | `Stop`                       | `Stop`                       | `session.updated`         | `session_stop`, `turn_start` | —                       |
| `idle`              | `SessionEnd`                 | — (registered, never fires)  | — (never fires)              | — (nothing outlives it)   | — (nothing outlives it)  | —                           |
| touched             | `PostToolUse` (write tools)  | `PostToolUse` (write tools)  | `PostToolUse` (write tools)  | `file.edited`             | `tool_result` (write tools) | `PreToolUse` (write tools) |

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
matches the suffix, and reads what the prompt is about by field for the same
reason. See [session-state.md](session-state.md).

A `waiting` report says what the session is blocked on, and each harness hands
over something different to say it with — a sentence, a tool name, a permission.
The per-harness table is in [session-state.md](session-state.md#the-reason);
omp and Crush have no cell there, because neither reports `waiting` at all.

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

## omp specifics

Everything below was measured against omp v17.3.0
(`@oh-my-pi/pi-coding-agent`), driving a real `omp --hook … -p …` run at a stub
listener. 17.x moves fast — re-measure before trusting a name.

- **`--hook` is `--extension`.** omp merges both flags into one list of
  extension paths and imports every entry, so a "hook" there is a module
  exporting a default factory, called with omp's API object. Its *other*
  hooks — `hooks/pre/<tool>.sh` — are imported the same way rather than run, so
  there is no script-and-stdin path anywhere in omp to reuse the `hooks/*.sh`
  scripts from.
- **It loads only `module.default`.** Unlike opencode, which calls every export
  of a plugin file, omp reads one and warns if it is not a function.
- **The session id is on the context, not in the environment.** omp exports
  nothing about the running session to its own process env; every handler gets
  `ctx.sessionManager`, whose `getSessionId()` is the id, and `getSessionFile()`
  the transcript path. `omp -r <id>` resumes from that id.
- **The gate is inside the module.** omp discovers configuration from `~/.omp`,
  `~/.claude`, `~/.codex` and `~/.gemini` wholesale, and there is no per-harness
  registration to key on, so a global install is loaded by every omp run on the
  machine. Outside lich the factory subscribes to nothing at all.
- **`input` is interactive-only.** It fires when the user submits a prompt,
  which is what lich spawns — but a `-p` run has no `input` at all, so
  `turn_start` carries `busy` there. It is also the recovery the script
  harnesses get from `PostToolUse`: every turn passes through it.
- **Nothing reports `waiting`.** omp raises `tool_approval_requested` when it
  asks to run something, but that was not observed on a real run here (the
  measured runs never reached an approval), and an unmeasured event name is a
  report that silently never fires. Until it is measured, an omp card shows the
  spinner while the agent waits on you.
- **Nothing reports `idle` either.** The event that would say "the CLI has left"
  is the process exiting with this module inside it. Like a Codex or an opencode
  card, an omp card holds its last indicator until lich respawns its terminal.
- **Never awaited.** omp awaits its extension handlers, so a report that blocked
  would sit in front of the agent's next step. Every `fetch` is fired and
  dropped, with a 1s timeout, and its failure is swallowed — the module's version
  of "always exit 0". Handlers are synchronous and return nothing: `tool_call`
  returning `{block: true}` would refuse the user's tool call.
- **Install is a file plus a line.** Drop the module anywhere and name it in
  `~/.omp/agent/config.yml` under `extensions:`, or drop it straight into
  `~/.omp/agent/extensions/`, which omp scans without being told. Both were
  measured; there is no manifest and no marketplace entry of omp's own.
- **omp reads Claude Code plugins, but not their hooks.** It loads
  `~/.claude/plugins/cache/` and takes skills, slash commands, custom tools and
  MCP servers from them — honouring `.omp-plugin/plugin.json` before
  `.claude-plugin/plugin.json`. `hooks/hooks.json` is read by nothing there, so
  installing this repository as a Claude plugin gives an omp session the skills
  and none of the reports.
- **MCP has no command-line flag.** omp reads Claude-Desktop-shaped
  `{"mcpServers": …}` from `~/.omp/agent/mcp.json` (and `.omp/mcp.json`,
  `<cwd>/.mcp.json`), expanding `${VAR}` and `${VAR:-default}` from the process
  environment — so a session token can ride in on the variables lich already
  injects. The `--config` overlay does *not* take MCP servers.

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

## Antigravity specifics

Antigravity is the one harness whose *packaging* the plugin has to satisfy as
well as its events. Everything below comes off the guide the CLI itself ships
(`~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/`) and a run
against a stub listener — not off a name that reads plausibly.

- **A plugin is a directory, and both its files are named for it.** Antigravity
  discovers `plugins/<name>/plugin.json` under a customization root and loads the
  `hooks.json`, `skills/` and `rules/` sitting beside it. Neither name is
  configurable: a `hooks/<harness>-hooks.json` named the way every other
  registration here is would be discovered by nothing at all.
  That is why the manifest and the registration are the two files in this
  repository that live at the root rather than in a namespaced folder — the root
  *is* the plugin directory once the clone is installed as one, and `skills/` is
  picked up from there for free.
- **The registration is keyed by hook name, not by `hooks`.** Every top-level key
  in a `hooks.json` is one integration's name, so several merge into one file;
  lich's is `lich`. `PreToolUse` and `PostToolUse` group handlers behind a
  `matcher`; `PreInvocation` and `Stop` are flat lists of handlers.
- **Commands are relative to the plugin root.** See above — no plugin-root
  variable exists.
- **A hook answers on stdout, and the answer is acted on.** Antigravity reads a
  JSON object back: `PreToolUse` requires a `decision`, and `Stop` takes one too,
  where `continue` refuses to let the loop end. Silence is not the neutral
  answer it is on every other harness, so the registration appends the verdict
  the event asks for — `{"decision":"allow"}` before a tool, `{"decision":""}` on
  `Stop`, `{}` elsewhere. The scripts stay silent, because on Codex their stdout
  would answer a permission request instead.
- **Payloads are camelCase** (protojson): `conversationId` is the session id,
  `workspacePaths[0]` the session's directory, `transcriptPath` the JSONL log.
  Tool calls arrive as `toolCall.name` with PascalCase arguments under
  `toolCall.args` (`CommandLine`, `TargetFile`, `AbsolutePath`, `Query`, `Url`).
- **The title is the first `USER_INPUT` line of the transcript**, unwrapped from
  its `<USER_REQUEST>` tags — the same shape Codex's first user message has, so
  `report-title.sh` reads it in the same pass.
- **`PreInvocation` fires before every model call, not once per turn.** Session
  id and `busy` therefore go out several times a turn. Both are idempotent, so
  the card is right either way, and it is what makes `busy` cheap enough to leave
  on the same event as the session id.
- **Tool names can only be measured, never derived.** The CLI's own guide says
  a tool name is its step type lowercased with the `CORTEX_STEP_TYPE_` prefix
  dropped — and that is not what arrives: the enum's `MCP_TOOL` reaches a hook
  as `call_mcp_tool`, so something maps names on top of it. What a real turn
  sends is `run_command`, `write_to_file`, `replace_file_content`, `view_file`,
  `list_dir` and `call_mcp_tool`, with PascalCase arguments (`CommandLine`,
  `TargetFile`, `AbsolutePath`, `DirectoryPath`, `ServerName`/`ToolName`). A
  matcher built from the enum instead matches nothing at all, silently — which
  is how the git-status refresh can stop firing on a write with the suite still
  green.
- **Every MCP tool arrives as the one tool `call_mcp_tool`**, the server and the
  tool it called being arguments. `detail.jq` reads them, so the card can tell
  two MCP calls apart — lich's own tools reach a session this way.
- **Not reported: `waiting` and `idle`.** No event has been measured for either.
  `PermissionRequest` has no counterpart here — `PreToolUse` could gate a call,
  but a hook that answers `ask` to ring a bell would be changing the turn rather
  than observing it. `Stop` ends one execution loop, not the conversation, so it
  is `done` and never `idle`. `PostInvocation` exists and is unregistered:
  nothing is left for it to say.
- **lich does not register the provider yet.** `/session-start` answers 400 to
  `provider: "antigravity"` until it does, which is why no fixture enumerates it
  and `PENDING_UPSTREAM` in `tests/contract.mjs` names the gap instead. The
  contract moves in lich first — prose, then fixtures, then the endpoint.

## Adding a provider

1. Confirm the harness exposes the session lifecycle to something it will run or
   load, and that it names the session id.
2. Add its manifest and marketplace file if it has them, and a hook-registration
   file mapping its events onto the existing scripts. Take the filenames, the
   event names, the payload fields and the tool names a matcher lists from the
   harness itself — its own docs, its binary, a run against a stub — never from
   what they resemble on a harness already supported here. Every one of those
   fails the same silent way: a hook that does not run reports nothing to
   disagree with.
3. Answer the harness on the terms it addresses the command with. Two things
   differ per harness and neither has a default worth assuming: how the command
   finds the script (`$CLAUDE_PLUGIN_ROOT`, a placeholder, or a working directory
   and relative paths), and what it expects back (silence, an exit code, or a
   JSON verdict on stdout). Run its registration in the suite the way *that*
   harness runs it — a test that exports what the harness does not is a test that
   proves nothing.
4. Register the provider id in lich before the client reports it: prose, then
   fixtures, then the endpoint, then here. A fixture is never edited to make a
   run green — until lich accepts the id, declare it in `PENDING_UPSTREAM`
   (`tests/contract.mjs`), which fails the moment a refreshed fixture registers
   it.
5. Only write a new script if a report cannot be derived from what the existing
   ones read — extend one instead (`report-title.sh` reads three transcript
   formats). A harness that takes no commands at all is the one case for a
   client of its own, which is what `opencode/lich.js` is.
6. Register only the reports the harness can actually close. A state nothing can
   end is worse on a card than no state.
7. Add the provider's column to each doc in this directory.
