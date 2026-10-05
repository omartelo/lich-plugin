// Pins the Claude Code mod that runs a subagent as a lich session
// (hooks/agent-cards.js) to the lich CLI it drives: the argv of `lich open`, how
// each outcome it prints is answered, and the rule that a call the mod does not
// take goes to the native agent untouched.
//
// Like tests/mod-control.test.mjs it imports the module and hands it a fake
// engine. The `e` fields, `next.origin`, `next.signal`, the Agent result arms
// and the `$.process.run` behaviour were measured on Claude Code 2.1.289; the
// CLI's output shapes and exit codes are docs/cli.md in lich (`open --json`,
// Exit status).
//
// Run: node --test tests/

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { register } from '../hooks/agent-cards.js'

const LICH_BIN = '/opt/lich/bin/lich'
const ENV = { LICH_BIN, LICH_SESSION_ID: 'lich-1', LICH_PORT: '47999', LICH_TOKEN: 'tok' }
const TICKET = 'a1b2c3d4'
const BRANCH = 'subagent/fix-the-auth-flow-ab12'
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
const ISOLATED = { ...AGENT, isolation: 'worktree' }
// A worker without isolation opens in the asking session's directory.
const SHARED = { ...OPENED, label: 'claude-2', name: 'claude-2-9f8e', path: '/w' }
const NATIVE = { result: 'the native agent ran' }

const report = (status, answer = '') => ({ ticket: TICKET, target: BRANCH, status, answer })
const opened = (status, answer) => ({ ...OPENED, delivery: report(status, answer) })
const openedHere = (status, answer) => ({ ...SHARED, delivery: report(status, answer) })

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

function completed(text, { durationMs = 3000, prompt = AGENT.prompt, worker = OPENED } = {}) {
  const worktree = worker === OPENED ? { worktreePath: OPENED.path, worktreeBranch: BRANCH } : {}
  return {
    result: {
      status: 'completed',
      agentId: worker.name,
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
      ...worktree,
    },
  }
}

const reportArrives =
  'Its full report arrives at this prompt on its own as a [lich] note, not as a task notification, so there ' +
  'is no need to call wait_for_answer (it still works). SendMessage cannot reach that session; ' +
  'send_to_session or lich send can.'

function backgrounded({ worker = OPENED } = {}) {
  const where =
    worker === OPENED
      ? `on branch ${BRANCH} in ${OPENED.path}, not in this checkout`
      : `in this same checkout, ${SHARED.path}, and edits its files as you do`
  return {
    result: { status: 'async_launched', agentId: worker.name, description: AGENT.description, prompt: AGENT.prompt, outputFile: '' },
    context: [`The agent runs as the lich session "${worker.label}", ${where}. ${reportArrives}`],
  }
}

const whereItIs =
  `\n\nThe work is on branch ${BRANCH} in ${OPENED.path} (lich session "${BRANCH}"), not in this checkout. ` +
  `Reach that session with send_to_session or lich send, not SendMessage.`
const whereItIsHere =
  `\n\nThe work is in this same checkout, ${SHARED.path} (lich session "${SHARED.label}"). ` +
  `Reach that session with send_to_session or lich send, not SendMessage.`

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

test("a worker on a branch this mod opened keeps its isolated subagents native", async () => {
  const mod = load({ runs: [onBranch('subagent/fix-the-auth-flow-ab12')] })
  await mod.start()
  const { answer, passed } = await mod.call(ISOLATED)
  assert.deepEqual(passed, [ISOLATED])
  assert.equal(answer, NATIVE)
  assert.equal(mod.ran.length, 1)
})

