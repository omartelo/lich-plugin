# lich-plugin

The agent side of the integration with **lich** — a harness that orchestrates agent CLI sessions. This companion plugin is how lich observes and acts inside a running session. It ships hooks — each following a contract documented in `docs/` — plus skills for work that targets lich itself. One plugin, packaged for **Claude Code**, **OpenAI Codex**, **Antigravity CLI**, **opencode**, **omp** (oh-my-pi) and **Crush** from the same repository root.

## Structure

```
.claude-plugin/plugin.json        # plugin manifest, Claude Code
.claude-plugin/marketplace.json   # marketplace, Claude Code
.codex-plugin/plugin.json         # plugin manifest, Codex
.agents/plugins/marketplace.json  # marketplace, Codex
plugin.json                       # plugin manifest, Antigravity — name and place both fixed
hooks.json                        # hook registration, Antigravity — likewise
hooks/hooks.json                  # hook registration, Claude Code
hooks/codex-hooks.json            # hook registration, Codex
hooks/crush-hooks.json            # hook registration, Crush (hand-merged into crush.json)
hooks/                            # hook scripts (all four run them; only how they are addressed differs)
hooks/detail.jq                   # what a tool call acts on, shared by two of those scripts
hooks/win-run.cmd                 # runs one of those scripts on Windows (Codex)
opencode/lich.js                  # opencode client: a module, not a command
omp/lich.js                       # omp client: a module, not a command
docs/                             # lich ⇄ plugin communication contracts
skills/                           # skills (skills/<name>/SKILL.md, all)
tests/                            # hook payloads asserted against lich's fixtures
```

**Antigravity** runs the scripts, but on its own terms, and both of them are in
the file layout above. Its plugins are directories — `plugins/<name>/plugin.json`
with `hooks.json` and `skills/` beside it — and neither filename is
configurable, which is why those two sit at the repository root instead of in a
namespaced folder: the root is the plugin directory once the clone is linked in.
It also sets no plugin-root variable, running a hook through `sh -c` with the
working directory set to that root, so its registration alone spells relative
paths; and it reads a JSON verdict off the hook's stdout, so the registration
appends one per event while the scripts stay silent. `agy plugin validate .`
checks the bundle from a clone.

Three harnesses do not fit the script model, each its own way. **opencode** runs
no commands: a plugin there is a JavaScript module its server imports, so all
four reports live in `opencode/lich.js`. **omp** has a `--hook` flag but merges
it with `--extension` into one list it `import()`s, so its "hooks" are modules
too, and its client is `omp/lich.js`. **Crush** runs the scripts unchanged — its
hooks are Claude Code-compatible down to the stdin payload — but has exactly one
event, `PreToolUse`, so only the session id and the touched refresh are
registered for it.

## Contracts

Contracts are **canonical in the lich repository** (`docs/hooks/` there); this plugin only implements the client side. Each hook has a doc in `docs/` here that points at its contract and describes the plugin-side behavior. Read it before creating or changing a hook:

- [docs/session-state.md](docs/session-state.md) — session-state reporting (`busy`/`done`) via `UserPromptSubmit`/`Stop`, and the tool a turn is running via `PreToolUse`
- [docs/session-start.md](docs/session-start.md) — Claude session id via `SessionStart`
- [docs/session-title.md](docs/session-title.md) — auto-generated `ai-title` via `Stop`
- [docs/session-touched.md](docs/session-touched.md) — git-status refresh signal via `PostToolUse` (file-mutating tools only)
- [docs/providers.md](docs/providers.md) — the per-harness map, including what installing on omp takes and what it cannot report

Each doc carries the event mapping for **every** provider, one column each — a contract is implemented once and registered per harness. [docs/providers.md](docs/providers.md) is the map: which file each harness reads, where the event vocabularies differ, and what adding another provider takes. A harness that cannot close a state does not get that report registered: an unendable `busy` is worse on a card than a card with no indicator.

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
environment → no report, exit 0 on a 500 or a refused connection).
[tests/opencode.test.mjs](tests/opencode.test.mjs) does the same for the
opencode module, which is imported rather than spawned, and fed the event
payloads a real opencode run emits — including the sub-session ones it must
drop and the listener that never answers, which must not hold the turn.
[tests/omp.test.mjs](tests/omp.test.mjs) does the same for the omp module,
against the events and `ctx.sessionManager` methods measured on omp v17.3.0 —
pinned in a comment there, because 17.x moves fast — plus the rule that outside
lich it subscribes to nothing at all.
[tests/contract.mjs](tests/contract.mjs) is the fixtures, the assertions and the
stub, shared so every client answers to the same lines. Node only, no
dependencies.

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
- One script per contract, shared by every provider that runs commands. Registration differs per harness, the report does not — extend a script to read a second transcript format before adding a second script. A harness that runs no commands at all is the one case for a client of its own, which is what `opencode/lich.js` and `omp/lich.js` are; they still send the same payloads to the same endpoints.
- opencode and omp both await their plugin handlers, so neither `lich.js` ever awaits a report or throws — that is their version of "always exit 0". The omp one also subscribes to nothing outside lich: omp loads it on every run on the machine, so the gate has to be in the module.
- **A module client names only events it was measured emitting.** A name read off a type declaration is a report that silently never fires, which is worse than an absent feature — the omp `waiting` state is left unreported for exactly this reason.
- **The same goes for every other name a registration carries** — an event, a tool a matcher names, a payload field, a plugin-root variable. All of them fail the same way: quietly, on every event, with a green test suite, because a harness that never runs the hook reports nothing to disagree with.
- **A name is measured off a real payload, or it is a guess.** Not from a harness you already support, and not from a symbol table or an enum either — those are the *implementation's* names, and something may map them before they reach a hook. Antigravity is the worked example in both directions: its guide says a tool name is the step type lowercased with `CORTEX_STEP_TYPE_` dropped, and the enum's `MCP_TOOL` still arrives as `call_mcp_tool`. Its write tools really are `write_to_file` and `replace_file_content`, which the enum does not contain. Run the turn, print the payload, read the name off it — a matcher built any other way matches nothing, and losing a report costs no error, only the report.
- **A test that supplies what the harness supplies proves nothing.** The suite exports `$CLAUDE_PLUGIN_ROOT` because Claude Code and Codex do; running Antigravity's registration under it hid the fact that Antigravity does not. Each harness's registration is run the way *that* harness runs it — see `pluginRoot` in `tests/hooks.test.mjs`.

## Local testing

```bash
claude --plugin-dir .
```

Codex has no equivalent one-shot flag; install the clone as a local marketplace instead (`codex plugin marketplace add .` then `codex plugin add lich@lich-plugin`), and trust the hooks once with `/hooks`.

Antigravity has none either, but it does have a checker: `agy plugin validate .`
reads the clone as a plugin and says what it loaded (`skills: 1`, `hooks: 1`) —
a missing or misplaced `plugin.json` fails it outright. To run it for real,
symlink the clone into `~/.gemini/config/plugins/lich`.

## Release

Same standard as the `lich` repository (Keep a Changelog + SemVer). Releases are cut by tagging `vX.Y.Z`:

1. Move the `[Unreleased]` entries in `CHANGELOG.md` under the new version heading (with date) and refresh the compare links at the bottom.
2. Align `version` in `.claude-plugin/plugin.json` **and** `.codex-plugin/plugin.json` with the tag.
3. Annotated tag `vX.Y.Z` + push with the tag.
4. `gh release create vX.Y.Z` with the notes taken from the matching `CHANGELOG.md` section.
