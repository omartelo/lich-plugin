# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.10.0] - 2026-08-13

### Added

- **omp (oh-my-pi) sessions report to lich.** A fifth harness, and the second
  that loads a module rather than running commands: omp merges `--hook` and
  `--extension` into one list and `import()`s every entry, so even the files it
  calls hooks are modules. `omp/lich.js` is the whole client — the session id off
  `ctx.sessionManager.getSessionId()` at `session_start`, `busy` on `input` and
  `turn_start`, the tool line on `tool_call`, the git-status refresh on a
  `tool_result` from `write`/`edit`/`bash`/`notebook`, and `done` plus the
  generated title when a turn settles. Install is the file plus a line:
  `~/.omp/agent/extensions/lich.js`, or any path named in `extensions:` in
  `~/.omp/agent/config.yml`.

  Two states are deliberately absent. Nothing reports `waiting`: omp has an
  approval event, but it was never observed on a real run here, and a name taken
  off a type declaration is a report that silently never fires — so an omp card
  shows a spinner, not a bell, while the agent waits on you. Nothing reports
  `idle` either, for the same reason no opencode session does: the process that
  would send it is the one exiting.

  The gate lives in the module rather than in a registration. omp discovers
  `~/.claude` and `~/.omp` configuration wholesale, so a global install is loaded
  by every omp run on the machine; with no lich environment the factory
  subscribes to nothing at all.

  Needs `omp` registered as a provider id in lich — until then the session-id
  report is rejected and the card holds no id, while the other three land.

### Fixed

- **A Codex session on Windows reports again.** Every hook failed there —
  `hook exited with code 1` on each event, and `invalid stop hook JSON output`
  on top of it, because cmd.exe writes its own error to stdout and Codex reads
  a Stop hook's stdout as a decision. Two causes, both on this side. Codex
  substitutes `${KEY}` and nothing else before handing the line to a shell, so
  the bare `$CLAUDE_PLUGIN_ROOT` the Codex registration used only ever worked
  because the Unix shell expanded what Codex had left alone — `cmd.exe /C` does
  not, and the hook ran a path that does not exist. The registration now spells
  the braced form, the one Claude Code's has always used. And cmd.exe cannot
  execute a `.sh` at all, so each hook gained a `commandWindows` handing the
  same script and the same argument to `hooks/win-run.cmd`, a wrapper that
  finds Git Bash — on `PATH`, then at its default install — and exits 0
  whether or not it does. Codex prefers `commandWindows` on Windows and ignores
  it everywhere else, so one registration still serves both, and nothing about
  a Unix run changes.

## [0.9.2] - 2026-08-12

### Fixed

- **An opencode session outside lich starts again.** The plugin exported a
  second function beside `LichPlugin`, and opencode loads *every* export of a
  plugin module as a plugin: it called that helper with a plugin input too, and
  then read hook keys off what came back. Inside lich it came back as the tools
  object and its unknown keys were ignored; outside lich the helper's own guard
  returned `null`, and reading `.config` off that killed the server at startup
  with `Error: Unexpected server error`. The helper is no longer exported — the
  seam the suite needs is a second argument to `LichPlugin`, which opencode
  never passes — and a test now loads the module the way opencode does, with no
  lich environment, and fails on any export that is not a plugin it can load.

## [0.9.1] - 2026-08-11

### Fixed

- **An opencode session that asks you a question now rings the bell.** Only its
  permission prompts did: an interactive question rides an event of its own
  (`question.asked`), which the plugin did not listen for, so the card kept the
  spinner and the tool name of the question itself while the session sat waiting
  — no bell, no toast, no desktop notification, and nothing to distinguish it
  from work in progress. Every way opencode asks the user something now reports
  `waiting`, matched by the shape of the event name rather than by a list of
  them: its published catalogue is not exhaustive, and a prompt nobody
  enumerated is a session that waits unseen.

## [0.9.0] - 2026-08-11

### Added

