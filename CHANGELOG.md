# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Marketplace manifest (`.claude-plugin/marketplace.json`), so the repository
  installs directly via `claude plugin marketplace add omartelo/lich-plugin` +
  `claude plugin install lich@lich-plugin`. README documents marketplace and
  manual (clone-based) installation.

## [0.0.1] - 2026-07-13

### Added

- Session-state hook: `UserPromptSubmit` reports `busy` and `Stop` reports
  `done` to the lich harness over token-authenticated HTTP loopback
  (`POST /hook`), following the contract in `docs/session-state-contract.md`.
  Outside lich (env vars absent) the hook is a no-op with exit 0, so the
  plugin is safe to install globally. Requests time out after ~1s and errors
  are swallowed — the hook never blocks or fails the turn.

[Unreleased]: https://github.com/omartelo/lich-plugin/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/omartelo/lich-plugin/releases/tag/v0.0.1
