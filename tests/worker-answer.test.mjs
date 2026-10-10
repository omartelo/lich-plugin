// Pins the Claude Code mod that answers a lich subagent worker's task
// (hooks/worker-answer.js) to lich's mod-answer contract.
//
// Like mod-usage.test.mjs, it imports the module and hands it a fake engine,
// recording every fetch as contract.mjs reads a request, so the reports answer
// to the same fixtures lich asserts (mod-answer.jsonl). The `classic.Stop` and
// `turn.complete` payloads below are the shapes Claude Code 2.1.289 delivered.
//
// Run: node --test tests/

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { LICH_SESSION_ID, assertContractHonoured, lichEnv } from './contract.mjs'
import { register } from '../hooks/worker-answer.js'

const PORT = 47997
const WORKER_ENV = { ...lichEnv(PORT), LICH_SUBAGENT_CARDS: 'off' }
const NO_CONTENT = { status: 204, ok: true, headers: {}, text: '' }

const SHELL = { id: 'bib80qpy1', type: 'shell', status: 'running', description: 'sleep 20', command: 'sleep 20' }

const stop = (last, backgroundTasks = []) => ({
  hook_event_name: 'Stop',
  stop_hook_active: false,
  last_assistant_message: last,
  background_tasks: backgroundTasks,
  session_crons: [],
})

const complete = (answer, reason = 'answer') => ({
  answer,
  reason,
  isAborted: reason === 'aborted',
  turnId: 't1',
  durationMs: 1000,
})

const settle = () => new Promise((r) => setTimeout(r, 20))

/**
 * Registers the module against a fake engine. A hook registered with a
 * matcher runs only for an event that matches it, as the engine runs it.
 */
function load({ env = WORKER_ENV, answer = () => Promise.resolve(NO_CONTENT) } = {}) {
  const hooks = new Map()
  register((event, ...rest) => {
    const hook = rest.pop()
    hooks.set(event, [...(hooks.get(event) ?? []), { matcher: rest[0] ?? {}, hook }])
  })
  const requests = []
  const $ = {
    env: { get: async (name) => env[name] },
    http: {
      fetch: (url, init = {}) => {
        const { pathname, search } = new URL(url)
        const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
        requests.push({ method: init.method ?? 'GET', url: pathname + search, headers, raw: init.body ?? '' })
        return answer()
      },
    },
  }
  const passOn = async (e) => e
  const fire = (event, e) => {
    const matching = hooks.get(event).filter(({ matcher }) =>
      Object.entries(matcher).every(([key, value]) => e[key] === value),
    )
    const chain = matching.reduceRight((next, { hook }) => (ev) => hook($, ev, next), passOn)
    return chain(e)
  }
  const turn = async (stopEvent, completeEvent) => {
    if (stopEvent) await fire('classic.Stop', stopEvent)
    await fire('turn.complete', completeEvent)
    await settle()
  }
  return {
    requests,
    bodies: () => requests.map((r) => JSON.parse(r.raw)),
    start: (isInteractive = true) => fire('session.start', { cwd: '/w', surface: 'terminal', isInteractive }),
    turn,
  }
}

test("a worker's final message reaches lich as the contract spells it", async () => {
  const mod = load()
  await mod.start()

  await mod.turn(stop('Rewrote docs/cli.md.'), complete('Rewrote docs/cli.md.'))

  assert.equal(mod.requests.length, 1)
  assertContractHonoured('/mod/answer', mod.requests[0])
  assert.deepEqual(mod.bodies()[0], { session_id: LICH_SESSION_ID, text: 'Rewrote docs/cli.md.' })
})

test('a turn that handed work to the background answers only once it resumes', async () => {
  const mod = load()
  await mod.start()

  await mod.turn(stop('WAITING', [SHELL]), complete('WAITING'))
  assert.equal(mod.requests.length, 0, 'answered while a shell still ran')

  await mod.turn(stop('FINISHED: DONE'), complete('FINISHED: DONE'))
  assert.deepEqual(mod.bodies().map((b) => b.text), ['FINISHED: DONE'])
})

test('a blank final message is reported unanswered as the contract spells it', async () => {
  const mod = load()
  await mod.start()

  await mod.turn(stop(' \n'), complete(' \n'))
  await mod.turn(stop(undefined), complete(''))

  assert.deepEqual(mod.bodies(), [
    { session_id: LICH_SESSION_ID, unanswered: 'blank' },
    { session_id: LICH_SESSION_ID, unanswered: 'blank' },
  ])
  for (const request of mod.requests) assertContractHonoured('/mod/answer', request)
})

test('a blank turn that handed work to the background reports nothing', async () => {
  const mod = load()
  await mod.start()

  await mod.turn(stop('', [SHELL]), complete(''))

  assert.equal(mod.requests.length, 0)
})

