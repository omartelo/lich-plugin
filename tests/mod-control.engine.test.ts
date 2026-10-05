// The mod under Claude Code's own engine: `claude plugin test .` loads
// hooks/lich.js from hooks/hooks.json the way a session does, which registers
// hooks/mod-control.js, and runs these against it, the test's hooks standing
// for lich (`http.fetch`) and for the engine's bottom (`prompt.submit`,
// `turn.abort`, `turn.step`, `command.run`, `model.fork`).
//
// tests/mod-control.test.mjs is the suite CI runs, against the contract
// fixtures; this one needs a claude binary, and proves the module loads and its
// hooks chain in the engine that runs it.

import { expect, mock, test } from 'claude-code/testing'
import type { HttpResponse, On } from 'claude-code'

const ENV = { LICH_PORT: '47999', LICH_TOKEN: 'tok', LICH_SESSION_ID: 'lich-1' }
const json = (body: unknown): HttpResponse => ({ status: 200, ok: true, headers: {}, text: JSON.stringify(body) })

/**
 * Answers the first polls with `batches`, one each, parks the rest, and records
 * every ack; also stands for the engine's own session start, which the kit
 * leaves to the test.
 */
function lich(on: On, ...batches: unknown[][]) {
  const acks: Record<string, unknown>[] = []
  let polls = 0
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('http.fetch', async (_$, e) => {
    if (e.url.includes('/mod/acks')) {
      acks.push(JSON.parse(e.init?.body ?? '{}'))
      return { value: { status: 204, ok: true, headers: {}, text: '' } }
    }
    const batch = batches[polls++]
    if (batch) return { value: json(batch) }
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

test('an abort reaches the running turn while a prompt waits for the session', async ($, on) => {
  mock.env(on, ENV)
  const clock = mock.clock(on)
  const world = lich(on, [{ id: 'm1', kind: 'prompt', text: 'next' }], [{ id: 'm2', kind: 'abort' }])
  const aborted: string[] = []
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('prompt.submit', () => new Promise<never>(() => {}))
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

test('a slash command from lich runs as the plugin and is acked', async ($, on) => {
  mock.env(on, ENV)
  const clock = mock.clock(on)
  const world = lich(on, [{ id: 'm7', kind: 'command', name: 'compact', args: 'keep the test plan' }])
  const ran: unknown[] = []
  on('command.run', async (_$, e) => {
    ran.push({ command: e.command, args: e.args, origin: e.origin })
    return { text: '' }
  })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(ran).toEqual([{ command: 'compact', args: 'keep the test plan', origin: { kind: 'plugin', name: 'lich' } }])
  expect(world.acks).toEqual([{ session_id: 'lich-1', id: 'm7', kind: 'command', ok: true }])
})

test('an abort reaches the turn while a slash command never settles', async ($, on) => {
  mock.env(on, ENV)
  const clock = mock.clock(on)
  const world = lich(on, [{ id: 'm7', kind: 'command', name: 'compact' }], [{ id: 'm2', kind: 'abort' }])
  const aborted: string[] = []
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('command.run', () => new Promise<never>(() => {}))
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

test('an ask from lich is answered by a fork and the answer rides the ack', async ($, on) => {
  mock.env(on, ENV)
  const clock = mock.clock(on)
  const world = lich(on, [{ id: 'm9', kind: 'ask', question: 'what are you on?' }])
  const asked: string[] = []
  on('model.fork', async (_$, e) => {
    asked.push(e.prompt)
    return {
      value: {
        isAnswered: true,
        text: 'Fixing the login test.',
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }
  })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(asked.length).toBe(1)
  expect(asked[0]?.endsWith('Question: what are you on?')).toBe(true)
  expect(world.acks).toEqual([
    { session_id: 'lich-1', id: 'm9', kind: 'ask', ok: true, answer: 'Fixing the login test.' },
  ])
})

test('an abort reaches the turn while an ask never answers', async ($, on) => {
  mock.env(on, ENV)
  const clock = mock.clock(on)
  const world = lich(on, [{ id: 'm9', kind: 'ask', question: 'why?' }], [{ id: 'm2', kind: 'abort' }])
  const aborted: string[] = []
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('model.fork', () => new Promise<never>(() => {}))
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
