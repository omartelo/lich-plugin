// The worker's answer under Claude Code's own engine: `claude plugin test .`
// loads the plugin's hooks module (hooks/lich.js, which registers
// hooks/worker-answer.js) from hooks/hooks.json the way a session does, the
// test's hooks standing for lich (`http.fetch`). tests/worker-answer.test.mjs
// is the suite CI runs against the contract fixtures; this one proves the
// module loads beside mod-control.js's own turn.complete hook and that its
// hooks chain in the engine that runs it.

import { expect, mock, test } from 'claude-code/testing'
import type { On, TurnCompleteInput } from 'claude-code'

const WORKER = { LICH_PORT: '47999', LICH_TOKEN: 'tok', LICH_SESSION_ID: 'lich-1', LICH_SUBAGENT_CARDS: 'off' }

const ANSWERED: TurnCompleteInput = { answer: 'Rewrote docs/cli.md.', reason: 'answer', isAborted: false, turnId: 't1', durationMs: 1000 }

/**
 * Records every answer and parks every poll, as lich does with nothing
 * queued; also stands for the engine's own session start, Stop and turn end, which
 * the kit leaves to the test.
 */
function lich(on: On) {
  const answers: Record<string, unknown>[] = []
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('classic.Stop', async () => ({}))
  on('http.fetch', async (_$, e) => {
    if (e.url.includes('/mod/answer')) {
      answers.push(JSON.parse(e.init?.body ?? '{}'))
      return { value: { status: 204, ok: true, headers: {}, text: '' } }
    }
    return new Promise<never>(() => {})
  })
  return { answers }
}

test("a worker's last message is posted as its answer", async ($, on) => {
  mock.env(on, WORKER)
  const clock = mock.clock(on)
  const world = lich(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Rewrote docs/cli.md.', background_tasks: [] })
  await $.turn.complete(ANSWERED)
  await clock.settle()
  expect(world.answers).toEqual([{ session_id: 'lich-1', text: 'Rewrote docs/cli.md.' }])
})

test('a turn with work in the background answers nothing', async ($, on) => {
  mock.env(on, WORKER)
  const clock = mock.clock(on)
  const world = lich(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.classic.Stop({
    stop_hook_active: false,
    last_assistant_message: 'WAITING',
    background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'sleep 20' }],
  })
  await $.turn.complete({ ...ANSWERED, answer: 'WAITING' })
  await clock.settle()
  expect(world.answers).toHaveLength(0)
})

test('a worker lich names by its depth answers with subagent cards left on', async ($, on) => {
  mock.env(on, { LICH_PORT: '47999', LICH_TOKEN: 'tok', LICH_SESSION_ID: 'lich-1', LICH_SUBAGENT_DEPTH: '1' })
  const clock = mock.clock(on)
  const world = lich(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Rewrote docs/cli.md.', background_tasks: [] })
  await $.turn.complete(ANSWERED)
  await clock.settle()
  expect(world.answers).toEqual([{ session_id: 'lich-1', text: 'Rewrote docs/cli.md.' }])
})

test('a blank turn is reported unanswered, and a refused one too', async ($, on) => {
  mock.env(on, WORKER)
  const clock = mock.clock(on)
  const world = lich(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.classic.Stop({ stop_hook_active: false, last_assistant_message: '', background_tasks: [] })
  await $.turn.complete({ ...ANSWERED, answer: '' })
  await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'No.', background_tasks: [] })
  await $.turn.complete({ ...ANSWERED, answer: 'No.', reason: 'refusal' })
  await clock.settle()
  expect(world.answers).toEqual([
    { session_id: 'lich-1', unanswered: 'blank' },
    { session_id: 'lich-1', unanswered: 'refusal' },
  ])
})
