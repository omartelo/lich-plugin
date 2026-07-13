# lich-plugin

The Claude Code side of the integration with **lich** — a harness that orchestrates `claude` sessions. This companion plugin is how lich observes and acts inside a running session. It currently ships only hooks; each integration point follows a contract documented in `docs/`.

## Structure

```
.claude-plugin/plugin.json   # plugin manifest
hooks/hooks.json             # hook registration
hooks/                       # hook scripts (${CLAUDE_PLUGIN_ROOT}/hooks/<script>)
docs/                        # lich ⇄ plugin communication contracts
```

## Contracts

Contracts are **canonical in the lich repository** (`docs/hooks/` there); this plugin only implements the client side. Each hook has a doc in `docs/` here that points at its contract and describes the plugin-side behavior. Read it before creating or changing a hook:

- [docs/session-state.md](docs/session-state.md) — session-state reporting (`busy`/`done`) via `UserPromptSubmit`/`Stop`
- [docs/session-start.md](docs/session-start.md) — Claude session id via `SessionStart`
- [docs/session-title.md](docs/session-title.md) — auto-generated `ai-title` via `Stop`

## Rules

- A hook must never block or fail the user's turn: short timeout, errors swallowed, always exit 0.
- Outside lich (env vars absent) every hook is a no-op with exit 0 — the plugin must be safe to install globally.

## Local testing

```bash
claude --plugin-dir .
```

## Release

Same standard as the `lich` repository (Keep a Changelog + SemVer). Releases are cut by tagging `vX.Y.Z`:

1. Move the `[Unreleased]` entries in `CHANGELOG.md` under the new version heading (with date) and refresh the compare links at the bottom.
2. Align `version` in `.claude-plugin/plugin.json` with the tag.
3. Annotated tag `vX.Y.Z` + push with the tag.
4. `gh release create vX.Y.Z` with the notes taken from the matching `CHANGELOG.md` section.
