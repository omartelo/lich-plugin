// The status reads under Claude Code's own engine: `claude plugin test .` loads
// hooks/lich.js, which registers hooks/mod-status.js, the test's hooks standing
// for lich (`http.fetch`) and the status line (`ui.status`).
// tests/mod-status.test.mjs is the suite CI runs against the contract fixture;
// this one proves the module loads beside the other mods and its line reaches
// the status line through the engine.

import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const ENV = { LICH_PORT: '47999', LICH_TOKEN: 'tok', LICH_SESSION_ID: 'lich-1' }
const STATUS = {
  owed: [],
  open: [{ ticket: '4f0c1a2e', target: 'docs', state: 'busy' }],
  ready: [{ ticket: 'c7a91e04', target: 'review', status: 'answered' }],
}

/** Answers every status read with STATUS and parks every other request, as lich does a poll with nothing queued. */
function lich(on: On) {
  const reads: string[] = []
  const statuses: (string | undefined)[] = []
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('ui.status', async (_$, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('http.fetch', async (_$, e) => {
    if (e.url.includes('/mod/status')) {
      reads.push(e.url)
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(STATUS) } }
    }
    return new Promise<never>(() => {})
  })
  return { reads, statuses }
}

test("lich's errands reach the status line", async ($, on) => {
  mock.env(on, ENV)
  const clock = mock.clock(on)
  const world = lich(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(world.reads[0]).toContain('/mod/status?token=tok&session_id=lich-1')
  expect(world.statuses).toContain('1 task out, 1 answer to collect')
})

test('a non-interactive run reads nothing', async ($, on) => {
  mock.env(on, ENV)
  const clock = mock.clock(on)
  const world = lich(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: false })
  await clock.settle()
  expect(world.reads).toHaveLength(0)
})
