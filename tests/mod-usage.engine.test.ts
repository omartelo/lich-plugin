// The usage report under Claude Code's own engine: `claude plugin test .` loads
// the plugin's hooks module (hooks/lich.js, which registers hooks/mod-usage.js)
// from hooks/hooks.json the way a session does, the test's hooks standing for
// lich (`http.fetch`). tests/mod-usage.test.mjs is the suite CI runs against
// the contract fixtures; this one proves the module loads and its hooks chain
// in the engine that runs it.

import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionMeasureInput } from 'claude-code'

const ENV = { LICH_PORT: '47999', LICH_TOKEN: 'tok', LICH_SESSION_ID: 'lich-1' }

const MEASURED: SessionMeasureInput = {
  context: { tokens: 43592, window: 200000, percent: 22 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 14, resetsAt: '2026-10-05T00:30:00.000Z' }],
  cost: { usd: 0.0977631 },
  changed: ['context', 'cost'],
}

/**
 * Records every usage report and parks every poll, as lich does with nothing
 * queued; also stands for the engine's own session start, measurement and id,
 * which the kit leaves to the test.
 */
function lich(on: On) {
  const reports: Record<string, unknown>[] = []
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.measure', async (_$, e) => ({ changed: e.changed }))
  on('session.id', async () => ({ value: 'conv-1' }))
  on('http.fetch', async (_$, e) => {
    if (e.url.includes('/mod/usage')) {
      reports.push(JSON.parse(e.init?.body ?? '{}'))
      return { value: { status: 204, ok: true, headers: {}, text: '' } }
    }
    return new Promise<never>(() => {})
  })
  return { reports }
}

test('a measurement is reported to lich', async ($, on) => {
  mock.env(on, ENV)
  const clock = mock.clock(on)
  const world = lich(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.session.measure(MEASURED)
  await clock.settle()
  expect(world.reports).toHaveLength(1)
  expect(world.reports[0]).toMatchObject({
    session_id: 'lich-1',
    conversation_id: 'conv-1',
    context: { window: 200000, tokens: 43592, percent: 22 },
    rate_limits: [{ kind: 'five_hour', percent_used: 14, resets_at: '2026-10-05T00:30:00.000Z' }],
    cost_usd: 0.0977631,
  })
})

test('a non-interactive run reports nothing', async ($, on) => {
  mock.env(on, ENV)
  const clock = mock.clock(on)
  const world = lich(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: false })
  await $.session.measure(MEASURED)
  await clock.settle()
  expect(world.reports).toHaveLength(0)
})