// Measured on Claude Code 2.1.296: a refusal ends the turn through StopFailure,
// then turn.complete with reason refusal, and fires no Stop.
test('a refused turn reports nothing', async () => {
  const mod = load()
  await mod.start()

  await mod.turn(undefined, complete('', 'refusal'))

  assert.equal(mod.requests.length, 0)
})

// An API error fires StopFailure, which carries no background_tasks, so the
// mod cannot tell the failed turn left nothing running (docs/mod-answer.md).
test('an aborted or failed turn reports nothing', async () => {
  const mod = load()
  await mod.start()

  await mod.turn(undefined, complete('half a sentence', 'aborted'))
  await mod.turn(undefined, complete('', 'error'))
  await mod.turn(stop('partial'), complete('partial', 'error'))
  await mod.turn(stop(''), complete('', 'error'))

  assert.equal(mod.requests.length, 0)
})

test('an aborted turn drops the Stop it read, so a later blank turn cannot use it', async () => {
  const mod = load()
  await mod.start()

  await mod.turn(stop(''), complete('', 'aborted'))
  await mod.turn(undefined, complete(''))

  assert.equal(mod.requests.length, 0)
})

// classic.Stop fires only on the main loop; turn.complete fires for every
// subagent's turn too, and one of those is never the worker's answer.
test("a subagent's turn inside the worker answers nothing", async () => {
  const mod = load()
  await mod.start()

  await mod.turn(undefined, { ...complete('SUBDONE'), agentId: 'af8fcd1f2b867337f' })

  assert.equal(mod.requests.length, 0)
})

// An aborted turn fires no Stop, so the verdict of the turn before it must not
// stand in for one.
test("a turn without a Stop of its own does not reuse the last one's", async () => {
  const mod = load()
  await mod.start()

  await mod.turn(stop('WAITING', [SHELL]), complete('WAITING'))
  await mod.turn(undefined, complete('something else'))

  assert.equal(mod.requests.length, 0)
})

test('an ordinary session never answers', async () => {
  const mod = load({ env: lichEnv(PORT) })
  await mod.start()

  await mod.turn(stop('Done.'), complete('Done.'))

  assert.equal(mod.requests.length, 0)
})

test('a worker lich names by its depth answers, with subagent cards left on', async () => {
  const mod = load({ env: { ...lichEnv(PORT), LICH_SUBAGENT_DEPTH: '1' } })
  await mod.start()

  await mod.turn(stop('Done.'), complete('Done.'))

  assert.deepEqual(mod.bodies(), [{ session_id: LICH_SESSION_ID, text: 'Done.' }])
})

test('a worker at lich\'s depth limit answers, though its subagent cards are off', async () => {
  const mod = load({ env: { ...WORKER_ENV, LICH_SUBAGENT_DEPTH: '2' } })
  await mod.start()

  await mod.turn(stop('Done.'), complete('Done.'))

  assert.equal(mod.requests.length, 1)
})

// The depth decides once lich sets it: cards off at depth 0 is the user's
// setting, not a worker.
test('a top-level session with subagent cards turned off never answers', async () => {
  const mod = load({ env: { ...WORKER_ENV, LICH_SUBAGENT_DEPTH: '0' } })
  await mod.start()

  await mod.turn(stop('Done.'), complete('Done.'))

  assert.equal(mod.requests.length, 0)
})

test('a lich older than the depth variable marks a worker by cards off alone', async () => {
  const mod = load({ env: WORKER_ENV })
  await mod.start()

  await mod.turn(stop('Done.'), complete('Done.'))

  assert.equal(mod.requests.length, 1)
})

test('outside lich nothing is sent', async () => {
  const mod = load({ env: { LICH_SUBAGENT_CARDS: 'off' } })
  await mod.start()

  await mod.turn(stop('Done.'), complete('Done.'))

  assert.equal(mod.requests.length, 0)
})

test('a non-interactive run never answers for the card that started it', async () => {
  const mod = load()
  await mod.start(false)

  await mod.turn(stop('Done.'), complete('Done.'))

  assert.equal(mod.requests.length, 0)
})

test('a long answer is cut where the contract says', async () => {
  const mod = load()
  await mod.start()
  const long = 'x'.repeat(20000)

  await mod.turn(stop(long), complete(long))

  const text = mod.bodies()[0].text
  assert.equal(text, `${'x'.repeat(16000)}\n[truncated]`)
  assertContractHonoured('/mod/answer', mod.requests[0])
})

test('the turn is never held up by lich, and a failure is dropped', async () => {
  const hung = load({ answer: () => new Promise(() => {}) })
  await hung.start()
  const e = complete('Done.')
  await hung.turn(stop('Done.'), e)
  assert.equal(hung.requests.length, 1)

  const failing = load({ answer: () => Promise.reject(new Error('connect ECONNREFUSED')) })
  await failing.start()
  await failing.turn(stop('Done.'), complete('Done.'))
  assert.equal(failing.requests.length, 1, 'a failed answer was retried')
})
