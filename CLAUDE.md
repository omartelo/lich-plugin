# lich-plugin

The agent side of the integration with **lich** — a harness that orchestrates agent CLI sessions. This companion plugin is how lich observes and acts inside a running session. It ships hooks — each following a contract documented in `docs/` — plus skills for work that targets lich itself. One plugin, packaged for **Claude Code** and **OpenAI Codex** from the same repository root.

## Structure

```
.claude-plugin/plugin.json        # plugin manifest, Claude Code
.claude-plugin/marketplace.json   # marketplace, Claude Code
.codex-plugin/plugin.json         # plugin manifest, Codex
.agents/plugins/marketplace.json  # marketplace, Codex
hooks/hooks.json                  # hook registration, Claude Code
hooks/codex-hooks.json            # hook registration, Codex
hooks/                            # hook scripts ($CLAUDE_PLUGIN_ROOT/hooks/<script>, both)
docs/                             # lich ⇄ plugin communication contracts
skills/                           # skills (skills/<name>/SKILL.md, both)
tests/                            # hook payloads asserted against lich's fixtures
```

## Contracts

Contracts are **canonical in the lich repository** (`docs/hooks/` there); this plugin only implements the client side. Each hook has a doc in `docs/` here that points at its contract and describes the plugin-side behavior. Read it before creating or changing a hook:

- [docs/session-state.md](docs/session-state.md) — session-state reporting (`busy`/`done`) via `UserPromptSubmit`/`Stop`, and the tool a turn is running via `PreToolUse`
- [docs/session-start.md](docs/session-start.md) — Claude session id via `SessionStart`
- [docs/session-title.md](docs/session-title.md) — auto-generated `ai-title` via `Stop`
- [docs/session-touched.md](docs/session-touched.md) — git-status refresh signal via `PostToolUse` (file-mutating tools only)

Each doc carries the event mapping for **every** provider, one column each — a contract is implemented once and registered per harness. [docs/providers.md](docs/providers.md) is the map: which file each harness reads, where the two event vocabularies differ, and what adding a third provider takes.

## Skills

- [skills/theme](skills/theme/SKILL.md) — writing, porting and validating lich color themes, as a single file or as a versioned theme repository. Mirrors the theme contract in the lich repository (`docs/themes.md` there); `template.json` is a copy of the starter lich itself hands out, and `validate.mjs` derives its token sets from that copy. A change to the theme shape, or to the repository contract, lands here too.

## Tests

```bash
node --test tests/*.test.mjs
```

[tests/hooks.test.mjs](tests/hooks.test.mjs) drives every hook script as a real
subprocess — the command line taken from the registration each harness reads —
against a stub HTTP server, and asserts the body it POSTs against lich's
contract fixtures: an accepted shape, no rejected one, the right endpoint and
`?token=`, no deprecated `claude_session_id`, plus the client rules (no lich
environment → no report, exit 0 on a 500 or a refused connection). Node only,
no dependencies.

The fixtures are vendored in `tests/fixtures/` from lich
(`docs/hooks/fixtures/*.jsonl` there) by
[tests/refresh-fixtures.sh](tests/refresh-fixtures.sh), so the suite never needs
the network; CI diffs the copies against upstream and fails on drift.

## Rules

- **The fixtures are upstream truth — never edit one to get a green run.** A
  payload that disagrees with a fixture is a bug in the script, or a contract
  change that lands in lich first (prose, then fixtures, then its endpoint, then
  here).
- A hook must never block or fail the user's turn: short timeout, errors swallowed, always exit 0. On Codex the exit code is louder still — `2` on `PermissionRequest` denies the request, so silence and exit 0 are what keep a report an observation.
- Outside lich (env vars absent) every hook is a no-op with exit 0 — the plugin must be safe to install globally.
- A skill must be useful from any working directory: the user runs the agent CLI on their own project, not on the lich checkout.
- One script per contract, shared by every provider. Registration differs per harness, the report does not — extend a script to read a second transcript format before adding a second script.

## Local testing

```bash
claude --plugin-dir .
```

Codex has no equivalent one-shot flag; install the clone as a local marketplace instead (`codex plugin marketplace add .` then `codex plugin add lich@lich-plugin`), and trust the hooks once with `/hooks`.

## Release

Same standard as the `lich` repository (Keep a Changelog + SemVer). Releases are cut by tagging `vX.Y.Z`:

1. Move the `[Unreleased]` entries in `CHANGELOG.md` under the new version heading (with date) and refresh the compare links at the bottom.
2. Align `version` in `.claude-plugin/plugin.json` **and** `.codex-plugin/plugin.json` with the tag.
3. Annotated tag `vX.Y.Z` + push with the tag.
4. `gh release create vX.Y.Z` with the notes taken from the matching `CHANGELOG.md` section.
