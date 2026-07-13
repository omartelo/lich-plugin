# lich-plugin

Claude Code plugin for [lich](https://github.com/omartelo/lich) — reports session state (`busy`/`done`) to the harness over HTTP loopback.

## Structure

```
.claude-plugin/plugin.json   # plugin manifest (required)
hooks/hooks.json             # hook registration
hooks/report-state.sh        # state-reporting hook script
docs/                        # lich ⇄ plugin communication contracts
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
