// Pins the Claude Code mod that runs a subagent as a lich session
// (hooks/agent-cards.js) to the lich CLI it drives: the argv of `lich open` and
// `lich wait`, how each outcome they print is answered, and the rule that a
// call the mod does not take goes to the native agent untouched.
//
// Like tests/mod-control.test.mjs it imports the module and hands it a fake
// engine. The `e` fields, `next.origin`, `next.signal`, the Agent result arms
// and the `$.process.run` behaviour were measured on Claude Code 2.1.289; the
// CLI's output shapes and exit codes are docs/cli.md in lich (`open --json`,
// `wait --json`, Exit status).
//
// Run: node --test tests/

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { register } from '../hooks/agent-cards.js'

const LICH_BIN = '/opt/lich/bin/lich'
const ENV = { LICH_BIN, LICH_SESSION_ID: 'lich-1', LICH_PORT: '47999', LICH_TOKEN: 'tok' }
const TICKET = 'a1b2c3d4'
const BRANCH = 'fix-the-auth-flow-ab12'
const OPENED = {
  id: '9f8e',
  projectId: 'p1',
  project: 'lich',
  label: BRANCH,
  name: `${BRANCH}-9f8e`,
  kind: 'claude',
  path: `/wt/${BRANCH}`,
  nextSeq: 5,
  originSessionId: '3c4d',
  originLabel: 'planner',
}
const AGENT = {
  tool: 'Agent',
  tool_use_id: 'toolu_01QxW7zAB12',
  description: 'Fix the auth flow',
  prompt: 'Fix the login bug in auth/login.go and run its tests.',
  subagent_type: 'general-purpose',
}
const NATIVE = { result: 'the native agent ran' }

const report = (status, answer = '') => ({ ticket: TICKET, target: BRANCH, status, answer })
const opened = (status, answer) => ({ ...OPENED, delivery: report(status, answer) })

/** One scripted `$.process.run` answer: the child exited with `code`. */
const exits = (code, stdout = '', stderr = '') => () => ({
  exitCode: code,
  stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout),
  stderr,
  isStdoutTruncated: false,
  isStderrTruncated: false,
})
const rejects = (message) => () => Promise.reject(new Error(message))
const onBranch = (name) => exits(0, `${name}\n`)

const waitArgv = [LICH_BIN, 'wait', '--timeout', '540', '--json', TICKET]

/**
 * Registers the module against a fake engine. `runs` answers each
 * `$.process.run` in turn; one past the script fails the test. `times` is what
 * `$.clock.now` answers, in turn. A hook registered with a matcher runs only
 * for an `e` holding the matcher's fields, as the engine runs it.
 */
function load({ env = ENV, runs = [], times = [1000, 4000] } = {}) {
  const hooks = new Map()
  register((event, ...rest) => {
    const hook = rest.at(-1)
    const matcher = rest.length > 1 ? rest[0] : {}
    const matches = (e) => Object.entries(matcher).every(([field, value]) => e[field] === value)
    hooks.set(event, ($, e, next) => (matches(e) ? hook($, e, next) : next(e)))
  })

  const ran = []
  const toasts = []
  const script = [...runs]
  const clock = [...times]
  const $ = {
    env: { get: async (name) => env[name] },
    clock: { now: async () => clock.shift() },
    process: {
      run: async (argv, init) => {
        ran.push({ argv, init })
        const answer = script.shift()
        if (!answer) assert.fail(`unscripted run: ${argv.join(' ')}`)
        return answer(argv, init)
      },
    },
    ui: { toast: (text) => toasts.push(text) },
  }

  return {
    ran,
    toasts,
    start: (isInteractive = true) =>
      hooks.get('session.start')($, { cwd: '/w', surface: isInteractive ? 'terminal' : null, isInteractive }, async (e) => e),
    /** Raises one Agent call; `passed` is what reached the native agent. */
    async call(e = AGENT, { plugin = 'engine', signal = new AbortController().signal } = {}) {
      const passed = []
      const next = Object.assign(
        async (forwarded) => {
          passed.push(forwarded)
          return NATIVE
        },
        { origin: { plugin, tier: plugin === 'engine' ? 'core' : 'user' }, signal },
      )
      const answer = await hooks.get('tool.call')($, e, next)
      return { answer, passed }
    },
  }
}