- **opencode sessions can drive the sessions beside them.** They could already
  report what they were doing; now they can act — list the other sessions, hand
  one a task and wait for its answer, answer one that asked, open a session
  (with a git worktree under it), close one, and read what is in each checkout.
  Claude Code and Codex get those operations as MCP tools lich registers when it
  spawns them; opencode cannot be told about a server on its command line, and a
  plugin there cannot register one either — but it can define tools, so the same
  seven are defined here, under the same names.

  Each one runs the `lich` binary rather than talking to lich directly, which is
  what keeps every rule about them — what is required, what is refused, what a
  refusal says — in the one place it is written. Nothing is registered outside a
  lich session, and nothing is registered when opencode's plugin package cannot
  be imported; the reports go on working in both cases.

## [0.8.0] - 2026-08-11

### Added

- **opencode sessions report to lich.** opencode runs no hook commands — a
  plugin there is a module its server imports — so its client is one file,
  `opencode/lich.js`, sending the same four reports to the same endpoints: the
  session id off `session.created`, `busy`/`done` off `session.status`,
  `waiting` off `permission.asked`, the tool line off `tool.execute.before`, the
  card's label off `session.updated`, and the git-status refresh off
  `file.edited`. Install it by dropping the file in `~/.config/opencode/plugin/`
  — there is no marketplace to go through. Sub-sessions (the `task` tool) are
  filtered out by their `parentID`, so a sub-agent finishing does not look like
  the turn ending.
- **Crush sessions report their id and refresh git status.** Crush's hooks are
  Claude Code-compatible, so the existing scripts run unchanged — but
  `PreToolUse` is its only event, so only the two reports it can honour are
  registered. `hooks/crush-hooks.json` is the block to merge into your own
  `crush.json`, with `<lich-plugin>` where the clone's path goes. A Crush card
  shows no spinner and keeps the name lich gave it; both arrive the day Crush
  ships an end-of-turn event.

### Changed

- The test suite is split: `tests/contract.mjs` holds lich's fixtures and the
  assertions, and both clients — the hook scripts and the opencode module —
  answer to the same lines. `tests/opencode.test.mjs` drives the module through
  the events a real opencode run emits.

## [0.7.0] - 2026-08-10

### Added

- **The card says which tool the agent is running.** A new `report-tool.sh`
  rides `PreToolUse` in both harnesses and reports the same `busy` with two
  extra fields — the tool's name and what it acts on — which lich draws under
  the session's label and clears when the turn leaves `busy`. The detail is read
  by field rather than by tool name (`command`, then `file_path`, then
  `pattern` / `url` / `query`), which is what lets one rule cover both: Codex
  reports a shell call as `Bash` carrying the same `command` string Claude Code
  sends. Two shapes needed more: `apply_patch` passes the whole patch as its
  command, so the file its `*** Add File:` line names is what goes on the card,
  and an absolute path is shortened against the session's directory, because
  both harnesses report full ones and a card is 240px wide. Without `jq` the
  tool name still goes out; the detail does not. Needs lich ≥ 0.29.0 — an older
  one ignores the two fields.

  `PreToolUse` is the first contract event on the agent's critical path: a hook
  exiting `2` there blocks the tool call. Until now the worst a broken script
  could do was lose a status report.

- **The hook payloads are asserted against lich's contract fixtures.** lich
  publishes every hook contract as bytes (`docs/hooks/fixtures/*.jsonl` there,
  one case per line: the payloads it accepts and the ones it refuses) and
  asserts its endpoints against them. This repository now asserts the other
  half: `node --test tests/*.test.mjs` runs every hook script as a real
  subprocess — from the command line its registration actually spells, for both
  harnesses — against a stub HTTP server, and checks the body it POSTs matches
  an accepted shape, matches no rejected one, lands on the right endpoint with
  the right `?token=`, and never sends the deprecated `claude_session_id`. It
  also pins the client rules: no report without the full lich environment, exit
  0 and silence when lich answers 500 or refuses the connection. The fixtures
  are vendored (`tests/fixtures/`, refreshed by `tests/refresh-fixtures.sh`) so
  the suite never needs the network, and CI diffs the copies against lich on
  every run. A field that moves in either repository now goes red in both.

### Fixed

- **A blank session title is no longer reported.** `report-title.sh` checked
  that it had extracted *something* before posting, which a title of nothing but
  spaces passes — and lich rejects a blank title with a 400. Codex made it
  reachable: it names a thread after its first user message, so a prompt whose
  first line is indentation produced exactly that payload. The title is trimmed
  before the check now, which also matches what lich stores.

## [0.6.0] - 2026-08-09

