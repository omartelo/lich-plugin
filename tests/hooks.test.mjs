// Pins this plugin's hook scripts to lich's contract fixtures.
//
// Every case here drives a real script as a subprocess — the command line taken
// from the hook registration a harness actually reads — against a stub HTTP
// server, and asserts the body it POSTs. The fixtures, the assertions and the
// stub live in contract.mjs, shared with the opencode client's suite.
//
// Run: node --test tests/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  CASES,
  LICH_SESSION_ID,
  PROVIDERS,
  ROOT,
  REJECT_RULES,
  STATES,
  TOKEN,
  assertContractHonoured,
  lichEnv,
  rejected,
  startStub,
  withStub,
} from './contract.mjs'

/** The ambient environment minus anything lich would inject. */
const BASE_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('LICH_')),
)

/**
 * Runs a hook exactly as its registration spells it: the command string from
 * hooks.json / codex-hooks.json, through a shell, with $CLAUDE_PLUGIN_ROOT set.
 */
function runHook(command, { env = {}, stdin = '' } = {}) {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], {
      env: { ...BASE_ENV, CLAUDE_PLUGIN_ROOT: ROOT, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => {
      stdout += c
    })
    child.stderr.on('data', (c) => {
      stderr += c
    })
    child.stdin.on('error', () => {}) // a script that reads no stdin is fine
    child.stdin.end(stdin)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

// A hook that reports never speaks on stdout: on Codex the session-state hook
// rides PermissionRequest, where output and a non-zero exit are an answer to
// the request rather than an observation.
function assertSilentSuccess(result) {
  assert.equal(result.code, 0, `exited ${result.code}: ${result.stderr}`)
  assert.equal(result.stdout, '', `wrote to stdout: ${result.stdout}`)
}

// ------------------------------------------------------------ registrations --

const HOOK_FILES = [
  { provider: 'claude', file: 'hooks/hooks.json' },
  { provider: 'codex', file: 'hooks/codex-hooks.json' },
  { provider: 'crush', file: 'hooks/crush-hooks.json' },
]

// Crush has no plugin root to expand, so its registration ships the clone's
// path as a placeholder the user replaces. Here it becomes this checkout.
const PLUGIN_ROOT_PLACEHOLDER = '<lich-plugin>'

const SCRIPTS = {
  'report-state.sh': '/hook',
  'report-tool.sh': '/hook',
  'report-session-start.sh': '/session-start',
  'report-title.sh': '/session-title',
  'report-touched.sh': '/session-touched',
}

/**
 * What each harness registers. Claude Code and Codex carry every report; Crush
 * carries the two its single `PreToolUse` event can honour, because a `busy`
 * nothing can end would pin a spinner to a card (docs/providers.md).
 */
const REGISTERED_SCRIPTS = {
  claude: Object.keys(SCRIPTS),
  codex: Object.keys(SCRIPTS),
  crush: ['report-session-start.sh', 'report-touched.sh'],
}

/**
 * A registration group is either Claude Code's shape (a matcher wrapping a
 * `hooks` array) or Crush's (the hook itself, matcher included).
 */
const hooksIn = (group) => (Array.isArray(group.hooks) ? group.hooks : [group])

function registrations() {
  const out = []
  for (const { provider, file } of HOOK_FILES) {
    const json = JSON.parse(readFileSync(path.join(ROOT, file), 'utf8'))
    for (const [event, groups] of Object.entries(json.hooks)) {
      for (const group of groups) {
        for (const hook of hooksIn(group)) {
          const script = Object.keys(SCRIPTS).find((s) => hook.command.includes(s))
          assert.ok(script, `unknown script in ${file}: ${hook.command}`)
          const command = hook.command.split(PLUGIN_ROOT_PLACEHOLDER).join(ROOT)
          out.push({
            provider,
            file,
            event,
            matcher: group.matcher,
            command,
            script,
            endpoint: SCRIPTS[script],
            argument: command.trim().split(/\s+/).slice(1).join(' '),
          })
        }
      }
    }
  }
  return out
}

const REGISTRATIONS = registrations()

// ------------------------------------------------------------- transcripts --

const TMP = mkdtempSync(path.join(tmpdir(), 'lich-plugin-test-'))

/** Claude Code keeps its generated title in the transcript as an ai-title line. */
function claudeTranscript(title, name = 'claude.jsonl') {
  const file = path.join(TMP, name)
  const lines = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
    ...(title === null ? [] : [JSON.stringify({ type: 'ai-title', aiTitle: title })]),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'ok' } }),
  ]
  writeFileSync(file, lines.join('\n') + '\n')
  return file
}

