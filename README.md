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

## Local testing

```bash
claude --plugin-dir .
```

Outside lich (env vars absent) the hooks are a no-op — the plugin is safe to install globally.
