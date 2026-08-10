// Pins this plugin's hook scripts to lich's contract fixtures.
//
// lich owns the endpoints, this repository owns the scripts that build the
// payloads. The fixtures in tests/fixtures/ are lich's, vendored verbatim
// (tests/refresh-fixtures.sh); they are upstream truth and are never edited to
// make a run green.
//
// Every case here drives a real script as a subprocess — the command line taken
// from the hook registration a harness actually reads — against a stub HTTP
// server, and asserts the body it POSTs.
//
// Run: node --test tests/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')

const TOKEN = 'test-token'
const LICH_SESSION_ID = 'lich-session-1'

// ---------------------------------------------------------------- fixtures --

/** endpoint → fixture file, per lich's docs/hooks/fixtures/README.md. */
const FIXTURE_OF = {
  '/hook': 'session-state',
  '/session-start': 'session-start',
  '/session-title': 'session-title',
  '/session-touched': 'session-touched',
}

const readFixture = (name) =>
  readFileSync(path.join(HERE, 'fixtures', `${name}.jsonl`), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))

const CASES = Object.fromEntries(
  Object.entries(FIXTURE_OF).map(([endpoint, file]) => [endpoint, readFixture(file)]),
)

const accepted = (endpoint) => CASES[endpoint].filter((c) => c.accept)
const rejected = (endpoint) => CASES[endpoint].filter((c) => c.reject)

// Enumerations come from the fixtures, not from a copy of them kept here: a
// state or a provider that lich stops accepting stops being accepted below too.
const STATES = new Set(accepted('/hook').map((c) => c.accept.state))
const PROVIDERS = new Set(accepted('/session-start').map((c) => c.accept.provider))

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const blank = (v) => typeof v !== 'string' || v.trim() === ''

/**
 * `reject` prose is documentation, not a matcher, so each rejected case is
 * modelled here as a predicate: true means the body is the shape that case
 * describes. A rejected case with no rule fails its own test below, so a new
 * one upstream cannot slip through unmodelled.
 */
const REJECT_RULES = {
  '/hook': {
    'missing session_id': (b) => !('session_id' in b),
    'empty session_id': (b) => b.session_id === '',
    'missing state': (b) => !('state' in b),
    'unknown state': (b) => 'state' in b && !STATES.has(b.state),
    'state is case sensitive': (b) =>
      typeof b.state === 'string' && !STATES.has(b.state) && STATES.has(b.state.toLowerCase()),
    'malformed json': (b, raw) => !isJsonObject(raw),
  },
  '/session-start': {
    'missing session_id': (b) => !('session_id' in b),
    'missing provider_session_id': (b) => !('provider_session_id' in b) && !('claude_session_id' in b),
    'empty provider_session_id': (b) => b.provider_session_id === '',
    'unregistered provider': (b) => 'provider' in b && !PROVIDERS.has(b.provider),
    'malformed json': (b, raw) => !isJsonObject(raw),
  },
  '/session-title': {
    'missing session_id': (b) => !('session_id' in b),
    'missing title': (b) => !('title' in b),
    'empty title': (b) => b.title === '',
    'blank title': (b) => 'title' in b && blank(b.title),
    'malformed json': (b, raw) => !isJsonObject(raw),
  },
  '/session-touched': {
    'missing session_id': (b) => !('session_id' in b),
    'empty session_id': (b) => b.session_id === '',
    'malformed json': (b, raw) => !isJsonObject(raw),
  },
}

function isJsonObject(raw) {
  try {
    return isObject(JSON.parse(raw))
  } catch {
    return false
  }
}

/**
 * Compares a sent body against every `accept` case's `body` for the endpoint:
 * same key set, and each value of the same class (a non-blank string stays a
 * non-blank string). Values themselves are dynamic — session ids and titles are
 * whatever the session happens to hold — so only shape is asserted here;
 * enumerated values are pinned by the reject rules.
 *
 * Returns the name of the case it matches, or null.
 */