/** Codex generates no title: its rollout carries the first user message. */
function codexTranscript(message, name = 'codex.jsonl') {
  const file = path.join(TMP, name)
  const lines = [
    JSON.stringify({ timestamp: '2026-08-10T12:00:00.000Z', type: 'session_meta', payload: {} }),
    ...(message === null
      ? []
      : [
          JSON.stringify({
            timestamp: '2026-08-10T12:00:01.000Z',
            type: 'event_msg',
            payload: { type: 'user_message', message, kind: 'plain' },
          }),
        ]),
  ]
  writeFileSync(file, lines.join('\n') + '\n')
  return file
}

/**
 * A PATH holding every tool the hooks use except the named one — for the
 * fallbacks a script keeps for machines where a tool is absent.
 */
function binWithout(missing) {
  const dir = path.join(TMP, `bin-without-${missing}`)
  mkdirSync(dir, { recursive: true })
  for (const tool of ['sh', 'sed', 'grep', 'cut', 'head', 'tail', 'cat', 'curl', 'jq']) {
    if (tool === missing) continue
    const found = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim()
    if (!found) continue
    try {
      symlinkSync(found, path.join(dir, tool))
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
    }
  }
  return dir
}

const PROVIDER_SESSION_ID = {
  claude: '9f1c7c1e-8f2a-4c3b-9d5e-2a7b6c4d1e05',
  codex: '018f9c5a-0000-7000-9a3b-1c2d3e4f5c01',
  crush: 'db3492a0-4a6b-4335-8c0b-d4cc43fc4cb0',
  opencode: 'ses_011856954ffe5NEMhsYeTuWykR',
}

// Crush has no transcript to point a hook at: its payload is about the tool.
const TRANSCRIPT = {
  claude: claudeTranscript('Fix the replay ring overflow'),
  codex: codexTranscript('Fix the replay ring overflow\nand its second line'),
}

/**
 * The tool call a PreToolUse payload describes. Both harnesses spell the
 * envelope the same way (`tool_name` / `tool_input`), and Codex reports a shell
 * call as `Bash` with a plain-string `command` exactly as Claude Code does —
 * verified against a real `codex exec` run, not assumed. Its one own word is
 * `apply_patch` (see the details table below).
 */
const TOOL_CALL = {
  claude: { tool_name: 'Bash', tool_input: { command: 'pnpm test', description: 'run the suite' } },
  codex: { tool_name: 'Bash', tool_input: { command: 'go test ./...' } },
  crush: { tool_name: 'write', tool_input: { file_path: 'probe.txt', content: 'ok\n' } },
}

/**
 * What the harness puts on stdin for the event this registration rides. Crush's
 * envelope is Claude Code's with two differences, both taken off a real run: it
 * names the event `event`, and it carries no transcript.
 */
function stdinFor({ provider, event }) {
  if (provider === 'crush') {
    return JSON.stringify({
      event,
      session_id: PROVIDER_SESSION_ID.crush,
      cwd: ROOT,
      ...(event === 'PreToolUse' ? TOOL_CALL.crush : {}),
    })
  }
  return JSON.stringify({
    session_id: PROVIDER_SESSION_ID[provider],
    transcript_path: TRANSCRIPT[provider],
    cwd: ROOT,
    hook_event_name: event,
    ...(event === 'PreToolUse' ? TOOL_CALL[provider] : {}),
  })
}

