// Pins the Claude Code mod's usage report (hooks/mod-usage.js) to lich's
// mod-usage contract.
//
// Like mod-control.test.mjs, it imports the module and hands it a fake engine,
// recording every fetch as contract.mjs reads a request, so the reports answer
// to the same fixtures lich asserts (mod-usage.jsonl). The `session.measure`
// payloads below are what Claude Code 2.1.289 delivered against a stub lich.
//
// Run: node --test tests/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { LICH_SESSION_ID, ROOT, assertContractHonoured, lichEnv } from './contract.mjs'
import { register } from '../hooks/mod-usage.js'
import { register as registerEntry } from '../hooks/lich.js'

const PORT = 47998
const CONVERSATION = '3fb3ad05-5b58-45ea-a1e0-0d1d4b0a89b9'

const AT_START = {
  context: { window: 200000 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 14, resetsAt: '2026-10-05T00:30:00.000Z' },
    { kind: 'seven_day', percentUsed: 80, resetsAt: '2026-10-05T15:00:00.000Z' },
  ],
  cost: { usd: 0 },
  changed: ['context', 'rateLimits', 'cost'],
}

const AT_TURN_END = {
  context: { tokens: 43592, window: 200000, percent: 22 },
  rateLimits: AT_START.rateLimits,
  cost: { usd: 0.0977631 },
  changed: ['context', 'cost'],
}

const NO_CONTENT = { status: 204, ok: true, headers: {}, text: '' }

/** Waits for `predicate` to hold, failing after a second of real time. */
async function until(predicate, what) {
  const deadline = Date.now() + 1000
  while (!predicate()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`)
    await new Promise((r) => setImmediate(r))
  }
}

const settle = () => new Promise((r) => setTimeout(r, 20))

/**
 * Registers the module against a fake engine. A hook registered with a
 * matcher runs only for an event that matches it, as the engine runs it.
 * `answer` answers each report.
 */
function load({ env = lichEnv(PORT), answer = () => Promise.resolve(NO_CONTENT) } = {}) {
  const hooks = new Map()
  register((event, ...rest) => {
    const hook = rest.pop()
    const matcher = rest[0] ?? {}
    hooks.set(event, { matcher, hook })
  })
  const requests = []
  const $ = {
    env: { get: async (name) => env[name] },
    session: { id: async () => CONVERSATION },
    http: {
      fetch: (url, init = {}) => {
        const { pathname, search } = new URL(url)
        const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
        const request = { method: init.method ?? 'GET', url: pathname + search, headers, raw: init.body ?? '' }
        requests.push(request)
        return answer(request)
      },
    },
  }
  const passOn = async (e) => e
  const fire = (event, e) => {
    const { matcher, hook } = hooks.get(event)
    const matches = Object.entries(matcher).every(([key, value]) => e[key] === value)
    return matches ? hook($, e, passOn) : passOn(e)
  }
  return {
    requests,
    reports: () => requests.map((r) => JSON.parse(r.raw)),
    start: (isInteractive = true) => fire('session.start', { cwd: '/w', surface: 'terminal', isInteractive }),
    measure: (e) => fire('session.measure', e),
  }
}

test('a measurement reaches lich as the contract spells it', async () => {
  const mod = load()
  await mod.start()

  await mod.measure(AT_TURN_END)
  await until(() => mod.requests.length === 1, 'the report')

  assertContractHonoured('/mod/usage', mod.requests[0])
  assert.deepEqual(mod.reports()[0], {
    session_id: LICH_SESSION_ID,
    conversation_id: CONVERSATION,
    context: { window: 200000, tokens: 43592, percent: 22 },
    rate_limits: [
      { kind: 'five_hour', percent_used: 14, resets_at: '2026-10-05T00:30:00.000Z' },
      { kind: 'seven_day', percent_used: 80, resets_at: '2026-10-05T15:00:00.000Z' },
    ],
    cost_usd: 0.0977631,
  })
})

test('a figure Claude Code does not have is left out, never zeroed', async () => {
  const mod = load()
  await mod.start()

  await mod.measure({ context: { window: 200000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 3 }], changed: ['context'] })
  await until(() => mod.requests.length === 1, 'the report')

  assertContractHonoured('/mod/usage', mod.requests[0])
  const body = mod.reports()[0]
  assert.deepEqual(body.context, { window: 200000 })
  assert.deepEqual(body.rate_limits, [{ kind: 'five_hour', percent_used: 3 }])
  assert.ok(!('cost_usd' in body))
})

// Claude Code measures the session as it starts, which can land before the
// session.start hook has read the link.
test('a measurement taken before the session started is sent once it does', async () => {
  const mod = load()

  await mod.measure(AT_START)
  await settle()
  assert.equal(mod.requests.length, 0)
  await mod.start()
  await until(() => mod.requests.length === 1, 'the held report')

  assertContractHonoured('/mod/usage', mod.requests[0])
})

test('the event is passed on without waiting for lich', async () => {
  const mod = load({ answer: () => new Promise(() => {}) })
  await mod.start()

  const passed = await mod.measure(AT_START)

  assert.equal(passed, AT_START)
})

test('outside lich nothing is sent', async () => {
  const mod = load({ env: {} })
  await mod.start()

  await mod.measure(AT_TURN_END)
  await settle()

  assert.equal(mod.requests.length, 0)
})

test('a non-interactive run never reports onto the card that started it', async () => {
  const mod = load()
  await mod.start(false)

  await mod.measure(AT_TURN_END)
  await settle()

  assert.equal(mod.requests.length, 0)
})

test('reports go out one at a time, in the order they were measured', async () => {
  let release
  const first = new Promise((r) => {
    release = () => r(NO_CONTENT)
  })
  const mod = load({ answer: () => (mod.requests.length === 1 ? first : Promise.resolve(NO_CONTENT)) })
  await mod.start()

  await mod.measure(AT_START)
  await mod.measure(AT_TURN_END)
  await settle()
  assert.equal(mod.requests.length, 1, 'the second report went out before the first was answered')
  release()
  await until(() => mod.requests.length === 2, 'the second report')

  assert.deepEqual(mod.reports().map((r) => r.cost_usd), [0, 0.0977631])
})

test('a report that fails is dropped and the next one still goes out', async () => {
  const mod = load({
    answer: () =>
      mod.requests.length === 1 ? Promise.reject(new Error('connect ECONNREFUSED')) : Promise.resolve(NO_CONTENT),
  })
  await mod.start()

  await mod.measure(AT_START)
  await mod.measure(AT_TURN_END)
  await until(() => mod.requests.length === 2, 'the report after the failure')
  await settle()

  assert.equal(mod.requests.length, 2, 'the failed report was retried')
})

test('a lich that predates the contract is not asked again', async () => {
  const mod = load({ answer: () => Promise.resolve({ status: 404, ok: false, headers: {}, text: '' }) })
  await mod.start()

  await mod.measure(AT_START)
  await mod.measure(AT_TURN_END)
  await settle()

  assert.equal(mod.requests.length, 1)
})

// Claude Code takes one hooks module per plugin, so hooks.json names the entry
// that registers every mod of the plugin, this one included.
test('the plugin entry module registers the usage report beside control', () => {
  const hooksJson = JSON.parse(readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'))
  assert.deepEqual(hooksJson.modules, ['./lich.js'])
  const events = []
  registerEntry((event) => events.push(event))
  assert.ok(events.includes('session.measure'), 'mod-usage is not registered')
  assert.ok(events.includes('turn.step'), 'mod-control is not registered')
})