function matchingAcceptCase(endpoint, body) {
  const shape = (o) =>
    Object.keys(o)
      .sort()
      .map((k) => `${k}:${blank(o[k]) ? typeof o[k] + '(blank)' : typeof o[k]}`)
      .join(',')
  const sent = shape(body)
  return accepted(endpoint).find((c) => c.body && shape(c.body) === sent)?.name ?? null
}

function assertContractHonoured(endpoint, request) {
  assert.equal(request.method, 'POST')
  assert.equal(
    request.url,
    `${endpoint}?token=${TOKEN}`,
    `posted to ${request.url}, expected ${endpoint}?token=${TOKEN}`,
  )
  assert.match(request.headers['content-type'] ?? '', /application\/json/)

  assert.ok(isJsonObject(request.raw), `body is not a JSON object: ${request.raw}`)
  const body = JSON.parse(request.raw)

  // 4. claude_session_id is a deprecated alias lich still folds for plugins
  //    released before v0.3.0. Nothing shipping today emits it.
  assert.ok(!('claude_session_id' in body), `body still sends claude_session_id: ${request.raw}`)

  const match = matchingAcceptCase(endpoint, body)
  assert.ok(match, `body matches no accepted shape for ${endpoint}: ${request.raw}`)

  for (const [name, violates] of Object.entries(REJECT_RULES[endpoint])) {
    assert.ok(!violates(body, request.raw), `body is the rejected shape "${name}": ${request.raw}`)
  }
  return { body, match }
}

// ------------------------------------------------------------------ harness --

async function startStub({ status = 204 } = {}) {
  const requests = []
  const server = createServer((req, res) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, raw })
      res.writeHead(status).end()
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    requests,
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

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

const lichEnv = (port) => ({
  LICH_PORT: String(port),
  LICH_TOKEN: TOKEN,
  LICH_SESSION_ID,
})

async function withStub(fn, options) {
  const stub = await startStub(options)
  try {
    return await fn(stub)
  } finally {
    await stub.close()
  }
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
]

const SCRIPTS = {
  'report-state.sh': '/hook',
  'report-tool.sh': '/hook',
  'report-session-start.sh': '/session-start',
  'report-title.sh': '/session-title',
  'report-touched.sh': '/session-touched',
}

function registrations() {
  const out = []
  for (const { provider, file } of HOOK_FILES) {
    const json = JSON.parse(readFileSync(path.join(ROOT, file), 'utf8'))
    for (const [event, groups] of Object.entries(json.hooks)) {
      for (const group of groups) {
        for (const hook of group.hooks) {
          const script = Object.keys(SCRIPTS).find((s) => hook.command.includes(s))
          assert.ok(script, `unknown script in ${file}: ${hook.command}`)
          out.push({
            provider,
            file,
            event,
            matcher: group.matcher,
            command: hook.command,
            script,
            endpoint: SCRIPTS[script],
            argument: hook.command.trim().split(/\s+/).slice(1).join(' '),
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
}

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
}

/** What the harness puts on stdin for the event this registration rides. */
function stdinFor({ provider, event }) {
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
  assert.deepEqual([...PROVIDERS].sort(), ['claude', 'codex'])
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

test('every script is registered by both providers', () => {
  for (const provider of ['claude', 'codex']) {
    const scripts = new Set(REGISTRATIONS.filter((r) => r.provider === provider).map((r) => r.script))
    assert.deepEqual([...scripts].sort(), Object.keys(SCRIPTS).sort(), `${provider} misses a script`)
  }
})

test('every registered state argument is an accepted state', () => {
  const sent = REGISTRATIONS.filter((r) => r.script === 'report-state.sh').map((r) => r.argument)
  assert.ok(sent.length > 0)
  for (const state of sent) assert.ok(STATES.has(state), `registration reports unknown state "${state}"`)
  // Both registrations wire up the whole vocabulary; Codex's SessionEnd never
  // fires today, but the entry is deliberate (docs/providers.md).
  for (const provider of ['claude', 'codex']) {
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