### Added

- **The plugin installs on OpenAI Codex too.** Same repository, same hook
  scripts, same skills — a second manifest (`.codex-plugin/plugin.json`), a
  second marketplace file (`.agents/plugins/marketplace.json`) and a second
  hook registration (`hooks/codex-hooks.json`) are all it takes, because Codex
  exposes what a report needs under the same names: `session_id` and
  `transcript_path` on stdin, `$CLAUDE_PLUGIN_ROOT` in the environment. A lich
  card therefore shows the same spinner, check, bell and git status for a Codex
  session as for a Claude one. Two differences are handled in the registration:
  "your turn" arrives as `PermissionRequest` instead of `Notification`, and
  Codex writes files through `apply_patch`. Codex asks you to trust a plugin's
  hooks once (`/hooks`) before it runs them, and skips them silently until you
  do. One report has no Codex half at all: Codex has no `SessionEnd` event, so
  nothing reports `idle` there and a card keeps its last indicator until lich
  respawns its terminal. The registration keeps the entry, which starts working
  if Codex ever adds the event.
- **`report-title.sh` reads Codex transcripts.** Codex generates no title — it
  names a thread after its first user message — so with no `ai-title` present
  the hook falls back to the rollout's first `user_message`, first line, cut to
  80 characters. The card gets the label Codex itself shows, trimmed to size.
- **The session-start report says which provider sent it.**
  `report-session-start.sh` takes the provider id as its argument, passed by the
  registration that runs it (`claude` from `hooks.json`, `codex` from
  `codex-hooks.json`), so a lich card shows the icon of the CLI actually running
  in its terminal and resumes it with that CLI's own invocation. Needs lich ≥
  0.28.0; an older lich ignores the field and reads every report as Claude's, as
  before.
- **[docs/providers.md](docs/providers.md)** — which file each harness reads,
  where the event vocabularies differ, what adding a third provider takes. The
  per-contract docs now carry one event column per provider.

## [0.5.0] - 2026-08-05

### Added

- **The theme skill can build a theme repository, not just a file.** lich now
  installs themes from a git repository and keeps them versioned by its
  manifest, so the skill asks which of the two you want before it writes
  anything: a single file for a palette you are trying out, a repository for
  anything shared or anything you will keep changing. For a repository it
  scaffolds the layout — `lich-theme.json` plus the themes beside it — writes
  the themes, and hands over the install as a path to paste into Settings ›
  Appearance › Import. It also spells out what shipping an update takes, which
  is the part that is easy to get wrong: an edited theme under an unbumped
  manifest version reads as already up to date and reaches nobody.
- **`validate.mjs` accepts a directory.** Pointed at a repository it checks the
  manifest and every theme in one run, the way an install reads them — including
  what a single file has no way to get wrong: a missing or pre-release version,
  no themes beside the manifest, two files claiming the same id.

## [0.4.1] - 2026-08-04

### Fixed

- **A theme built by the skill now ends up selectable.** The skill offered
  copying the file into lich's themes directory as an install path, and that is
  the one it took: lich reads the theme list once, at page load, so the theme
  was announced as installed and was nowhere to be found in Settings until the
  window was reloaded. The skill now writes the file where a file picker can
  reach it and hands the install to the user through Settings › Appearance ›
  Import, which validates the theme, stores it, applies it and selects it on the
  spot.

## [0.4.0] - 2026-08-04

### Added

- **Theme skill.** Asking Claude for a lich theme — a palette ported from
  somewhere else, a tweak to an installed one, or a fix for one lich refused —
  no longer starts by reading `docs/themes.md` in the lich repository. The skill
  carries the shape (31 app tokens plus the xterm palette), the role each token
  actually plays in the interface, where the file goes on each OS, and the
  failure modes that show nothing on screen: a file copied into the themes
  directory under a name that is not `<id>.json`, a terminal color that is not
  hex, a dark palette declared `light`. It ships the same starter template lich
  hands out and a `validate.mjs` that checks a theme against the rules the
  backend enforces on import.

## [0.3.1] - 2026-07-24

### Fixed

- The session-start hook no longer requires `jq`: on Windows `jq` is usually
  absent, so the hook was silently no-opping and the Claude `session_id` never
  reached lich (state hooks kept working since they use only `curl`). It now
  falls back to `sed` to read the payload and builds the request body inline,
  matching `report-state.sh`. Contract: `docs/session-start.md`.

