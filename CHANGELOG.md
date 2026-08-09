# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
  hooks once (`/hooks`) before it runs them.
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

### Known ceilings on Codex

- Codex has no `SessionEnd` event, so nothing reports `idle` there: a card keeps
  its last indicator until lich respawns its terminal. The registration keeps
  the entry, which starts working if Codex ever adds the event.

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

[Unreleased]: https://github.com/omartelo/lich-plugin/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/omartelo/lich-plugin/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/omartelo/lich-plugin/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/omartelo/lich-plugin/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/omartelo/lich-plugin/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/omartelo/lich-plugin/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/omartelo/lich-plugin/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/omartelo/lich-plugin/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/omartelo/lich-plugin/releases/tag/v0.0.1
