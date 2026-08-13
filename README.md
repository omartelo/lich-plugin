# lich-plugin

The agent side of the [lich](https://github.com/omartelo/lich) integration. lich is a harness that orchestrates agent CLI sessions; this companion plugin gives it eyes and hands inside each session. It installs on **Claude Code**, **OpenAI Codex**, **opencode**, **omp** (oh-my-pi) and **Crush** from this same repository. Every hook implements a contract that is canonical in the lich repository (`docs/hooks/` there); the docs in `docs/` here point at each contract and describe the client side:

- **session state** — `busy`/`done` on the session card (`UserPromptSubmit`/`Stop`)
- **session start** — persists the agent's session id on the lich session (`SessionStart`)
- **session title** — names the card after the session's own title (`Stop`)
- **session touched** — refreshes the card's git status right after file-mutating tools (`PostToolUse`)

The four are what Claude Code, Codex, opencode and omp report. **Crush reports two of them** — its session id and the git-status refresh — because `PreToolUse` is the only event it has, and a state nothing can end is worse on a card than no state. **omp reports all four minus the bell**: no event of its own for "your turn" has been measured yet, so its card shows a spinner while the agent waits on you. [docs/providers.md](docs/providers.md) has the event mapping per harness.

On **opencode** it also carries the other direction: the seven operations lich
offers a session for driving the sessions beside it — list, send, wait, reply,
open, close, and read the worktrees — as tools of opencode's own. Claude Code and
Codex get those as MCP tools lich registers when it spawns them; opencode cannot
be told about a server on its command line, so they are defined in the module
instead. [docs/opencode-tools.md](docs/opencode-tools.md) has the list and the
two cases where they are deliberately absent.

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
hooks/crush-hooks.json            # hook registration, Crush (merged into crush.json by hand)
hooks/report-state.sh             # session-state hook
hooks/report-tool.sh              # session-state hook: the tool a turn is running
hooks/report-session-start.sh     # session-start hook
hooks/report-title.sh             # session-title hook
hooks/report-touched.sh           # session-touched hook
opencode/lich.js                  # opencode client: all four reports plus the seven tools, one module
omp/lich.js                       # omp client: the reports, one module
docs/                             # client-side docs, one per contract
skills/theme/                     # theme skill: SKILL.md, template.json, validate.mjs
tests/                            # hook payloads asserted against lich's fixtures
```

One set of hook scripts serves Claude Code, Codex and Crush — they live in `hooks/` and are referenced via `$CLAUDE_PLUGIN_ROOT/hooks/<script>`, a variable Codex sets too. opencode and omp run no commands: in both, what gets loaded is a JavaScript module, so each has a single-file client — `opencode/lich.js` and `omp/lich.js` — sending the same payloads to the same endpoints. [docs/providers.md](docs/providers.md) maps the layout and every harness's event names.

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

### opencode

opencode has no marketplace: a plugin is a file in its plugin directory, so dropping it there is the install.

```bash
mkdir -p ~/.config/opencode/plugin
curl -fsSL -o ~/.config/opencode/plugin/lich.js \
  https://raw.githubusercontent.com/omartelo/lich-plugin/main/opencode/lich.js
```

Per project instead of globally, use `.opencode/plugin/lich.js`. Updating means fetching the file again.

### omp (oh-my-pi)

omp has no marketplace of its own either, and its `--hook` and `--extension` flags are one list of modules. It scans `~/.omp/agent/extensions/` without being told, so dropping the file there is the install:

```bash
mkdir -p ~/.omp/agent/extensions
curl -fsSL -o ~/.omp/agent/extensions/lich.js \
  https://raw.githubusercontent.com/omartelo/lich-plugin/main/omp/lich.js
```

To keep it somewhere else, name the path instead — `omp config set extensions '["/path/to/lich.js"]'`, which writes `extensions:` in `~/.omp/agent/config.yml` — or pass `--hook /path/to/lich.js` for a single run. Per project, `.omp/extensions/lich.js` works the same way. Updating means fetching the file again.

### Crush

Crush has no plugin system either: its hooks live in your own `crush.json`. Clone this repository, then merge [`hooks/crush-hooks.json`](hooks/crush-hooks.json) into `~/.config/crush/crush.json` (global) or the project's `crush.json`, replacing `<lich-plugin>` with the absolute path of the clone:

```jsonc
{
  "hooks": {
    "PreToolUse": [
      { "name": "lich session id", "command": "/home/you/src/lich-plugin/hooks/report-session-start.sh crush", "timeout": 5 },
      { "name": "lich git-status refresh", "matcher": "^(edit|write|multiedit|bash)$", "command": "/home/you/src/lich-plugin/hooks/report-touched.sh", "timeout": 5 }
    ]
  }
}
```

`command` is resolved against the working directory, not the config file, so a global install needs the absolute path. Crush reports no session state and no title — see [docs/providers.md](docs/providers.md) for why.

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

Every hook script runs as a real subprocess, from the command line its registration spells, against a stub HTTP server — and the body it POSTs is asserted against [lich's contract fixtures](https://github.com/omartelo/lich/tree/main/docs/hooks/fixtures): an accepted shape, never a rejected one, the right endpoint and token, plus the client rules (no lich environment → no report; exit 0 when lich answers 500 or refuses the connection). The opencode and omp modules are imported instead of spawned and fed the events a real run of each emits, against the same fixtures. All three share `tests/contract.mjs`. The fixtures are vendored in `tests/fixtures/` by `tests/refresh-fixtures.sh`; CI diffs them against upstream so a contract that moves in lich goes red here.
