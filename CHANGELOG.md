# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/omartelo/lich-plugin/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/omartelo/lich-plugin/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/omartelo/lich-plugin/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/omartelo/lich-plugin/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/omartelo/lich-plugin/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/omartelo/lich-plugin/releases/tag/v0.0.1