// ----------------------------------------------------------------- the suite --

test('the vendored fixtures parse and carry exactly one body and one verdict', () => {
  for (const [endpoint, cases] of Object.entries(CASES)) {
    assert.ok(cases.length > 0, `${endpoint} has no cases`)
    const names = new Set()
    for (const c of cases) {
      assert.ok(typeof c.name === 'string' && c.name !== '', `case without a name in ${endpoint}`)
      assert.ok(!names.has(c.name), `duplicate case name "${c.name}" in ${endpoint}`)
      names.add(c.name)
      assert.equal(
        ('body' in c ? 1 : 0) + ('raw' in c ? 1 : 0),
        1,
        `case "${c.name}" must carry exactly one of body/raw`,
      )
      assert.equal(
        ('accept' in c ? 1 : 0) + ('reject' in c ? 1 : 0),
        1,
        `case "${c.name}" must carry exactly one of accept/reject`,
      )
    }
  }
  assert.deepEqual([...STATES].sort(), ['busy', 'done', 'idle', 'waiting'])
  assert.deepEqual([...PROVIDERS].sort(), ['claude', 'codex', 'crush', 'opencode'])
})

test('every rejected case is modelled by a client-side rule', () => {
  for (const endpoint of Object.keys(CASES)) {
    for (const c of rejected(endpoint)) {
      assert.ok(
        c.name in REJECT_RULES[endpoint],
        `${endpoint} fixture rejects "${c.name}" (${c.reject}) with no rule in REJECT_RULES — ` +
          `the contract moved upstream; model it here before trusting the suite`,
      )
    }
  }
})

test('each harness registers exactly the scripts it can honour', () => {
  for (const [provider, expected] of Object.entries(REGISTERED_SCRIPTS)) {
    const scripts = new Set(REGISTRATIONS.filter((r) => r.provider === provider).map((r) => r.script))
    assert.deepEqual([...scripts].sort(), [...expected].sort(), `${provider} registers the wrong set`)
  }
})

test("Crush's registration keeps the placeholder for the clone's path", () => {
  const raw = readFileSync(path.join(ROOT, 'hooks/crush-hooks.json'), 'utf8')
  assert.ok(
    raw.includes(PLUGIN_ROOT_PLACEHOLDER),
    'crush-hooks.json must ship the placeholder, not a path from somebody\'s machine',
  )
})

// Codex substitutes `${KEY}` and nothing else, then hands the line to a shell:
// `$SHELL -lc` on Unix, `cmd.exe /C` on Windows. A bare `$CLAUDE_PLUGIN_ROOT`
// therefore only works by accident — the Unix shell expands what Codex left
// alone, and cmd.exe does not, so every hook ran a path that does not exist.
test("Codex's registration spells the plugin root the way Codex expands it", () => {
  const raw = readFileSync(path.join(ROOT, 'hooks/codex-hooks.json'), 'utf8')
  assert.ok(
    !/\$CLAUDE_PLUGIN_ROOT/.test(raw),
    'codex-hooks.json must use ${CLAUDE_PLUGIN_ROOT}: Codex only substitutes the braced form',
  )
})

// cmd.exe cannot execute a .sh, so the Windows line hands the same script and
// the same argument to win-run.cmd, which finds a POSIX shell for it.
test("Codex's registration runs every hook through the wrapper on Windows", () => {
  const json = JSON.parse(readFileSync(path.join(ROOT, 'hooks/codex-hooks.json'), 'utf8'))
  const hooks = Object.values(json.hooks).flatMap((groups) => groups.flatMap((g) => g.hooks))
  assert.ok(hooks.length > 0)
  for (const hook of hooks) {
    assert.ok(hook.commandWindows, `no commandWindows for ${hook.command}`)
    assert.equal(
      hook.commandWindows,
      `"\${CLAUDE_PLUGIN_ROOT}/hooks/win-run.cmd" ${hook.command}`,
      `commandWindows must wrap the command unchanged: ${hook.command}`,
    )
  }
})

