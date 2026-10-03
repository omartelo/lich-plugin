// The mod under Claude Code's own engine: `claude plugin test .` loads
// hooks/mod-control.js from hooks/hooks.json the way a session does and runs
// these against it, the test's hooks standing for lich (`http.fetch`) and for
// the engine's bottom (`prompt.submit`, `turn.abort`, `turn.step`).
//
// tests/mod-control.test.mjs is the suite CI runs, against the contract
// fixtures; this one needs a claude binary, and proves the module loads and its
// hooks chain in the engine that runs it.

import { expect, mock, test } from 'claude-code/testing'
import type { HttpResponse, On } from 'claude-code'

const ENV = { LICH_PORT: '47999', LICH_TOKEN: 'tok', LICH_SESSION_ID: 'lich-1' }
const json = (body: unknown): HttpResponse => ({ status: 200, ok: true, headers: {}, text: JSON.stringify(body) })

/**
 * Answers the first poll with `commands`, parks the rest, and records every
 * ack; also stands for the engine's own session start, which the kit leaves to
 * the test.
 */
function lich(on: On, commands: unknown[]) {
  const acks: Record<string, unknown>[] = []
  let polls = 0
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('http.fetch', async (_$, e) => {
    if (e.url.includes('/mod/acks')) {
      acks.push(JSON.parse(e.init?.body ?? '{}'))
      return { value: { status: 204, ok: true, headers: {}, text: '' } }
    }
    polls++
    if (polls === 1) return { value: json(commands) }
    return new Promise<never>(() => {})
  })
  return { acks, polls: () => polls }
}

test('outside lich nothing is fetched', async ($, on) => {
  mock.env(on, {})
  const clock = mock.clock(on)
  const world = lich(on, [])
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  expect(world.polls()).toBe(0)
})

test('a prompt from lich is submitted as the plugin and acked', async ($, on) => {
  mock.env(on, ENV)
  const clock = mock.clock(on)
  const world = lich(on, [{ id: 'm1', kind: 'prompt', text: 'run the tests' }])
  const submitted: unknown[] = []
  on('prompt.submit', async (_$, e) => {
    submitted.push({ text: e.text, origin: e.origin })
    return { text: e.text }
  })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(submitted).toEqual([{ text: 'run the tests', origin: { kind: 'plugin', name: 'lich' } }])
  expect(world.acks).toEqual([{ session_id: 'lich-1', id: 'm1', kind: 'prompt', ok: true }])
})

test('an abort from lich ends the turn turn.start named', async ($, on) => {
  mock.env(on, ENV)
  const clock = mock.clock(on)
  const world = lich(on, [{ id: 'm2', kind: 'abort' }])
  const aborted: string[] = []
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.abort', async (_$, e) => {
    aborted.push(e.turnId)
    return { value: undefined }
  })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(aborted).toEqual(['t1'])
  expect(world.acks).toEqual([{ session_id: 'lich-1', id: 'm2', kind: 'abort', ok: true }])
})

test('the model and effort overrides reach the request the engine sends', async ($, on) => {
  mock.env(on, ENV)
  const clock = mock.clock(on)
  lich(on, [
    { id: 'm3', kind: 'model', model: 'claude-opus-4-1' },
    { id: 'm5', kind: 'effort', effort: 'high' },
  ])
  const sent: { model: string; effort?: unknown }[] = []
  on('turn.step', async function* (_$, e) {
    sent.push({ model: e.model, effort: e.effort })
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.settle()
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5-5', effort: 'medium', messageCount: 1 }));
  expect(sent).toEqual([{ model: 'claude-opus-4-1', effort: 'high' }])
})