test('a remote agent stays native', async () => {
  const e = { ...AGENT, isolation: 'remote' }
  const mod = load()
  await mod.start()
  assertNativeUntouched({ ...(await mod.call(e)), mod }, e)
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

test('subagents as lich sessions turned off in lich keeps every call native', async () => {
  const mod = load({ env: { ...ENV, LICH_SUBAGENT_CARDS: 'off' } })
  await mod.start()
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

test('a general-purpose call opens a Claude Code subagent session in this checkout, without asking git', async () => {
  const { mod } = await delegate([exits(0, openedHere('answered', 'done'))])
  assert.deepEqual(mod.ran, [
    {
      argv: [LICH_BIN, 'open', '--kind', 'claude', '--subagent', '--prompt', AGENT.prompt, '--json'],
      init: { timeoutMs: 120000 },
    },
  ])
})

test('an isolated call opens the session in a worktree off the current branch', async () => {
  const { mod } = await delegate([onBranch('feat/login'), exits(0, opened('answered', 'done'))], ISOLATED)
  assert.deepEqual(mod.ran, [
    { argv: ['git', 'branch', '--show-current'], init: undefined },
    {
      argv: [
        LICH_BIN, 'open', '--kind', 'claude', '--subagent', '--worktree', BRANCH, '--base', 'feat/login',
        '--prompt', AGENT.prompt, '--json',
      ],
      init: { timeoutMs: 120000 },
    },
  ])
})

test('a call with no type is a general-purpose one', async () => {
  const e = { ...AGENT }
  delete e.subagent_type
  const { mod, passed } = await delegate([exits(0, openedHere('answered', 'done'))], e)
  assert.deepEqual(passed, [])
  assert.equal(mod.ran[0].argv[1], 'open')
})

test('the model the call names is the model the session starts on', async () => {
  const { mod } = await delegate([exits(0, openedHere('answered', 'done'))], { ...AGENT, model: 'haiku' })
  assert.deepEqual(mod.ran[0].argv.slice(4, 7), ['--subagent', '--model', 'haiku'])
  const isolated = await delegate([onBranch('main'), exits(0, opened('answered', 'done'))], { ...ISOLATED, model: 'haiku' })
  assert.deepEqual(isolated.mod.ran[1].argv.slice(7, 11), ['--base', 'main', '--model', 'haiku'])
})

test('with no current branch an isolated session opens off lich\'s default base', async () => {
  for (const git of [exits(0, '\n'), exits(128, '', 'fatal: not a git repository'), rejects('git: not found')]) {
    const { mod } = await delegate([git, exits(0, opened('answered', 'done'))], ISOLATED)
    assert.deepEqual(mod.ran[1].argv, [
      LICH_BIN, 'open', '--kind', 'claude', '--subagent', '--worktree', BRANCH, '--prompt', AGENT.prompt, '--json',
    ])
  }
})

// ------------------------------------------------------------ the branch --

test('the branch is subagent/, a slug of the description and the end of the call id', async () => {
  const cases = [
    ['Investigate why the websocket reconnect loop never stops retrying', 'investigate-why-the-websocket-reconnect'],
    ['a b c d e f g', 'a-b-c-d-e'],
    ['Corrigir autenticação do usuário', 'corrigir-autenticação-do-usuário'],
    ['x'.repeat(50), 'x'.repeat(40)],
    ['!!! ???', 'agent'],
    ['', 'agent'],
  ]
  for (const [description, slug] of cases) {
    const { mod } = await delegate([onBranch('main'), exits(0, opened('answered', 'done'))], { ...ISOLATED, description })
    assert.equal(mod.ran[1].argv[6], `subagent/${slug}-ab12`, description)
  }
})

test('the suffix is the last four letters or digits of the call id, lowercased', async () => {
  const e = { ...ISOLATED, tool_use_id: 'toolu_01XyZ_9Q' }
  const { mod } = await delegate([onBranch('main'), exits(0, opened('answered', 'done'))], e)
  assert.equal(mod.ran[1].argv[6], 'subagent/fix-the-auth-flow-yz9q')
})

// ------------------------------------------------------------- the report --

test('an answer at the open comes back as the completed subagent, with no worktree of its own', async () => {
  const { answer, passed, mod } = await delegate([exits(0, openedHere('answered', 'Fixed; tests pass.'))])
  assert.deepEqual(answer, completed(`Fixed; tests pass.${whereItIsHere}`, { worker: SHARED }))
  assert.deepEqual(passed, [])
  assert.deepEqual(mod.toasts, [])
})

test('an isolated answer at the open comes back with its worktree', async () => {
  const { answer } = await delegate([onBranch('main'), exits(0, opened('answered', 'Fixed; tests pass.'))], ISOLATED)
  assert.deepEqual(answer, completed(`Fixed; tests pass.${whereItIs}`))
})

test('a task still pending at the open comes back at once as a backgrounded agent, never waited on', async () => {
  const { answer, passed, mod } = await delegate([exits(2, openedHere('pending'))])
  assert.deepEqual(answer, backgrounded({ worker: SHARED }))
  assert.equal(mod.ran.length, 1)
  assert.deepEqual(passed, [])
  assert.deepEqual(mod.toasts, [])
})

test('an isolated task still pending at the open says which branch the worker is on', async () => {
  const { answer } = await delegate([onBranch('main'), exits(2, opened('pending'))], ISOLATED)
  assert.deepEqual(answer, backgrounded())
})

test('a worker that ended its turn without reporting is a completed subagent saying so', async () => {
  const { answer } = await delegate([exits(3, openedHere('unanswered'))])
  assert.deepEqual(
    answer,
    completed(
      `"${SHARED.label}" ended its turn without reporting back through lich. What it did is on its card and in ` +
        `this checkout; a report it sends later arrives here as a [lich] note.`,
      { worker: SHARED },
    ),
  )
  const isolated = await delegate([onBranch('main'), exits(3, opened('unanswered'))], ISOLATED)
  assert.deepEqual(
    isolated.answer,
    completed(
      `"${BRANCH}" ended its turn without reporting back through lich. What it did is on its card and on branch ` +
        `${BRANCH}; a report it sends later arrives here as a [lich] note.`,
    ),
  )
})

test('a task that never reached the worker is denied, never run natively', async () => {
  for (const status of ['unread', 'undelivered']) {
    const { answer, passed } = await delegate([onBranch('main'), exits(3, opened(status))], ISOLATED)
    assert.deepEqual(answer, { deny: `the task never reached "${BRANCH}" (${status}): open its card.` })
    assert.deepEqual(passed, [])
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
  const { passed } = await delegate([exits(0, openedHere('answered', 'done'))], e)
  assert.deepEqual(passed, [])
})

test('an open that failed runs natively, with lich\'s reason in a toast', async () => {
  const { mod, answer, passed } = await delegate([exits(1, '', 'lich: no lich is running\n')])
  assert.deepEqual(passed, [AGENT])
  assert.equal(answer, NATIVE)
  assert.deepEqual(mod.toasts, ['lich: ran "Fix the auth flow" as a Claude Code subagent: lich: no lich is running'])
})

test('an open whose task never reached the session runs natively, naming the card', async () => {
  const { mod, passed } = await delegate([
    exits(1, OPENED, 'lich: the session is open, but the task did not reach it: its terminal ended\n'),
  ])
  assert.deepEqual(passed, [AGENT])
  assert.equal(mod.toasts.length, 1)
  assert.match(mod.toasts[0], new RegExp(`^lich: ran "Fix the auth flow" as a Claude Code subagent: the task did not reach "${BRANCH}"`))
})

test('an open that could not run at all runs natively, with a toast', async () => {
  const { mod, passed } = await delegate([rejects('$.process.run(lich) aborted: still running after 120000ms')])
  assert.deepEqual(passed, [AGENT])
  assert.deepEqual(mod.toasts, [
    'lich: ran "Fix the auth flow" as a Claude Code subagent: $.process.run(lich) aborted: still running after 120000ms',
  ])
})

// Esc while the open is in flight: lich may already have opened the card and
// handed it the task, so running the agent natively as well could do it twice.
test('an open the user interrupted is denied, never run natively', async () => {
  const interrupted = () => {
    const stop = new AbortController()
    const run = () => {
      stop.abort()
      return Promise.reject(new Error('$.process.run(lich) aborted'))
    }
    return { run, signal: stop.signal }
  }
  const here = interrupted()
  const { answer, passed, mod } = await delegate([here.run], AGENT, { signal: here.signal })
  assert.deepEqual(passed, [])
  assert.deepEqual(mod.toasts, [])
  assert.deepEqual(answer, {
    deny: 'interrupted; a lich session may already have the task, and a report it sends arrives here as a [lich] note.',
  })
  const isolated = interrupted()
  const onItsBranch = await delegate([onBranch('main'), isolated.run], ISOLATED, { signal: isolated.signal })
  assert.deepEqual(onItsBranch.answer, {
    deny: `interrupted; a lich session on branch ${BRANCH} may already have the task, and a report it sends arrives here as a [lich] note.`,
  })
})

// ------------------------------------------------ never native after delegation --

test('a status this mod does not know is denied, never run natively', async () => {
  const { answer, passed } = await delegate([exits(3, openedHere('mislaid'))])
  assert.deepEqual(passed, [])
  assert.deepEqual(answer, { deny: `lich answered "mislaid" about "${SHARED.label}": open its card.` })
  const isolated = await delegate([onBranch('main'), exits(3, opened('mislaid'))], ISOLATED)
  assert.deepEqual(isolated.answer, { deny: `lich answered "mislaid" about "${BRANCH}", on branch ${BRANCH}: open its card.` })
})
