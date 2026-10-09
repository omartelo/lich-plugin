// The self-command mod under Claude Code's own engine: `claude plugin test .`
// loads hooks/lich.js, which registers hooks/self-command.js. The test's hooks
// stand for the Skill tool's own refusal of a built-in (the `tool.call` beneath
// the mod) and for the command's run (`command.run`).
//
// tests/self-command.test.mjs is the suite CI runs; this one proves the module
// loads beside the other mods and that the command it queues reaches
// `command.run` as the plugin, once the call has been answered.

import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const ENV = { LICH_SESSION_ID: 'lich-1' }
const REFUSAL = 'compact is a built-in CLI command, not a skill.'

function world(on: On) {
  const ran: unknown[] = []
  mock.env(on, ENV)
  const clock = mock.clock(on)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  // The kit has no command list of its own ("no implementation for
  // command.list", measured on 2.1.295): this hook stands for the session's.
  on('command.list', async () => ({ value: [{ name: 'compact', description: '', source: 'builtin' }] }))
  on('tool.call', { tool: 'Skill' }, async () => ({ result: `Error: ${REFUSAL}`, isError: true as const }))
  on('command.run', async (_$, e) => {
    ran.push({ command: e.command, args: e.args, origin: e.origin })
    return { text: '' }
  })
  return { ran, clock }
}

test('a built-in the Skill tool refused runs as the plugin after the call is answered', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const answer = await $.tool.call({ tool: 'Skill', skill: 'compact', args: 'keep the plan' })
  expect(answer.result).toEqual({ success: true, commandName: 'compact' })
  expect(w.ran).toEqual([])
  await w.clock.settle()
  expect(w.ran).toEqual([{ command: 'compact', args: 'keep the plan', origin: { kind: 'plugin', name: 'lich' } }])
})

test('a non-interactive run leaves the refusal alone', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
  const answer = await $.tool.call({ tool: 'Skill', skill: 'compact' })
  expect(answer.isError).toBe(true)
  await w.clock.settle()
  expect(w.ran).toEqual([])
})
