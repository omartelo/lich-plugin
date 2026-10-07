// The status reads under Claude Code's own engine: `claude plugin test .` loads
// hooks/lich.js, which registers hooks/mod-status.js, the test's hooks standing
// for lich (`http.fetch`) and for the engine's own footer (`ui.render` of `SessionMode`).
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

/**
 * Answers every status read with STATUS and parks every other request, as lich
 * does a poll with nothing queued; records the modes the footer is drawn with.
 */
function lich(on: On) {
  const reads: string[] = []
  const footer = { modes: [] as readonly string[] }
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    footer.modes = e.props.modes
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, e.props.modes.join(' & '))
  })
  on('http.fetch', async (_$, e) => {
    if (e.url.includes('/mod/status')) {
      reads.push(e.url)
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(STATUS) } }
    }
    return new Promise<never>(() => {})
  })
  return { reads, footer }
}

test("lich's errands reach the footer", async ($, on) => {
  mock.env(on, ENV)
  const clock = mock.clock(on)
  const world = lich(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(world.reads[0]).toContain('/mod/status?token=tok&session_id=lich-1')
  await $.ui.render({ surface: 'terminal', component: 'SessionMode', requestId: 'footer', props: { modes: [] } })
  expect(world.footer.modes).toEqual(['lich: 1 task out, 1 answer to collect'])
})

test('a non-interactive run reads nothing', async ($, on) => {
  mock.env(on, ENV)
  const clock = mock.clock(on)
  const world = lich(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: false })
  await clock.settle()
  expect(world.reads).toHaveLength(0)
})
