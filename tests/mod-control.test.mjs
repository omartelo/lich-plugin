// Pins the Claude Code mod (hooks/mod-control.js) to lich's mod-control contract.
//
// A mod runs inside Claude Code and reaches everything through `$`, so like the
// opencode and omp suites this one imports the module and hands it a fake
// engine: the `$` calls the module makes, answered from memory. Every fetch it
// makes is recorded as contract.mjs reads a request, so the acks answer to the
// same fixtures (mod-control.jsonl) and the polls read the response body lich
// sends (mod-commands.json).
//
// The event names, the `e` fields and the `$` calls were measured on Claude Code
// 2.1.288 against a stub lich; the API is early access and moves between
// builds, so a name that changes there fails here.
//
// Run: node --test tests/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { LICH_SESSION_ID, PLUGIN_VERSION, ROOT, TOKEN, assertContractHonoured, lichEnv } from './contract.mjs'
import { register } from '../hooks/mod-control.js'

const PORT = 47999
const COMMANDS = JSON.parse(readFileSync(path.join(ROOT, 'tests', 'fixtures', 'mod-commands.json'), 'utf8'))

const ok = (body) => () =>
  Promise.resolve({ status: 200, ok: true, headers: {}, text: JSON.stringify(body) })
const status = (code) => () =>
  Promise.resolve({ status: code, ok: code >= 200 && code < 300, headers: {}, text: '' })