/** Loads the module inside an interactive lich session and raises `e`. */
async function delegate(runs, e = AGENT, options = {}) {
  const mod = load({ runs, ...options })
  await mod.start()
  return { mod, ...(await mod.call(e, options)) }
}

function completed(text, { durationMs = 3000, prompt = AGENT.prompt } = {}) {
  return {
    result: {
      status: 'completed',
      agentId: OPENED.name,
      content: [{ type: 'text', text }],
      totalToolUseCount: 0,
      totalDurationMs: durationMs,
      totalTokens: 0,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        server_tool_use: null,
        service_tier: null,
        cache_creation: null,
      },
      prompt,
      worktreePath: OPENED.path,
      worktreeBranch: BRANCH,
    },
  }
}

const whereItIs = `\n\nThe work is on branch ${BRANCH} in ${OPENED.path} (lich session "${BRANCH}"), not in this checkout.`

function assertNativeUntouched({ answer, passed, mod }, e = AGENT) {
  assert.deepEqual(passed, [e])
  assert.equal(answer, NATIVE)
  assert.deepEqual(mod.ran, [])
}

// --------------------------------------------------------- what it leaves --

test('a call another plugin raised goes to the native agent', async () => {
  const mod = load()
  await mod.start()
  assertNativeUntouched({ mod, ...(await mod.call(AGENT, { plugin: 'other-plugin' })) })
})

test("a subagent's own Agent call goes to the native agent", async () => {
  const mod = load()
  await mod.start()
  const e = { ...AGENT, agentId: 'a7f3' }
  assertNativeUntouched({ mod, ...(await mod.call(e)) }, e)
})

test('every type but general-purpose stays native, an unknown one included', async () => {
  for (const type of ['Explore', 'Plan', 'claude-code-guide', 'addon-studio:troubleshooter', 'does-not-exist']) {
    const mod = load()
    await mod.start()
    const e = { ...AGENT, subagent_type: type }
    assertNativeUntouched({ mod, ...(await mod.call(e)) }, e)
  }
})

test('a teammate stays native', async () => {
  const mod = load()
  await mod.start()
  const e = { ...AGENT, team_name: 'crew' }
  assertNativeUntouched({ mod, ...(await mod.call(e)) }, e)
})

// A `claude -p` run from a tool inside a lich session inherits its variables.
test('a non-interactive run stays native', async () => {
  const mod = load()
  await mod.start(false)
  assertNativeUntouched({ mod, ...(await mod.call()) })
})

test('a session that never reported its start stays native', async () => {
  const mod = load()
  assertNativeUntouched({ mod, ...(await mod.call()) })
})

test('outside lich every call stays native', async () => {
  for (const missing of ['LICH_BIN', 'LICH_SESSION_ID']) {
    const env = { ...ENV }
    delete env[missing]
    const mod = load({ env })
    await mod.start()
    assertNativeUntouched({ mod, ...(await mod.call()) })
  }
})

// --------------------------------------------------------------- the open --

test('a general-purpose call opens a Claude Code session off the current branch', async () => {
  const { mod } = await delegate([onBranch('feat/login'), exits(0, opened('answered', 'done'))])
  assert.deepEqual(mod.ran, [
    { argv: ['git', 'branch', '--show-current'], init: undefined },
    {
      argv: [LICH_BIN, 'open', '--kind', 'claude', '--worktree', BRANCH, '--base', 'feat/login', '--prompt', AGENT.prompt, '--json'],
      init: { timeoutMs: 120000 },
    },
  ])
})

test('a call with no type is a general-purpose one', async () => {
  const e = { ...AGENT }
  delete e.subagent_type
  const { mod, passed } = await delegate([onBranch('main'), exits(0, opened('answered', 'done'))], e)
  assert.deepEqual(passed, [])
  assert.equal(mod.ran[1].argv[1], 'open')
})

test('the model the call names is the model the session starts on', async () => {
  const { mod } = await delegate([onBranch('main'), exits(0, opened('answered', 'done'))], { ...AGENT, model: 'haiku' })
  assert.deepEqual(mod.ran[1].argv.slice(6, 10), ['--base', 'main', '--model', 'haiku'])
})