test('every registered state argument is an accepted state', () => {
  const sent = REGISTRATIONS.filter((r) => r.script === 'report-state.sh').map((r) => r.argument)
  assert.ok(sent.length > 0)
  for (const state of sent) assert.ok(STATES.has(state), `registration reports unknown state "${state}"`)
  // A harness that reports state at all wires up the whole vocabulary; Codex's
  // SessionEnd never fires today, but the entry is deliberate. Crush reports no
  // state at all — see docs/providers.md for both.
  for (const [provider, scripts] of Object.entries(REGISTERED_SCRIPTS)) {
    if (!scripts.includes('report-state.sh')) continue
    const states = new Set(
      REGISTRATIONS.filter((r) => r.provider === provider && r.script === 'report-state.sh').map(
        (r) => r.argument,
      ),
    )
    assert.deepEqual([...states].sort(), [...STATES].sort(), `${provider} misses a state`)
  }
})

test('every registered provider argument is a registered provider', () => {
  for (const r of REGISTRATIONS.filter((r) => r.script === 'report-session-start.sh')) {
    assert.ok(PROVIDERS.has(r.argument), `registration reports unknown provider "${r.argument}"`)
    assert.equal(r.argument, r.provider, `${r.file} reports the wrong provider`)
  }
})

// 1-4: shape, endpoint, token, no deprecated alias — for every script, as each
// harness registers it.
for (const registration of REGISTRATIONS) {
  const { provider, event, script, endpoint, argument, matcher } = registration
  const label = [provider, event, script, argument, matcher && `matcher ${matcher}`]
    .filter(Boolean)
    .join(' ')

  test(`${label} posts an accepted payload`, async () => {
    await withStub(async (stub) => {
      const result = await runHook(registration.command, {
        env: lichEnv(stub.port),
        stdin: stdinFor(registration),
      })
      assertSilentSuccess(result)
      assert.equal(stub.requests.length, 1, `sent ${stub.requests.length} requests, expected 1`)

      const { body } = assertContractHonoured(endpoint, stub.requests[0])
      assert.equal(body.session_id, LICH_SESSION_ID)
      if (script === 'report-state.sh') assert.equal(body.state, argument)
      if (script === 'report-tool.sh') {
        assert.equal(body.state, 'busy')
        assert.equal(body.tool, TOOL_CALL[provider].tool_name)
      }
      if (script === 'report-session-start.sh') {
        assert.equal(body.provider, provider)
        assert.equal(body.provider_session_id, PROVIDER_SESSION_ID[provider])
      }
      if (script === 'report-title.sh') assert.equal(body.title, 'Fix the replay ring overflow')
    })
  })
}

test('session-start falls back to claude when the registration passes no provider', async () => {
  await withStub(async (stub) => {
    const result = await runHook(`"${ROOT}/hooks/report-session-start.sh"`, {
      env: lichEnv(stub.port),
      stdin: stdinFor({ provider: 'claude', event: 'SessionStart' }),
    })
    assertSilentSuccess(result)
    const { body } = assertContractHonoured('/session-start', stub.requests[0])
    assert.equal(body.provider, 'claude')
  })
})

test('session-start parses the payload without jq', async () => {
  // Windows ships sed (Git Bash) but rarely jq; the script falls back to sed.
  await withStub(async (stub) => {
    const result = await runHook(`"${ROOT}/hooks/report-session-start.sh" claude`, {
      env: { ...lichEnv(stub.port), PATH: binWithout('jq') },
      stdin: stdinFor({ provider: 'claude', event: 'SessionStart' }),
    })
    assertSilentSuccess(result)
    assert.equal(stub.requests.length, 1)
    const { body } = assertContractHonoured('/session-start', stub.requests[0])
    assert.equal(body.provider_session_id, PROVIDER_SESSION_ID.claude)
  })
})

