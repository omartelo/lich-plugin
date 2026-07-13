# lich-plugin

The Claude Code side of the [lich](https://github.com/omartelo/lich) integration. lich is a harness that orchestrates `claude` sessions; this companion plugin gives it eyes and hands inside each session. Every hook implements a contract that is canonical in the lich repository (`docs/hooks/` there); the docs in `docs/` here point at each contract and describe the client side:

- **session state** — `busy`/`done` on the session card (`UserPromptSubmit`/`Stop`)
- **session start** — persists the Claude session id on the lich session (`SessionStart`)
- **session title** — names the card after Claude's auto-generated title (`Stop`)

## Structure

```
.claude-plugin/plugin.json      # plugin manifest (required)
hooks/hooks.json                # hook registration
hooks/report-state.sh           # session-state hook
hooks/report-session-start.sh   # session-start hook
hooks/report-title.sh           # session-title hook
docs/                           # client-side docs, one per contract
```

Hook scripts live in `hooks/` and are referenced from `hooks.json` via
`${CLAUDE_PLUGIN_ROOT}/hooks/<script>`.

## Installation

Add this repository as a marketplace and install the plugin:

```bash
claude plugin marketplace add omartelo/lich-plugin
claude plugin install lich@lich-plugin
```

The same works inside a session with `/plugin marketplace add omartelo/lich-plugin` followed by `/plugin install lich@lich-plugin`.

### Manual (from a clone)

```bash
git clone https://github.com/omartelo/lich-plugin.git
```

Then either load it for a single session:

```bash
claude --plugin-dir ./lich-plugin
```

or register the clone as a local marketplace for a persistent install:

```bash
claude plugin marketplace add ./lich-plugin
claude plugin install lich@lich-plugin
```

Outside lich (env vars absent) the hooks are a no-op — the plugin is safe to install globally.

## Local testing

```bash
claude --plugin-dir .
```
