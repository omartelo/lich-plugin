// Pins the Claude Code mod's status reads (hooks/mod-status.js) to lich's
// mod-status contract: the request it sends, and the status line it draws
// from the response lich answers with (mod-status.json).
//
// Like the other mod suites it imports the module and hands it a fake engine:
// `$.http.fetch` records each read and answers with what a test hands it, and
// `$.clock.every` keeps the timer for the test to fire.
//
// Run: node --test tests/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { LICH_SESSION_ID, PLUGIN_VERSION, ROOT, TOKEN, lichEnv } from './contract.mjs'
import { register } from '../hooks/mod-status.js'

const PORT = 47997
const STATUS = JSON.parse(readFileSync(path.join(ROOT, 'tests', 'fixtures', 'mod-status.json'), 'utf8'))
const NONE = { owed: [], open: [], ready: [] }

const answering = (body, status = 200) => async () => ({ status, ok: status < 300, headers: {}, text: JSON.stringify(body) })

/** Registers the module against a fake engine; `answer` answers each read. */
function load({ env = lichEnv(PORT), answer = answering(NONE) } = {}) {
  let start
  register((event, matcher, hook) => {
    assert.equal(event, 'session.start')
    assert.deepEqual(matcher, { isInteractive: true })
    start = hook
  })
  const reads = []
  const statuses = []
  const timers = []
  const $ = {
    env: { get: async (name) => env[name] },
    clock: {
      every: (ms, fn) => {
        const timer = { ms, fn, cancelled: false, cancel: () => (timer.cancelled = true) }
        timers.push(timer)
        return timer
      },
    },
    ui: { status: (text) => statuses.push(text) },
    http: {
      fetch: async (url, init = {}) => {
        reads.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {} })
        return answer()
      },
    },
  }
  const settled = () => new Promise((r) => setTimeout(r, 10))
  return {
    reads,
    statuses,
    timers,
    start: async (isInteractive = true) => {
      if (isInteractive) await start($, { cwd: '/w', surface: 'terminal', isInteractive }, async (e) => e)
      await settled()
    },
    tick: async () => {
      timers[0].fn()
      await settled()
    },
  }
}

test('a read is the GET the contract spells, repeated every few seconds', async () => {
  const mod = load()
  await mod.start()

  const url = new URL(mod.reads[0].url)
  assert.equal(mod.reads[0].method, 'GET')
  assert.equal(`${url.host}${url.pathname}`, `127.0.0.1:${PORT}/mod/status`)
  assert.equal(url.searchParams.get('token'), TOKEN)
  assert.equal(url.searchParams.get('session_id'), LICH_SESSION_ID)
  assert.equal(mod.reads[0].headers['X-Lich-Plugin'], PLUGIN_VERSION)
  assert.equal(mod.timers.length, 1)
  assert.equal(mod.timers[0].ms, 5000)
  await mod.tick()
  assert.equal(mod.reads.length, 2)
})

test("lich's status draws as one line", async () => {
  const mod = load({ answer: answering(STATUS) })
  await mod.start()

  assert.deepEqual(mod.statuses, ['owes 2 answers, 4 tasks out (1 waiting), 2 answers to collect'])
})

test('one answer owed names the session that asked, unless it came from the command line', async () => {
  const [fromSession, fromCli] = STATUS.owed
  const named = load({ answer: answering({ ...NONE, owed: [fromSession] }) })
  const cli = load({ answer: answering({ ...NONE, owed: [fromCli] }) })
  await named.start()
  await cli.start()

  assert.deepEqual(named.statuses, ['owes "Session 26" an answer'])
  assert.deepEqual(cli.statuses, ['owes 1 answer'])
})

test('nothing to show clears the line', async () => {
  const mod = load()
  await mod.start()

  assert.deepEqual(mod.statuses, [undefined])
})

test('a failed read clears the line, is not retried, and the next one still runs', async () => {
  let answer = answering(STATUS, 500)
  const mod = load({ answer: () => answer() })
  await mod.start()
  assert.deepEqual(mod.statuses, [undefined])
  assert.equal(mod.reads.length, 1)

  answer = async () => {
    throw new Error('connect ECONNREFUSED')
  }
  await mod.tick()
  answer = answering(STATUS)
  await mod.tick()

  assert.deepEqual(mod.statuses.at(-1), 'owes 2 answers, 4 tasks out (1 waiting), 2 answers to collect')
  assert.equal(mod.timers[0].cancelled, false)
})

test('a lich older than the contract stops the reads for the session', async () => {
  const mod = load({ answer: answering({}, 404) })
  await mod.start()

  assert.equal(mod.timers[0].cancelled, true)
  assert.deepEqual(mod.statuses, [undefined])
})

test('outside lich nothing is read', async () => {
  const mod = load({ env: {} })
  await mod.start()

  assert.equal(mod.reads.length, 0)
  assert.equal(mod.timers.length, 0)
})

test("a non-interactive run never reads the card that started it", async () => {
  const mod = load()
  await mod.start(false)

  assert.equal(mod.reads.length, 0)
  assert.equal(mod.timers.length, 0)
})