test('session-start no-ops when the payload carries no session id', async () => {
  await withStub(async (stub) => {
    const result = await runHook(`"${ROOT}/hooks/report-session-start.sh" codex`, {
      env: lichEnv(stub.port),
      stdin: JSON.stringify({ transcript_path: TRANSCRIPT.codex }),
    })
    assertSilentSuccess(result)
    assert.equal(stub.requests.length, 0, 'sent a report with no provider session id')
  })
})

// A title the contract calls blank must never leave the client: the fixture
// rejects "", "   \n" and a missing field alike.
const NO_TITLE = [
  ['claude transcript without an ai-title line', () => claudeTranscript(null, 'no-title.jsonl')],
  ['claude ai-title that is empty', () => claudeTranscript('', 'empty-title.jsonl')],
  ['claude ai-title that is whitespace', () => claudeTranscript('   ', 'blank-title.jsonl')],
  ['codex rollout without a user message', () => codexTranscript(null, 'no-message.jsonl')],
  ['codex first line that is whitespace', () => codexTranscript('   \nreal work', 'blank-line.jsonl')],
  ['codex message that is a newline', () => codexTranscript('\nreal work', 'leading-nl.jsonl')],
]

for (const [label, make] of NO_TITLE) {
  test(`session-title stays silent: ${label}`, async () => {
    await withStub(async (stub) => {
      const result = await runHook(`"${ROOT}/hooks/report-title.sh"`, {
        env: lichEnv(stub.port),
        stdin: JSON.stringify({ session_id: 's', transcript_path: make() }),
      })
      assertSilentSuccess(result)
      assert.equal(
        stub.requests.length,
        0,
        `posted a blank title, which the contract rejects: ${stub.requests[0]?.raw}`,
      )
    })
  })
}

test('session-title trims the title it reports', async () => {
  await withStub(async (stub) => {
    const file = claudeTranscript('  Fix the replay ring overflow  ', 'padded-title.jsonl')
    const result = await runHook(`"${ROOT}/hooks/report-title.sh"`, {
      env: lichEnv(stub.port),
      stdin: JSON.stringify({ session_id: 's', transcript_path: file }),
    })
    assertSilentSuccess(result)
    const { body } = assertContractHonoured('/session-title', stub.requests[0])
    assert.equal(body.title, 'Fix the replay ring overflow')
  })
})

test('session-title escapes a title that would break the JSON body', async () => {
  await withStub(async (stub) => {
    const file = claudeTranscript('Fix "quoted" \\ and \ttabbed', 'quoted-title.jsonl')
    const result = await runHook(`"${ROOT}/hooks/report-title.sh"`, {
      env: lichEnv(stub.port),
      stdin: JSON.stringify({ session_id: 's', transcript_path: file }),
    })
    assertSilentSuccess(result)
    const { body } = assertContractHonoured('/session-title', stub.requests[0])
    assert.equal(body.title, 'Fix "quoted" \\ and \ttabbed')
  })
})

test('session-title no-ops when the transcript is missing', async () => {
  await withStub(async (stub) => {
    const result = await runHook(`"${ROOT}/hooks/report-title.sh"`, {
      env: lichEnv(stub.port),
      stdin: JSON.stringify({ session_id: 's', transcript_path: path.join(TMP, 'absent.jsonl') }),
    })
    assertSilentSuccess(result)
    assert.equal(stub.requests.length, 0)
  })
})

// ---------------------------------------------------------- the tool report --

/** Runs report-tool.sh against a PreToolUse payload and returns the stub's view. */
async function runToolHook(payload, { env = {} } = {}) {
  return withStub(async (stub) => {
    const result = await runHook(`"${ROOT}/hooks/report-tool.sh"`, {
      env: { ...lichEnv(stub.port), ...env },
      stdin: JSON.stringify({ session_id: 's', hook_event_name: 'PreToolUse', ...payload }),
    })
    assertSilentSuccess(result)
    return { requests: stub.requests }
  })
}

