# lich-plugin

The Claude Code side of the integration with **lich** — a harness that orchestrates `claude` sessions. This companion plugin is how lich observes and acts inside a running session. It ships hooks — each following a contract documented in `docs/` — plus skills for work that targets lich itself.

## Structure

```
.claude-plugin/plugin.json   # plugin manifest
hooks/hooks.json             # hook registration
hooks/                       # hook scripts (${CLAUDE_PLUGIN_ROOT}/hooks/<script>)
docs/                        # lich ⇄ plugin communication contracts
skills/                      # skills (skills/<name>/SKILL.md)
```

## Contracts

Contracts are **canonical in the lich repository** (`docs/hooks/` there); this plugin only implements the client side. Each hook has a doc in `docs/` here that points at its contract and describes the plugin-side behavior. Read it before creating or changing a hook:

- [docs/session-state.md](docs/session-state.md) — session-state reporting (`busy`/`done`) via `UserPromptSubmit`/`Stop`
- [docs/session-start.md](docs/session-start.md) — Claude session id via `SessionStart`
- [docs/session-title.md](docs/session-title.md) — auto-generated `ai-title` via `Stop`
- [docs/session-touched.md](docs/session-touched.md) — git-status refresh signal via `PostToolUse` (file-mutating tools only)

## Skills

- [skills/theme](skills/theme/SKILL.md) — writing, porting and validating lich color themes. Mirrors the theme contract in the lich repository (`docs/themes.md` there); `template.json` is a copy of the starter lich itself hands out, and `validate.mjs` derives its token sets from that copy. A change to the theme shape in lich lands here too.

## Rules

- A hook must never block or fail the user's turn: short timeout, errors swallowed, always exit 0.
- Outside lich (env vars absent) every hook is a no-op with exit 0 — the plugin must be safe to install globally.
- A skill must be useful from any working directory: the user runs `claude` on their own project, not on the lich checkout.

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