test('with no current branch the session opens off lich\'s default base', async () => {
  for (const git of [exits(0, '\n'), exits(128, '', 'fatal: not a git repository'), rejects('git: not found')]) {
    const { mod } = await delegate([git, exits(0, opened('answered', 'done'))])
    assert.deepEqual(mod.ran[1].argv, [
      LICH_BIN, 'open', '--kind', 'claude', '--worktree', BRANCH, '--prompt', AGENT.prompt, '--json',
    ])
  }
})

// ------------------------------------------------------------ the branch --

test('the branch is a slug of the description plus the end of the call id', async () => {
  const cases = [
    ['Investigate why the websocket reconnect loop never stops retrying', 'investigate-why-the-websocket-reconnect'],
    ['a b c d e f g', 'a-b-c-d-e'],
    ['Corrigir autenticação do usuário', 'corrigir-autenticação-do-usuário'],
    ['x'.repeat(50), 'x'.repeat(40)],
    ['!!! ???', 'agent'],
    ['', 'agent'],
  ]
  for (const [description, slug] of cases) {
    const { mod } = await delegate([onBranch('main'), exits(0, opened('answered', 'done'))], { ...AGENT, description })
    assert.equal(mod.ran[1].argv[5], `${slug}-ab12`, description)
  }
})

test('the suffix is the last four letters or digits of the call id, lowercased', async () => {
  const e = { ...AGENT, tool_use_id: 'toolu_01XyZ_9Q' }
  const { mod } = await delegate([onBranch('main'), exits(0, opened('answered', 'done'))], e)
  assert.equal(mod.ran[1].argv[5], 'fix-the-auth-flow-yz9q')
})

// ------------------------------------------------------------- the report --

test('an answer at the open comes back as the completed subagent', async () => {
  const { answer, passed, mod } = await delegate([onBranch('main'), exits(0, opened('answered', 'Fixed; tests pass.'))])
  assert.deepEqual(answer, completed(`Fixed; tests pass.${whereItIs}`))
  assert.deepEqual(passed, [])
  assert.deepEqual(mod.toasts, [])
})

test('a pending task is waited on in chunks until it is answered', async () => {
  const { answer, mod } = await delegate([
    onBranch('main'),
    exits(0, opened('pending')),
    exits(2, report('pending')),
    exits(0, report('answered', 'Fixed.')),
  ])
  assert.deepEqual(
    mod.ran.slice(2),
    [
      { argv: waitArgv, init: { timeoutMs: 600000 } },
      { argv: waitArgv, init: { timeoutMs: 600000 } },
    ],
  )
  assert.deepEqual(answer, completed(`Fixed.${whereItIs}`))
})

test('a worker that ended its turn without reporting is a completed subagent saying so', async () => {
  const { answer } = await delegate([onBranch('main'), exits(0, opened('pending')), exits(3, report('unanswered'))])
  assert.deepEqual(
    answer,
    completed(
      `"${BRANCH}" ended its turn without reporting back through lich. What it did is on its card and on branch ` +
        `${BRANCH}; a report it sends later arrives here as a [lich] note.`,
    ),
  )
})

test('a task that never reached the worker is denied, never run natively', async () => {
  for (const status of ['unread', 'undelivered']) {
    for (const runs of [
      [onBranch('main'), exits(0, opened(status))],
      [onBranch('main'), exits(0, opened('pending')), exits(3, report(status))],
    ]) {
      const { answer, passed } = await delegate(runs)
      assert.deepEqual(answer, { deny: `the task never reached "${BRANCH}" (${status}): open its card.` })
      assert.deepEqual(passed, [])
    }
  }
})

// -------------------------------------------- failing over before delegation --

test('a task over lich\'s byte limit runs natively, with a toast saying why', async () => {
  const e = { ...AGENT, prompt: 'é'.repeat(4097) }
  const { mod, answer, passed } = await delegate([], e)
  assert.deepEqual(passed, [e])
  assert.equal(answer, NATIVE)
  assert.deepEqual(mod.ran, [])
  assert.deepEqual(mod.toasts, [
    'lich: ran "Fix the auth flow" as a Claude Code subagent: the task is 8194 bytes, over lich\'s 8192',
  ])
})