## [0.3.0] - 2026-07-23

### Changed

- The session-start hook now sends `provider_session_id` instead of
  `claude_session_id`: lich renamed the stored id to a provider-agnostic one
  (the payload field is the contract side of it). lich still accepts the old
  alias for plugins up to v0.2.0, but a plugin sending the new field needs a
  lich that already understands it — release this only after the lich release
  carrying the rename. Contract: `docs/session-start.md`.
- `docs/session-start.md`: the report also marks the card as running Claude
  (its icon) until `SessionEnd → idle` clears it — a lich-side effect of the
  same report, no extra call from the plugin.

## [0.2.0] - 2026-07-14

### Added

- Session-state hook now also reports `waiting`: `Notification` (permission
  decision needed or idle waiting for input) posts `waiting` to lich, which
  shows a bell on the session card and raises an actionable toast. A later
  `busy`/`done` clears it. Contract: `docs/session-state.md`.
- `PostToolUse` reports `busy`, recovering the spinner after a `waiting` is
  answered — permission decisions, plan approvals and `AskUserQuestion`
  answers do not fire `UserPromptSubmit`, but the tool that resumes work
  fires `PostToolUse`.
- `SessionEnd` reports `idle`, clearing the card's indicator (no
  spinner/check/bell) — a stale state does not linger on a dead session, and
  a `/clear` starts the next session with a clean card.
- Session-touched hook: `PostToolUse` on file-mutating tools only
  (`Edit|Write|NotebookEdit|Bash`) posts to lich (`POST /session-touched`),
  which refreshes that session's git status ahead of its ~3s poll. Latency
  optimization only — without the plugin the poll catches the same changes.
  Contract: `docs/session-touched.md`.

## [0.1.0] - 2026-07-13

### Added

- Session-start hook: `SessionStart` reports Claude Code's own session id to
  lich (`POST /session-start`), so lich can persist the link between its
  session and the Claude session running inside it. Fires on startup, resume,
  `/clear` and compaction; each report overwrites the stored id. Requires
  `jq` (absent → no-op). Contract: `docs/session-start.md`.
- Session-title hook: `Stop` extracts the last `ai-title` from the transcript
  and reports it to lich (`POST /session-title`), which names the session
  card after it while the label is still automatic. Extraction failures are
  swallowed. Requires `jq` (absent → no-op). Contract: `docs/session-title.md`.
- Marketplace manifest (`.claude-plugin/marketplace.json`), so the repository
  installs directly via `claude plugin marketplace add omartelo/lich-plugin` +
  `claude plugin install lich@lich-plugin`. README documents marketplace and
  manual (clone-based) installation.

### Changed

- Contracts are now canonical in the lich repository (`docs/hooks/` there).
  Plugin docs became thin client-side pointers, one per contract:
  `docs/session-state-contract.md` → `docs/session-state.md`, plus
  `docs/session-start.md` and `docs/session-title.md`.

## [0.0.1] - 2026-07-13

### Added

- Session-state hook: `UserPromptSubmit` reports `busy` and `Stop` reports
  `done` to the lich harness over token-authenticated HTTP loopback
  (`POST /hook`), following the contract in `docs/session-state-contract.md`.
  Outside lich (env vars absent) the hook is a no-op with exit 0, so the
  plugin is safe to install globally. Requests time out after ~1s and errors
  are swallowed — the hook never blocks or fails the turn.

[Unreleased]: https://github.com/omartelo/lich-plugin/compare/v0.10.0...HEAD
[0.10.0]: https://github.com/omartelo/lich-plugin/compare/v0.9.2...v0.10.0
[0.9.2]: https://github.com/omartelo/lich-plugin/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/omartelo/lich-plugin/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/omartelo/lich-plugin/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/omartelo/lich-plugin/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/omartelo/lich-plugin/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/omartelo/lich-plugin/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/omartelo/lich-plugin/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/omartelo/lich-plugin/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/omartelo/lich-plugin/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/omartelo/lich-plugin/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/omartelo/lich-plugin/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/omartelo/lich-plugin/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/omartelo/lich-plugin/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/omartelo/lich-plugin/releases/tag/v0.0.1