test('report-tool no-ops when the payload names no tool', async () => {
  const { requests } = await runToolHook({ tool_input: { command: 'pnpm test' } })
  assert.equal(requests.length, 0, `reported a tool it was never given: ${requests[0]?.raw}`)
})

test('report-tool no-ops when the tool name is empty', async () => {
  const { requests } = await runToolHook({ tool_name: '', tool_input: {} })
  assert.equal(requests.length, 0, `reported an empty tool: ${requests[0]?.raw}`)
})

// The detail is optional in the contract: absent, not blank. A blank one is a
// shape no accept case carries, which assertContractHonoured would catch.
test('report-tool omits the detail when the call carries nothing to say', async () => {
  const { requests } = await runToolHook({ tool_name: 'Read', tool_input: {} })
  const { body, match } = assertContractHonoured('/hook', requests[0])
  assert.equal(match, 'a tool with nothing to say about it')
  assert.equal(body.tool, 'Read')
  assert.ok(!('detail' in body), `sent a detail anyway: ${requests[0].raw}`)
})

// The field, not the tool name, is what one rule can cover for both harnesses.
// The payloads here are the ones a real run produces — the Codex shapes were
// taken off `codex exec` against a stub listener.
const DETAILS = [
  ['a command line', { tool_name: 'Bash', tool_input: { command: 'pnpm test' } }, 'pnpm test'],
  [
    'the file a codex patch adds',
    {
      tool_name: 'apply_patch',
      tool_input: { command: '*** Begin Patch\n*** Add File: probe.txt\n+hello\n*** End Patch' },
    },
    'probe.txt',
  ],
  [
    'the file a codex patch updates',
    {
      tool_name: 'apply_patch',
      tool_input: {
        command: '*** Begin Patch\n*** Update File: internal/terminal/usage.go\n@@\n-a\n+b\n',
      },
    },
    'internal/terminal/usage.go',
  ],
  [
    'the file an edit acts on, against the session directory',
    { cwd: '/w', tool_name: 'Edit', tool_input: { file_path: '/w/internal/terminal/usage.go' } },
    'internal/terminal/usage.go',
  ],
  [
    'a file outside the session directory by its name alone',
    { cwd: '/w', tool_name: 'Read', tool_input: { file_path: '/etc/hosts' } },
    'hosts',
  ],
  [
    'a command that starts with a path, uncut',
    { cwd: '/w', tool_name: 'Bash', tool_input: { command: '/usr/bin/env node build.mjs' } },
    '/usr/bin/env node build.mjs',
  ],
  ['a search pattern', { tool_name: 'Grep', tool_input: { pattern: 'statusEvent' } }, 'statusEvent'],
  [
    'a fetched url',
    { tool_name: 'WebFetch', tool_input: { url: 'https://example.com/a' } },
    'https://example.com/a',
  ],
]

for (const [label, payload, want] of DETAILS) {
  test(`report-tool names ${label}`, async () => {
    const { requests } = await runToolHook(payload)
    const { body } = assertContractHonoured('/hook', requests[0])
    assert.equal(body.state, 'busy')
    assert.equal(body.tool, payload.tool_name)
    assert.equal(body.detail, want)
  })
}

// The whole patch is what Codex passes as the command, so the plain rule would
// put its envelope on the card. A patch naming no file leaves nothing readable,
// and the tool name goes alone rather than "*** Begin Patch".
test('report-tool sends the tool alone when a patch names no file', async () => {
  const { requests } = await runToolHook({
    tool_name: 'apply_patch',
    tool_input: { command: '*** Begin Patch\nmalformed' },
  })
  const { body, match } = assertContractHonoured('/hook', requests[0])
  assert.equal(match, 'a tool with nothing to say about it')
  assert.equal(body.tool, 'apply_patch')
  assert.ok(!('detail' in body), `put a patch envelope on the card: ${requests[0].raw}`)
})