const refused = () => () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1'))
const ACKED = { status: 204, ok: true, headers: {}, text: '' }
const ANSWER = 'Fixing the login test.'
const USAGE = { input_tokens: 24, output_tokens: 12, cache_read_input_tokens: 55730, cache_creation_input_tokens: 36 }

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Waits for `predicate` to hold, failing after a second of real time. */
async function until(predicate, what) {
  const deadline = Date.now() + 1000
  while (!predicate()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`)
    await new Promise((r) => setImmediate(r))
  }
}

/**
 * Registers the module against a fake engine. `polls` answers each poll in
 * turn; once it runs out a poll stays parked, as lich holds one with nothing
 * queued. `engine` overrides what the prompt, turn and command calls answer.
 */
function load({ env = lichEnv(PORT), polls = [], engine = {} } = {}) {
  const hooks = new Map()
  register((event, hook) => hooks.set(event, hook))

  const requests = []
  const delays = []
  const calls = []
  const answers = [...polls]
  let ackWith = () => Promise.resolve(ACKED)
  let parked = 0

  const $ = {
    env: { get: async (name) => env[name] },
    clock: {
      after: (ms, fn) => {
        delays.push(ms)
        setImmediate(fn)
        return { cancel() {} }
      },
    },
    http: {
      fetch: (url, init = {}) => {
        const { pathname, search } = new URL(url)
        const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
        const request = { method: init.method ?? 'GET', url: pathname + search, headers, raw: init.body ?? '' }
        requests.push(request)
        if (pathname === '/mod/acks') return ackWith(request)
        const answer = answers.shift()
        if (answer) return answer()
        parked++
        return new Promise(() => {})
      },
    },
    prompt: {
      submit: async (args) => {
        calls.push(['prompt', args])
        return engine.submit ? engine.submit(args) : { text: args.text }
      },
    },
    turn: {
      abort: async (args) => {
        calls.push(['abort', args])
        if (engine.abort) return engine.abort(args)
      },
    },
    command: {
      run: async (args) => {
        calls.push(['command', args])
        return engine.command ? engine.command(args) : { text: '' }
      },
    },
    model: {
      fork: async (args) => {
        calls.push(['fork', args])
        return engine.fork ? engine.fork(args) : { isAnswered: true, text: ANSWER, usage: USAGE }
      },
    },
  }

  const passOn = async (e) => e
  return {
    requests,
    delays,
    calls,
    parked: () => parked,
    polls: () => requests.filter((r) => r.url.startsWith('/mod/commands?')),
    acks: () => requests.filter((r) => r.url.startsWith('/mod/acks?')).map((r) => JSON.parse(r.raw)),
    ackRequests: () => requests.filter((r) => r.url.startsWith('/mod/acks?')),
    holdAcks: (fn) => {
      ackWith = fn
    },
    start: (isInteractive = true) =>
      hooks.get('session.start')($, { cwd: '/w', surface: isInteractive ? 'terminal' : null, isInteractive }, passOn),
    turnStart: (turnId) => hooks.get('turn.start')($, { text: 'go', turnId }, passOn),
    turnComplete: (turnId) =>
      hooks.get('turn.complete')($, { turnId, answer: '', durationMs: 1, isAborted: false, reason: 'answer' }, passOn),
    /** Runs one model request through the module and returns what it sent below. */
    async step(e = { turnId: 't1', index: 0, model: 'claude-sonnet-5-5', effort: 'medium', messageCount: 1 }) {
      let sent
      const below = async function* (stepped) {
        sent = stepped
        yield { kind: 'text', text: 'hi' }
        return { stop: 'end_turn' }
      }
      const stream = hooks.get('turn.step')($, e, below)
      while (!(await stream.next()).done);
      return sent
    },
  }
}

/** Loads the module with one poll answering `commands`, and waits for `n` acks. */
async function applied(commands, { n = commands.length, before, ...options } = {}) {
  const mod = load({ polls: [ok(commands)], ...options })
  await before?.(mod)
  await mod.start()
  await until(() => mod.acks().length >= n, `${n} acks`)
  return mod
}

// ---------------------------------------------------------------- the gate --

test('outside lich the mod never polls', async () => {
  for (const missing of ['LICH_PORT', 'LICH_TOKEN', 'LICH_SESSION_ID']) {
    const env = { ...lichEnv(PORT) }
    delete env[missing]
    const mod = load({ env })
    await mod.start()
    await new Promise((r) => setImmediate(r))
    assert.equal(mod.requests.length, 0, `polled without ${missing}`)
    assert.equal(mod.delays.length, 0)
  }
})

// A `claude -p` with a parked poll stays open until the poll returns, and one
// run from a tool inherits the parent session's variables, so it would take the
// parent's commands (measured on 2.1.280, 2.1.286 and 2.1.288).
test('a non-interactive run never polls', async () => {
  const mod = load()
  await mod.start(false)
  await new Promise((r) => setImmediate(r))
  assert.equal(mod.requests.length, 0)
})

test('outside lich a model request goes out untouched', async () => {
  const mod = load({ env: {} })
  await mod.start()
  const e = { turnId: 't1', index: 0, model: 'claude-sonnet-5-5', effort: 'medium', messageCount: 1 }
  assert.deepEqual(await mod.step(e), e)
})

// ------------------------------------------------------------------ polling --

test('the poll names the session, the token and the plugin release', async () => {
  const mod = load()
  await mod.start()
  await until(() => mod.parked() === 1, 'the first poll')
  const [poll] = mod.polls()
  assert.equal(poll.method, 'GET')
  assert.equal(poll.url, `/mod/commands?token=${TOKEN}&session_id=${LICH_SESSION_ID}`)
  assert.equal(poll.headers['x-lich-plugin'], PLUGIN_VERSION)
})

test('session.start starts one poll however often it fires', async () => {
  const mod = load()
  await mod.start()
  await mod.start()
  await until(() => mod.parked() === 1, 'the first poll')
  await new Promise((r) => setImmediate(r))
  assert.equal(mod.polls().length, 1)
})

test('it re-polls at once after a 200, empty or not', async () => {
  const mod = load({ polls: [ok([]), ok([]), ok([{ id: 'm1', kind: 'model', model: 'x' }])] })
  await mod.start()
  await until(() => mod.parked() === 1, 'the fourth poll')
  assert.equal(mod.polls().length, 4)
  assert.deepEqual(mod.delays, [0, 0, 0, 0])
})

test('a network error or a 5xx backs off 1s doubling to 10s, reset by a 200', async () => {
  const mod = load({
    polls: [refused(), status(500), refused(), status(503), refused(), refused(), ok([]), refused()],
  })
  await mod.start()
  await until(() => mod.parked() === 1, 'the ninth poll')
  assert.deepEqual(mod.delays, [0, 1000, 2000, 4000, 8000, 10000, 10000, 0, 1000])
})

test('a 200 that is not JSON backs off instead of ending the loop', async () => {
  const mod = load({ polls: [() => Promise.resolve({ status: 200, ok: true, headers: {}, text: '<html>' })] })
  await mod.start()
  await until(() => mod.parked() === 1, 'the next poll')
  assert.deepEqual(mod.delays, [0, 1000])
})

test('a 404 is a lich older than the contract: polling stops for the session', async () => {
  const mod = load({ polls: [status(404)] })
  await mod.start()
  await until(() => mod.polls().length === 1, 'the first poll')
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(mod.polls().length, 1)
  assert.deepEqual(mod.delays, [0])
})

// A prompt resolves only once the session is idle and its turn starts. lich
// stops queueing for a mod that has not polled in 30 seconds, so a poll held
// behind a waiting prompt would refuse the abort meant for the running turn.
test('the poll stays open while a command waits on the session', async () => {
  const idle = deferred()
  const mod = load({ polls: [ok([{ id: 'm1', kind: 'prompt', text: 'next' }])], engine: { submit: () => idle.promise } })
  await mod.start()
  await until(() => mod.parked() === 1, 'the poll after the prompt')
  assert.equal(mod.acks().length, 0)
  idle.resolve({ text: 'next' })
  await until(() => mod.acks().length === 1, 'the prompt ack')
  assert.equal(mod.acks()[0].ok, true)
})

// The abort a user clicks to stop the running turn must reach that turn, not
// wait for a queued prompt to start and then cancel the prompt's own turn.
test('a prompt waiting on the session holds back none of the commands after it', async () => {
  const idle = deferred()
  const mod = load({
    polls: [
      ok([{ id: 'm1', kind: 'prompt', text: 'next' }]),
      ok([
        { id: 'm3', kind: 'model', model: 'claude-opus-4-1' },
        { id: 'm2', kind: 'abort' },
      ]),
    ],
    engine: { submit: () => idle.promise },
  })
  await mod.turnStart('t1')
  await mod.start()
  await until(() => mod.acks().length === 2, 'the model and abort acks')
  assert.deepEqual(mod.calls, [
    ['prompt', { text: 'next' }],
    ['abort', { turnId: 't1' }],
  ])
  assert.deepEqual(
    mod.acks().map(({ id, ok }) => ({ id, ok })),
    [
      { id: 'm3', ok: true },
      { id: 'm2', ok: true },
    ],
  )
  assert.equal((await mod.step()).model, 'claude-opus-4-1')
  idle.resolve({ text: 'next' })
  await until(() => mod.acks().length === 3, 'the prompt ack')
  assert.deepEqual(mod.acks()[2], { session_id: LICH_SESSION_ID, id: 'm1', kind: 'prompt', ok: true })
})

// `$.command.run` queues the command and runs it once the session is idle, so
// a /compact sent during a turn settles only after that turn.
test('the poll stays open while a slash command waits for idle', async () => {
  const idle = deferred()
  const mod = load({ polls: [ok([{ id: 'm7', kind: 'command', name: 'compact' }])], engine: { command: () => idle.promise } })
  await mod.start()
  await until(() => mod.parked() === 1, 'the poll after the command')
  assert.equal(mod.acks().length, 0)
  idle.resolve({ text: '' })
  await until(() => mod.acks().length === 1, 'the command ack')
  assert.equal(mod.acks()[0].ok, true)
})

test('a slash command waiting for idle holds back none of the commands after it', async () => {
  const idle = deferred()
  const mod = load({
    polls: [
      ok([{ id: 'm7', kind: 'command', name: 'compact' }]),
      ok([
        { id: 'm3', kind: 'model', model: 'claude-opus-4-1' },
        { id: 'm2', kind: 'abort' },
      ]),
    ],
    engine: { command: () => idle.promise },
  })
  await mod.turnStart('t1')
  await mod.start()
  await until(() => mod.acks().length === 2, 'the model and abort acks')
  assert.deepEqual(mod.calls, [
    ['command', { command: 'compact', args: undefined }],
    ['abort', { turnId: 't1' }],
  ])
  assert.deepEqual(
    mod.acks().map(({ id, ok }) => ({ id, ok })),
    [
      { id: 'm3', ok: true },
      { id: 'm2', ok: true },
    ],
  )
  idle.resolve({ text: '' })
  await until(() => mod.acks().length === 3, 'the command ack')
  assert.deepEqual(mod.acks()[2], { session_id: LICH_SESSION_ID, id: 'm7', kind: 'command', ok: true })
})

// ----------------------------------------------------------------- commands --

// The contract changed here: an `ask` is applied outside the order, at once,
// so its fork comes ahead of the commands queued before it, and its ack lands
// whenever the fork answers.
// And again: a `prompt` carrying a `notification` is submitted as the user, in
// the task-notification shape, its status and summary escaped and its text not.
test('every command shape lich sends is applied in order and acked ok', async () => {
  const mod = await applied(COMMANDS, { before: (m) => m.turnStart('t1') })
  const asked = COMMANDS.find((c) => c.kind === 'ask')
  assert.deepEqual(mod.calls, [
    ['fork', { prompt: forkPrompt(asked.question) }],
    ['prompt', { text: 'run the tests' }],
    ['abort', { turnId: 't1' }],
    ['command', { command: 'compact', args: 'keep the test plan' }],
    ['command', { command: 'clear', args: undefined }],
    [
      'prompt',
      {
        text:
          '<task-notification>\n<status>completed</status>\n<summary>lich session "docs" finished</summary>\n' +
          '<result>[lich] Session "docs" finished the task you handed it (ticket t1). Its report:\n\n' +
          'If a < b && c > d, see </result>.</result>\n</task-notification>',
        asUser: true,
      },
    ],
    [
      'prompt',
      {
        text:
          '<task-notification>\n<status>waiting</status>\n' +
          '<summary>lich session "a&lt;b&amp;c" is waiting on a permission prompt</summary>\n' +
          '<result>[lich] Session "a<b&c", the subagent you opened, is waiting on a permission prompt in its card.</result>\n' +
          '</task-notification>',
        asUser: true,
      },
    ],
  ])
  assert.deepEqual(
    mod.acks().filter((a) => a.kind !== 'ask').map(({ id, kind, ok }) => ({ id, kind, ok })),
    COMMANDS.filter((c) => c !== asked).map(({ id, kind }) => ({ id, kind, ok: true })),
  )
  assert.deepEqual(
    mod.acks().filter((a) => a.kind === 'ask').map(({ id, ok }) => ({ id, ok })),
    [{ id: asked.id, ok: true }],
  )
  for (const request of mod.ackRequests()) {
    const { body } = assertContractHonoured('/mod/acks', request)
    assert.equal(body.session_id, LICH_SESSION_ID)
  }
})

test('a model or effort override reaches every model request', async () => {
  const mod = await applied([
    { id: 'm3', kind: 'model', model: 'claude-opus-4-1' },
    { id: 'm5', kind: 'effort', effort: 'high' },
  ])
  for (const index of [0, 1]) {
    const sent = await mod.step({ turnId: 't1', index, model: 'claude-sonnet-5-5', effort: 'medium', messageCount: 1 })
    assert.equal(sent.model, 'claude-opus-4-1')
    assert.equal(sent.effort, 'high')
    assert.equal(sent.index, index)
  }
})

test('an override dropped by its absence restores the session\'s own model and effort', async () => {
  const mod = load({
    polls: [
      ok([{ id: 'm3', kind: 'model', model: 'claude-opus-4-1' }, { id: 'm5', kind: 'effort', effort: 'high' }]),
      ok([{ id: 'm4', kind: 'model' }, { id: 'm6', kind: 'effort' }]),
    ],
  })
  await mod.start()
  await until(() => mod.acks().length === 4, 'four acks')
  const e = { turnId: 't2', index: 1, model: 'claude-sonnet-5-5', effort: 'medium', messageCount: 3 }
  assert.deepEqual(await mod.step(e), e)
})

// Claude Code takes the level and fails the hook at the next model request,
// long after the ack (measured on 2.1.288), so the mod refuses it up front.
test('an effort outside the five levels is refused and leaves the override alone', async () => {
  const mod = await applied([
    { id: 'm1', kind: 'effort', effort: 'low' },
    { id: 'm2', kind: 'effort', effort: 'bogus' },
  ])
  const [, refusedAck] = mod.acks()
  assert.deepEqual(refusedAck, { session_id: LICH_SESSION_ID, id: 'm2', kind: 'effort', ok: false, error: 'unknown effort' })
  assertContractHonoured('/mod/acks', mod.ackRequests()[1])
  assert.equal((await mod.step()).effort, 'low')
})

test('an abort with no turn running is acked as a failure', async () => {
  const mod = await applied([{ id: 'm2', kind: 'abort' }], {
    before: async (m) => {
      await m.turnStart('t1')
      await m.turnComplete('t1')
    },
  })
  assert.deepEqual(mod.calls, [])
  const [ack] = mod.acks()
  assert.equal(ack.ok, false)
  assert.equal(ack.error, 'no turn is running')
  assertContractHonoured('/mod/acks', mod.ackRequests()[0])
})

test('a subagent turn ending does not forget the main turn', async () => {
  const mod = await applied([{ id: 'm2', kind: 'abort' }], {
    before: async (m) => {
      await m.turnStart('t1')
      await m.turnComplete('sub-1')
    },
  })
  assert.deepEqual(mod.calls, [['abort', { turnId: 't1' }]])
  assert.equal(mod.acks()[0].ok, true)
})

test('the next command waits for the abort ack to be answered', async () => {
  const answered = deferred()
  const mod = load({
    polls: [ok([{ id: 'm2', kind: 'abort' }, { id: 'm1', kind: 'prompt', text: 'go on' }])],
  })
  mod.holdAcks(() => answered.promise)
  await mod.turnStart('t1')
  await mod.start()
  await until(() => mod.ackRequests().length === 1, 'the abort ack')
  await new Promise((r) => setTimeout(r, 20))
  assert.deepEqual(mod.calls, [['abort', { turnId: 't1' }]], 'the prompt ran before lich answered the abort ack')
  answered.resolve(ACKED)
  await until(() => mod.calls.length === 2, 'the prompt')
  assert.deepEqual(mod.calls[1], ['prompt', { text: 'go on' }])
})

test('an ack that cannot be sent is dropped and the next command still runs', async () => {
  const mod = load({
    polls: [ok([{ id: 'm2', kind: 'abort' }, { id: 'm1', kind: 'prompt', text: 'go on' }])],
  })
  mod.holdAcks(() => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1')))
  await mod.turnStart('t1')
  await mod.start()
  await until(() => mod.ackRequests().length === 2, 'both acks')
  assert.deepEqual(
    mod.calls.map(([kind]) => kind),
    ['abort', 'prompt'],
  )
})

test('what Claude Code refuses is acked with its reason', async () => {
  const mod = await applied(
    [
      { id: 'm1', kind: 'prompt', text: 'blocked' },
      { id: 'm7', kind: 'command', name: 'nao-existe' },
      { id: 'm2', kind: 'abort' },
    ],
    {
      before: (m) => m.turnStart('t1'),
      engine: {
        submit: () => ({ drop: 'a plugin dropped it' }),
        // Claude Code's own rejection, measured on 2.1.288.
        command: () => Promise.reject(new Error('$.command.run: no command named /nao-existe in this session')),
        abort: () => Promise.reject(new Error('t1 is not the running turn')),
      },
    },
  )
  assert.deepEqual(
    mod.acks().map(({ ok, error }) => ({ ok, error })),
    [
      { ok: false, error: 'a plugin dropped it' },
      { ok: false, error: '$.command.run: no command named /nao-existe in this session' },
      { ok: false, error: 't1 is not the running turn' },
    ],
  )
  for (const request of mod.ackRequests()) assertContractHonoured('/mod/acks', request)
})

// The contract's own rule, so a lich newer than the mod hears of it. This lich
// would refuse the ack, since it validates `kind` against the five it knows;
// a lich that sends a sixth kind knows six.
test('a kind the mod does not know is acked as unknown, its kind echoed', async () => {
  const mod = await applied([{ id: 'm9', kind: 'rewind' }])
  assert.deepEqual(mod.acks(), [
    { session_id: LICH_SESSION_ID, id: 'm9', kind: 'rewind', ok: false, error: 'unknown kind' },
  ])
  assert.equal(mod.ackRequests()[0].headers['x-lich-plugin'], PLUGIN_VERSION)
})

// --------------------------------------------------------------------- ask --

/** The prompt the fork is sent: the question behind the mod's preamble. */
function forkPrompt(question) {
  return `This is a side question asked from outside your turn, while you work. It does not interrupt your turn and your answer is not added to the conversation. Tools are unavailable: do not call any tool. Answer from what the conversation already holds, in plain text, briefly. Question: ${question}`
}

test('an ask is answered by a fork of the session and its answer rides the ack', async () => {
  const mod = await applied([{ id: 'm9', kind: 'ask', question: 'what are you on?' }])
  assert.deepEqual(mod.calls, [['fork', { prompt: forkPrompt('what are you on?') }]])
  assert.deepEqual(mod.acks(), [{ session_id: LICH_SESSION_ID, id: 'm9', kind: 'ask', ok: true, answer: ANSWER }])
  assertContractHonoured('/mod/acks', mod.ackRequests()[0])
})

test('an ask with no answer acks the fork\'s reason', async () => {
  const cases = [
    [{ isAnswered: false, reason: 'nothing-to-fork' }, 'nothing-to-fork'],
    [{ isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE }, 'api-error 529 overloaded'],
    [{ isAnswered: false, reason: 'empty-reply', usage: USAGE }, 'empty-reply'],
    [{ isAnswered: false, reason: 'aborted', usage: USAGE }, 'aborted'],
  ]
  for (const [reply, error] of cases) {
    const mod = await applied([{ id: 'm9', kind: 'ask', question: 'why?' }], { engine: { fork: () => reply } })
    assert.deepEqual(mod.acks(), [{ session_id: LICH_SESSION_ID, id: 'm9', kind: 'ask', ok: false, error }])
    assertContractHonoured('/mod/acks', mod.ackRequests()[0])
  }
})

test('a long answer is cut at 16,000 characters and says so', async () => {
  const text = 'x'.repeat(16001)
  const mod = await applied([{ id: 'm9', kind: 'ask', question: 'essay?' }], {
    engine: { fork: () => ({ isAnswered: true, text, usage: USAGE }) },
  })
  assert.equal(mod.acks()[0].answer, `${'x'.repeat(16000)}\n[truncated]`)
})

test('an answer of exactly 16,000 characters is left whole', async () => {
  const text = 'x'.repeat(16000)
  const mod = await applied([{ id: 'm9', kind: 'ask', question: 'essay?' }], {
    engine: { fork: () => ({ isAnswered: true, text, usage: USAGE }) },
  })
  assert.equal(mod.acks()[0].answer, text)
})

// A fork can run for a minute and more (measured at 109 seconds on Claude Code
// 2.1.289), so neither the poll nor an abort may wait on one.
test('an ask still answering holds back neither the poll nor the commands after it', async () => {
  const forked = deferred()
  const mod = load({
    polls: [ok([{ id: 'm9', kind: 'ask', question: 'why?' }]), ok([{ id: 'm2', kind: 'abort' }])],
    engine: { fork: () => forked.promise },
  })
  await mod.turnStart('t1')
  await mod.start()
  await until(() => mod.acks().length === 1, 'the abort ack')
  await until(() => mod.parked() === 1, 'the poll after the abort')
  assert.deepEqual(mod.acks()[0], { session_id: LICH_SESSION_ID, id: 'm2', kind: 'abort', ok: true })
  forked.resolve({ isAnswered: true, text: ANSWER, usage: USAGE })
  await until(() => mod.acks().length === 2, 'the ask ack')
  assert.equal(mod.acks()[1].answer, ANSWER)
})

test('an ask does not wait on an abort ack still being answered', async () => {
  const held = deferred()
  const mod = load({ polls: [ok([{ id: 'm2', kind: 'abort' }, { id: 'm9', kind: 'ask', question: 'why?' }])] })
  mod.holdAcks((request) => (JSON.parse(request.raw).kind === 'abort' ? held.promise : Promise.resolve(ACKED)))
  await mod.turnStart('t1')
  await mod.start()
  await until(() => mod.acks().some((a) => a.kind === 'ask'), 'the ask ack')
  held.resolve(ACKED)
})
