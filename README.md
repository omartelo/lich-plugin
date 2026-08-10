# lich-plugin

The agent side of the [lich](https://github.com/omartelo/lich) integration. lich is a harness that orchestrates agent CLI sessions; this companion plugin gives it eyes and hands inside each session. It installs on **Claude Code** and **OpenAI Codex** from this same repository. Every hook implements a contract that is canonical in the lich repository (`docs/hooks/` there); the docs in `docs/` here point at each contract and describe the client side:

- **session state** — `busy`/`done` on the session card (`UserPromptSubmit`/`Stop`)
- **session start** — persists the agent's session id on the lich session (`SessionStart`)
- **session title** — names the card after the session's own title (`Stop`)
- **session touched** — refreshes the card's git status right after file-mutating tools (`PostToolUse`)

It also ships skills for the parts of lich you configure from inside a session:

- **theme** (`/lich:theme` in Claude Code; on Codex the `theme` skill loads from its description) — write, port or fix a lich color theme: the app tokens, the xterm palette, where the file goes, and a validator for the rules that otherwise fail silently

## Structure

```
.claude-plugin/plugin.json        # plugin manifest, Claude Code
.claude-plugin/marketplace.json   # marketplace, Claude Code
.codex-plugin/plugin.json         # plugin manifest, Codex
.agents/plugins/marketplace.json  # marketplace, Codex
hooks/hooks.json                  # hook registration, Claude Code
hooks/codex-hooks.json            # hook registration, Codex
hooks/report-state.sh             # session-state hook
hooks/report-session-start.sh     # session-start hook
hooks/report-title.sh             # session-title hook
hooks/report-touched.sh           # session-touched hook
docs/                             # client-side docs, one per contract
skills/theme/                     # theme skill: SKILL.md, template.json, validate.mjs
tests/                            # hook payloads asserted against lich's fixtures
```

One set of hook scripts serves both harnesses — they live in `hooks/` and are referenced via `$CLAUDE_PLUGIN_ROOT/hooks/<script>`, a variable Codex sets too. [docs/providers.md](docs/providers.md) maps the layout and the two harnesses' event names.

## Installation

### Claude Code

Add this repository as a marketplace and install the plugin:

```bash
claude plugin marketplace add omartelo/lich-plugin
claude plugin install lich@lich-plugin
```

The same works inside a session with `/plugin marketplace add omartelo/lich-plugin` followed by `/plugin install lich@lich-plugin`.

### Codex

```bash
codex plugin marketplace add omartelo/lich-plugin
codex plugin add lich@lich-plugin
```

Then start a new session and run `/hooks` to review and trust the plugin's hooks — Codex does not run a plugin's hooks until you do, so until then the plugin is installed but silent. Hooks themselves are stable and on by default in current Codex; on older versions set `[features] hooks = true` in `~/.codex/config.toml`.

### Manual (from a clone)

```bash
git clone https://github.com/omartelo/lich-plugin.git
```

Then either load it for a single Claude Code session:

```bash
claude --plugin-dir ./lich-plugin
```

or register the clone as a local marketplace for a persistent install:

```bash
claude plugin marketplace add ./lich-plugin
claude plugin install lich@lich-plugin

codex plugin marketplace add ./lich-plugin
codex plugin add lich@lich-plugin
```

Outside lich (env vars absent) the hooks are a no-op — the plugin is safe to install globally.

## Local testing

```bash
claude --plugin-dir .
```

## Tests

```bash
node --test tests/*.test.mjs
```

Every hook script runs as a real subprocess, from the command line its registration spells, against a stub HTTP server — and the body it POSTs is asserted against [lich's contract fixtures](https://github.com/omartelo/lich/tree/main/docs/hooks/fixtures): an accepted shape, never a rejected one, the right endpoint and token, plus the client rules (no lich environment → no report; exit 0 when lich answers 500 or refuses the connection). The fixtures are vendored in `tests/fixtures/` by `tests/refresh-fixtures.sh`; CI diffs them against upstream so a contract that moves in lich goes red here.