test('report-tool escapes a detail that would break the JSON body', async () => {
  const command = 'grep -n "state" internal/*.go | sed \'s/\\t/ /g\''
  const { requests } = await runToolHook({ tool_name: 'Bash', tool_input: { command } })
  const { body } = assertContractHonoured('/hook', requests[0])
  assert.equal(body.detail, command)
})

// A card is one line high; the rest of a heredoc has nowhere to go.
test('report-tool sends one line of a multi-line command', async () => {
  const { requests } = await runToolHook({
    tool_name: 'Bash',
    tool_input: { command: 'cat <<EOF\nfirst\nsecond\nEOF' },
  })
  const { body } = assertContractHonoured('/hook', requests[0])
  assert.equal(body.detail, 'cat <<EOF')
})

// Windows ships sed (Git Bash) but rarely jq. The name still gets through; the
// detail does not, because a hand-built body cannot escape arbitrary text.
test('report-tool reports the tool alone without jq', async () => {
  const { requests } = await runToolHook(
    { tool_name: 'Bash', tool_input: { command: 'pnpm test' } },
    { env: { PATH: binWithout('jq') } },
  )
  const { body, match } = assertContractHonoured('/hook', requests[0])
  assert.equal(match, 'a tool with nothing to say about it')
  assert.equal(body.tool, 'Bash')
  assert.ok(!('detail' in body), `built a detail without jq: ${requests[0].raw}`)
})

// 5: the client rules — a hook must never block or fail the user's turn.
// `event` is the payload the script is fed: only report-tool.sh reads fields
// that a SessionStart payload does not carry.
const EVERY_SCRIPT = [
  { script: 'report-state.sh', argument: 'busy', event: 'SessionStart' },
  { script: 'report-tool.sh', argument: '', event: 'PreToolUse' },
  { script: 'report-session-start.sh', argument: 'claude', event: 'SessionStart' },
  { script: 'report-title.sh', argument: '', event: 'SessionStart' },
  { script: 'report-touched.sh', argument: '', event: 'SessionStart' },
]

const PARTIAL_ENVS = {
  'no lich variables at all': {},
  'only LICH_PORT': { LICH_PORT: '1' },
  'no LICH_TOKEN': { LICH_PORT: '1', LICH_SESSION_ID },
  'no LICH_SESSION_ID': { LICH_PORT: '1', LICH_TOKEN: TOKEN },
  'blank LICH_SESSION_ID': { LICH_PORT: '1', LICH_TOKEN: TOKEN, LICH_SESSION_ID: '' },
}

for (const { script, argument, event } of EVERY_SCRIPT) {
  for (const [label, env] of Object.entries(PARTIAL_ENVS)) {
    test(`${script} no-ops outside lich: ${label}`, async () => {
      await withStub(async (stub) => {
        const result = await runHook(`"${ROOT}/hooks/${script}" ${argument}`.trim(), {
          // LICH_PORT points at the stub so a leak would be caught, not refused.
          env: { ...env, ...(('LICH_PORT' in env) ? { LICH_PORT: String(stub.port) } : {}) },
          stdin: stdinFor({ provider: 'claude', event }),
        })
        assertSilentSuccess(result)
        assert.equal(stub.requests.length, 0, 'reported without a full lich environment')
      })
    })
  }

  test(`${script} exits 0 when lich answers 500`, async () => {
    await withStub(
      async (stub) => {
        const result = await runHook(`"${ROOT}/hooks/${script}" ${argument}`.trim(), {
          env: lichEnv(stub.port),
          stdin: stdinFor({ provider: 'claude', event }),
        })
        assertSilentSuccess(result)
        assert.equal(stub.requests.length, 1)
      },
      { status: 500 },
    )
  })

  test(`${script} exits 0 when the connection is refused`, async () => {
    const stub = await startStub()
    const { port } = stub
    await stub.close() // nothing listens on that port any more
    const result = await runHook(`"${ROOT}/hooks/${script}" ${argument}`.trim(), {
      env: lichEnv(port),
      stdin: stdinFor({ provider: 'claude', event }),
    })
    assertSilentSuccess(result)
  })
}
