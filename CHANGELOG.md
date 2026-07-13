# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/omartelo/lich-plugin/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/omartelo/lich-plugin/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/omartelo/lich-plugin/releases/tag/v0.0.1