test('a task exactly at the byte limit goes to lich', async () => {
  const e = { ...AGENT, prompt: 'é'.repeat(4096) }
  const { passed } = await delegate([onBranch('main'), exits(0, opened('answered', 'done'))], e)
  assert.deepEqual(passed, [])
})

test('an open that failed runs natively, with lich\'s reason in a toast', async () => {
  const { mod, answer, passed } = await delegate([onBranch('main'), exits(1, '', 'lich: no lich is running\n')])
  assert.deepEqual(passed, [AGENT])
  assert.equal(answer, NATIVE)
  assert.deepEqual(mod.toasts, ['lich: ran "Fix the auth flow" as a Claude Code subagent: lich: no lich is running'])
})

test('an open whose task never reached the session runs natively, naming the card', async () => {
  const { mod, passed } = await delegate([
    onBranch('main'),
    exits(1, OPENED, 'lich: the session is open, but the task did not reach it: its terminal ended\n'),
  ])
  assert.deepEqual(passed, [AGENT])
  assert.equal(mod.toasts.length, 1)
  assert.match(mod.toasts[0], new RegExp(`^lich: ran "Fix the auth flow" as a Claude Code subagent: the task did not reach "${BRANCH}"`))
})

test('an open that could not run at all runs natively, with a toast', async () => {
  const { mod, passed } = await delegate([onBranch('main'), rejects('$.process.run(lich) aborted: still running after 120000ms')])
  assert.deepEqual(passed, [AGENT])
  assert.deepEqual(mod.toasts, [
    'lich: ran "Fix the auth flow" as a Claude Code subagent: $.process.run(lich) aborted: still running after 120000ms',
  ])
})

// Esc while the open is in flight: lich may already have opened the card and
// handed it the task, so running the agent natively as well could do it twice.
test('an open the user interrupted is denied, never run natively', async () => {
  const stop = new AbortController()
  const { answer, passed, mod } = await delegate(
    [
      onBranch('main'),
      () => {
        stop.abort()
        return Promise.reject(new Error('$.process.run(lich) aborted'))
      },
    ],
    AGENT,
    { signal: stop.signal },
  )
  assert.deepEqual(passed, [])
  assert.deepEqual(mod.toasts, [])
  assert.deepEqual(answer, {
    deny: `interrupted; a lich session on branch ${BRANCH} may already have the task, and a report it sends arrives here as a [lich] note.`,
  })
})

// ------------------------------------------------ never native after delegation --

test('a wait that failed after the task reached the worker is denied, never run natively', async () => {
  for (const wait of [exits(1, '', 'lich: no lich is running\n'), rejects('$.process.run(lich) aborted: still running after 600000ms')]) {
    const { answer, passed, mod } = await delegate([onBranch('main'), exits(0, opened('pending')), wait])
    assert.deepEqual(passed, [])
    assert.deepEqual(mod.toasts, [])
    assert.match(answer.deny, new RegExp(`^lich stopped answering about "${BRANCH}" \\(.+\\)\\. It is still running on branch ${BRANCH}; a report it sends arrives here as a \\[lich\\] note\\.$`))
  }
})

test('a status this mod does not know is denied, never run natively', async () => {
  const { answer, passed } = await delegate([onBranch('main'), exits(0, opened('pending')), exits(3, report('mislaid'))])
  assert.deepEqual(passed, [])
  assert.match(answer.deny, /^lich stopped answering about .+ \(lich answered "mislaid"\)/)
})

test('Esc during the wait stops the wait, not the worker', async () => {
  const stop = new AbortController()
  const { answer, passed } = await delegate(
    [
      onBranch('main'),
      exits(0, opened('pending')),
      () => {
        stop.abort()
        return Promise.reject(new Error('$.process.run(lich) aborted'))
      },
    ],
    AGENT,
    { signal: stop.signal },
  )
  assert.deepEqual(passed, [])
  assert.deepEqual(answer, {
    deny: `interrupted; "${BRANCH}" keeps running on branch ${BRANCH}, and a report it sends arrives here as a [lich] note.`,
  })
})
