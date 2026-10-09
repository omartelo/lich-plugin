// Pins the Claude Code mod's compaction reports (hooks/mod-compacting.js) to
// lich's session-state contract.
//
// Like mod-usage.test.mjs, it imports the module and hands it a fake engine,
// recording every fetch as contract.mjs reads a request, so the reports answer
// to the same fixtures lich asserts (session-state.jsonl). The
// `session.compact` payloads and the errors `next(e)` rejects with below are
// what Claude Code 2.1.295 delivered against a stub lich.
//
// Run: node --test tests/

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { LICH_SESSION_ID, assertContractHonoured, lichEnv } from './contract.mjs'
import { register } from '../hooks/mod-compacting.js'
import { register as registerEntry } from '../hooks/lich.js'

const PORT = 47997

const TRANSCRIPT = [
  { role: 'user', text: 'reply with the single word hi', toolUses: [], handle: '9a8f2342-326c-4003-b373-f52b8b4c14e9' },
  { role: 'assistant', text: 'hi', toolUses: [], handle: 'c9a8f906-975e-49de-9b29-359fa0a7e5a4' },
]
const MANUAL = { trigger: 'manual', messages: TRANSCRIPT }
const AUTO = { trigger: 'auto', messages: TRANSCRIPT }
const COMPACTED = {
  messages: [{ role: 'user', text: 'This session is being continued from a previous conversation that ran out of context.' }],
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
 * matcher runs only for an event that matches it, as the engine runs it, and
 * an event no hook matches goes straight to `compact`, Claude Code's own
 * compaction. `answer` answers each report.
 */
function load({ env = lichEnv(PORT), answer = () => Promise.resolve(NO_CONTENT) } = {}) {
  const hooks = []
  register((event, ...rest) => {
    const hook = rest.pop()
    hooks.push({ event, matcher: rest[0] ?? {}, hook })
  })
  const requests = []
  const $ = {
    env: { get: async (name) => env[name] },
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
  const fire = (event, e, last) => {
    const found = hooks.find((h) => h.event === event && Object.entries(h.matcher).every(([key, value]) => e[key] === value))
    return found ? found.hook($, e, last) : last(e)
  }
  return {
    requests,
    states: () => requests.map((r) => JSON.parse(r.raw).state),
    start: (isInteractive = true) => fire('session.start', { cwd: '/w', surface: 'terminal', isInteractive }, async (e) => e),
    compact: (e, compact = async () => COMPACTED) => fire('session.compact', e, compact),
  }
}

test('a manual /compact is bracketed by compacting and done, as the contract spells them', async () => {
  const mod = load()
  await mod.start()

  const result = await mod.compact(MANUAL)
  await until(() => mod.requests.length === 2, 'both reports')

  assert.equal(result, COMPACTED)
  for (const request of mod.requests) assertContractHonoured('/hook', request)
  assert.deepEqual(
    mod.requests.map((r) => JSON.parse(r.raw)),
    [
      { session_id: LICH_SESSION_ID, state: 'compacting' },
      { session_id: LICH_SESSION_ID, state: 'done' },
    ],
  )
})

// An automatic compaction runs inside a turn, before the model request that
// follows it; the turn's own Stop reports done.
test('an automatic compaction hands the card back to the turn', async () => {
  const mod = load()
  await mod.start()

  await mod.compact(AUTO)
  await until(() => mod.requests.length === 2, 'both reports')

  assert.deepEqual(mod.states(), ['compacting', 'busy'])
})

test('compacting goes out before the compaction runs', async () => {
  const mod = load()
  await mod.start()

  let reportedBefore
  await mod.compact(MANUAL, async () => {
    await until(() => mod.requests.length === 1, 'the compacting report')
    reportedBefore = mod.states()
    return COMPACTED
  })

  assert.deepEqual(reportedBefore, ['compacting'])
})

// Esc on a manual /compact rejects next(e); an automatic compaction the engine
// gives up on rejects it too, and its turn goes on. Neither fires PostCompact.
for (const [e, error, closing] of [
  [MANUAL, 'HooksError: API Error: Request was aborted.', 'done'],
  [AUTO, 'HooksError: reactive compaction did not settle ok', 'busy'],
]) {
  test(`${e.trigger} compaction that fails still closes with ${closing}, and its error goes on`, async () => {
    const mod = load()
    await mod.start()

    await assert.rejects(
      mod.compact(e, async () => {
        throw new Error(error)
      }),
      { message: error },
    )
    await until(() => mod.requests.length === 2, 'both reports')

    assert.deepEqual(mod.states(), ['compacting', closing])
  })
}

test("a subagent compacting its own transcript leaves the card alone", async () => {
  const mod = load()
  await mod.start()

  await mod.compact({ ...AUTO, agentId: 'a1b2c3' })
  await settle()

  assert.equal(mod.requests.length, 0)
})

// Only manual and auto were measured; precompute runs ahead of time, out of
// sight, and a plugin's own compaction was never observed.
for (const trigger of ['precompute', 'plugin']) {
  test(`a ${trigger} compaction is not reported`, async () => {
    const mod = load()
    await mod.start()

    const result = await mod.compact({ trigger, messages: TRANSCRIPT })
    await settle()

    assert.equal(result, COMPACTED)
    assert.equal(mod.requests.length, 0)
  })
}

test('the compaction is never held up by lich', async () => {
  const mod = load({ answer: () => new Promise(() => {}) })
  await mod.start()

  const result = await mod.compact(MANUAL)

  assert.equal(result, COMPACTED)
})

test('the closing report waits for compacting to be answered', async () => {
  let release
  const first = new Promise((r) => {
    release = () => r(NO_CONTENT)
  })
  const mod = load({ answer: () => (mod.requests.length === 1 ? first : Promise.resolve(NO_CONTENT)) })
  await mod.start()

  await mod.compact(MANUAL)
  await settle()
  assert.deepEqual(mod.states(), ['compacting'], 'done went out before compacting was answered')
  release()
  await until(() => mod.requests.length === 2, 'the closing report')

  assert.deepEqual(mod.states(), ['compacting', 'done'])
})

test('a report that fails is dropped and the closing one still goes out', async () => {
  const mod = load({
    answer: () =>
      mod.requests.length === 1 ? Promise.reject(new Error('connect ECONNREFUSED')) : Promise.resolve(NO_CONTENT),
  })
  await mod.start()

  await mod.compact(MANUAL)
  await until(() => mod.requests.length === 2, 'the closing report')
  await settle()

  assert.deepEqual(mod.states(), ['compacting', 'done'])
})

test('outside lich nothing is sent', async () => {
  const mod = load({ env: {} })
  await mod.start()

  await mod.compact(MANUAL)
  await settle()

  assert.equal(mod.requests.length, 0)
})

test('a non-interactive run never reports onto the card that started it', async () => {
  const mod = load()
  await mod.start(false)

  await mod.compact(AUTO)
  await settle()

  assert.equal(mod.requests.length, 0)
})

test('the plugin entry module registers the compaction reports', () => {
  const events = []
  registerEntry((event) => events.push(event))
  assert.ok(events.includes('session.compact'), 'mod-compacting is not registered')
})
