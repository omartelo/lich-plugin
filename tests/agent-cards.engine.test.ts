// The Agent-call mod under Claude Code's own engine: `claude plugin test .`
// loads hooks/lich.js from hooks/hooks.json the way a session does, which
// registers hooks/agent-cards.js, and runs these against it. The test's hooks
// stand for the lich CLI (`process.run`) and for the native agent (the
// `tool.call` beneath the mod).
//
// tests/agent-cards.test.mjs is the suite CI runs; this one needs a claude
// binary, and proves the module loads beside mod-control.js and its hooks
// chain in the engine that runs it: a call the mod takes goes on to Claude
// Code's permission check, and one refused there runs no lich. The open itself
// happens at `agent.spawn`, which Claude Code raises beneath an allowed call;
// the kit refuses `$.agent.spawn` from a test's hook (measured on 2.1.296), so
// the open, the `async_launched` result and the worker count are pinned by
// tests/agent-cards.test.mjs and a live run, not here.

import { expect, mock, test } from 'claude-code/testing'
import type { On, ProcessRunResult } from 'claude-code'

const ENV: Record<string, string> = { LICH_BIN: '/opt/lich/bin/lich', LICH_SESSION_ID: 'lich-1' }
const BRANCH = 'subagent/fix-the-auth-flow-ab12'
const OPENED = { id: '9f8e', label: BRANCH, name: `${BRANCH}-9f8e`, kind: 'claude', path: `/wt/${BRANCH}` }
const CALL = {
  tool: 'Agent',
  tool_use_id: 'toolu_01QxW7zAB12',
  description: 'Fix the auth flow',
  prompt: 'Fix the login bug.',
  subagent_type: 'general-purpose',
} as const

const exited = (exitCode: number, stdout: unknown = '', stderr = ''): ProcessRunResult => ({
  exitCode,
  stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout),
  stderr,
  isStdoutTruncated: false,
  isStderrTruncated: false,
})

/**
 * Answers `git` with a branch and each `lich` run with the next of `lich`, and
 * stands for the native agent and the engine's own session start.
 */
function world(on: On, ...lich: ProcessRunResult[]) {
  return worldWith(on, ENV, ...lich)
}

function worldWith(on: On, env: Record<string, string>, ...lich: ProcessRunResult[]) {
  const native: string[] = []
  const argvs: string[][] = []
  const toasts: string[] = []
  const footer = { modes: [] as readonly string[] }
  mock.env(on, env)
  const clock = mock.clock(on)
  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    footer.modes = e.props.modes
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, e.props.modes.join(' & '))
  })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('process.run', async (_$, e) => {
    argvs.push([...e.argv])
    if (e.argv[0] === 'git') return { value: exited(0, 'main\n') }
    const answer = lich.shift()
    if (!answer) throw new Error(`unscripted run: ${e.argv.join(' ')}`)
    return { value: answer }
  })
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.call', { tool: 'Agent' }, async (_$, e) => {
    native.push(e.description)
    return { deny: 'the native agent ran' }
  })
  on('tool.call', { tool: 'TaskStop' }, async (_$, e) => {
    native.push(`TaskStop ${e.task_id}`)
    return { deny: 'the native TaskStop ran' }
  })
  return { native, argvs, toasts, footer, clock }
}

/** The lich line the footer draws now, Claude Code's own modes being none. */
async function footerLine($: { ui: { render: (input: object) => Promise<unknown> } }, w: { footer: { modes: readonly string[] } }) {
  await $.ui.render({ surface: 'terminal', component: 'SessionMode', requestId: 'footer', props: { modes: [] } })
  return w.footer.modes.at(-1)
}

test('a call the mod takes goes on to the permission check, and a refusal there runs no lich', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const ran = await $.tool.call(CALL)
  expect(ran.deny).toBe('the native agent ran')
  expect(w.native).toEqual(['Fix the auth flow'])
  expect(w.argvs).toEqual([])
})

test('a refused isolated call reads its base branch and opens no worktree', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.tool.call({ ...CALL, isolation: 'worktree' })
  expect(w.native).toEqual(['Fix the auth flow'])
  expect(w.argvs).toEqual([['git', 'branch', '--show-current']])
})

test('a non-interactive run keeps its subagents native', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
  await $.tool.call(CALL)
  expect(w.native).toEqual(['Fix the auth flow'])
  expect(w.argvs).toEqual([])
})

test('an Explore agent stays native and lich is never run', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.tool.call({ ...CALL, subagent_type: 'Explore' })
  expect(w.native).toEqual(['Fix the auth flow'])
  expect(w.argvs).toEqual([])
})

test('turned off in lich, every subagent stays native and lich is never run', async ($, on) => {
  const w = worldWith(on, { ...ENV, LICH_SUBAGENT_CARDS: 'off' })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.tool.call(CALL)
  expect(w.native).toEqual(['Fix the auth flow'])
  expect(w.argvs).toEqual([])
})

test('a worker at lich\'s depth limit keeps its subagents native, with a toast saying why', async ($, on) => {
  const w = worldWith(on, { ...ENV, LICH_SUBAGENT_CARDS: 'off', LICH_SUBAGENT_DEPTH: '2' })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.tool.call(CALL)
  expect(w.native).toEqual(['Fix the auth flow'])
  expect(w.argvs).toEqual([])
  expect(w.toasts).toEqual([expect.stringContaining('this session is itself a lich subagent')])
})

test('TaskStop on a task this mod did not open goes to Claude Code', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'TaskStop', task_id: 'a712043a56e1aafb1' })
  expect(w.native).toEqual(['TaskStop a712043a56e1aafb1'])
  expect(await footerLine($, w)).toBe(undefined)
})
