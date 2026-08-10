# Providers

lich drives an agent CLI inside a PTY and injects the same three variables
(`LICH_PORT`, `LICH_TOKEN`, `LICH_SESSION_ID`) into every one it spawns. The
[hook contracts](https://github.com/omartelo/lich/blob/main/docs/hooks/README.md)
are therefore provider-agnostic: what changes per provider is only *how the
harness registers hooks* and *what its lifecycle events are called*.

This repository is one plugin with one set of hook scripts, packaged for each
harness it supports:

| File                            | Read by     | Purpose                       |
|---------------------------------|-------------|-------------------------------|
| `.claude-plugin/plugin.json`    | Claude Code | plugin manifest               |
| `.claude-plugin/marketplace.json` | Claude Code | marketplace, points at `./` |
| `.codex-plugin/plugin.json`     | Codex       | plugin manifest               |
| `.agents/plugins/marketplace.json` | Codex    | marketplace, points at `./`   |
| `hooks/hooks.json`              | Claude Code | hook registration             |
| `hooks/codex-hooks.json`        | Codex       | hook registration             |
| `hooks/*.sh`                    | both        | the reports themselves        |
| `skills/`                       | both        | skills, same layout           |

The repository root is the plugin root for both, so a single clone installs on
either CLI. The scripts are shared because both harnesses expose the same
things a report needs: the payload arrives as JSON on stdin with `session_id`
and `transcript_path` (and `tool_name` / `tool_input` / `cwd` on a pre-tool
event), and `$CLAUDE_PLUGIN_ROOT` points at the installed plugin — Codex sets
that same variable, so the command lines are identical.

## Event vocabulary

| Report              | Claude Code                  | Codex                        |
|---------------------|------------------------------|------------------------------|
| session id          | `SessionStart`               | `SessionStart`               |
| `busy`              | `UserPromptSubmit`, `PostToolUse` | `UserPromptSubmit`, `PostToolUse` |
| `busy` + tool       | `PreToolUse`                 | `PreToolUse`                 |
| `waiting`           | `Notification`               | `PermissionRequest`          |
| `done` + title      | `Stop`                       | `Stop`                       |
| `idle`              | `SessionEnd`                 | — (registered, never fires)  |
| touched             | `PostToolUse` (write tools)  | `PostToolUse` (write tools)  |

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

The session id carries the provider that reported it (`report-session-start.sh
codex`), which is what puts Codex's icon rather than Claude's on the card, and
what lets lich resume the conversation with `codex resume <id>`. Both need lich
≥ 0.28.0; an older lich ignores the field and treats the report as Claude's.

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

## Adding a provider

1. Confirm the harness runs commands as hooks on a session's lifecycle, and
   that it exposes the session id and the transcript path.
2. Add its manifest and marketplace file, and a hook-registration file mapping
   its events onto the existing scripts.
3. Only write a new script if a report cannot be derived from what the existing
   ones read — extend one instead (`report-title.sh` reads two transcript
   formats).
4. Add the provider's column to each doc in this directory.
