// The Agent-call mod under Claude Code's own engine: `claude plugin test .`
// loads hooks/lich.js from hooks/hooks.json the way a session does, which
// registers hooks/agent-cards.js, and runs these against it. The test's hooks
// stand for the lich CLI (`process.run`) and for the native agent (the
// `tool.call` beneath the mod).
//
// tests/agent-cards.test.mjs is the suite CI runs; this one needs a claude
// binary, and proves the module loads beside mod-control.js and its hooks
// chain in the engine that runs it: a backgrounded result and a fallback to the
// native agent reach the caller as the engine relays them. The kit does not
// check a `tool.call` result against the Agent tool's output schema (measured
// on 2.1.289), so the `async_launched` shape is pinned by a live run, not here.

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

test('a task lich took comes back at once as a backgrounded agent', async ($, on) => {
  const w = world(
    on,
    exited(2, { ...OPENED, delivery: { ticket: 't1', target: BRANCH, status: 'pending', answer: '' } }),
  )
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const ran = await $.tool.call(CALL)
  expect(ran.deny).toBe(undefined)
  expect(ran.isError).toBe(undefined)
  expect(ran.result).toEqual(
    expect.objectContaining({ status: 'async_launched', agentId: OPENED.name, outputFile: '' }),
  )
  expect(ran.context).toEqual([expect.stringContaining('in this same checkout')])
  expect(w.native).toEqual([])
  expect(w.argvs).toEqual([['/opt/lich/bin/lich', 'open', '--kind', 'claude', '--subagent', '--prompt', CALL.prompt, '--json']])
})

test('an isolated task opens in a worktree off the current branch', async ($, on) => {
  const w = world(
    on,
    exited(2, { ...OPENED, delivery: { ticket: 't1', target: BRANCH, status: 'pending', answer: '' } }),
  )
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const ran = await $.tool.call({ ...CALL, isolation: 'worktree' })
  expect(ran.context).toEqual([expect.stringContaining(`on branch ${BRANCH}`)])
  expect(w.argvs.map((argv) => argv.slice(1, 9))).toEqual([
    ['branch', '--show-current'],
    ['open', '--kind', 'claude', '--subagent', '--worktree', BRANCH, '--base', 'main'],
  ])
})

test('a failed open runs the native agent, with a toast saying why', async ($, on) => {
  const w = world(on, exited(1, '', 'lich: no lich is running\n'))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.tool.call(CALL)
  expect(w.native).toEqual(['Fix the auth flow'])
  expect(w.toasts).toEqual(['lich: ran "Fix the auth flow" as a Claude Code subagent: lich: no lich is running'])
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

test('a running worker shows in the footer until lich closes it, and TaskStop closes one', async ($, on) => {
  const pending = { ...OPENED, delivery: { ticket: 't1', target: BRANCH, status: 'pending', answer: '' } }
  const peer = (name: string, state: string) => ({ label: name, name, project: 'lich', kind: 'claude', state })
  const w = world(
    on,
    exited(2, pending),
    exited(2, { ...pending, label: 'second', name: 'second-1a2b' }),
    exited(0, [peer(OPENED.name, 'busy'), peer('second-1a2b', 'busy')]),
    exited(0, ''),
    exited(0, []),
  )
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.tool.call(CALL)
  await $.tool.call({ ...CALL, tool_use_id: 'toolu_second' })
  expect(await footerLine($, w)).toBe('lich: 2 workers')

  await w.clock.advance(5000)
  expect(w.argvs.at(-1)).toEqual(['/opt/lich/bin/lich', 'sessions', '--json'])
  expect(await footerLine($, w)).toBe('lich: 2 workers')

  const stopped = await $.tool.call({ tool: 'TaskStop', task_id: 'second-1a2b' })
  expect(stopped.result).toEqual(expect.objectContaining({ task_id: 'second-1a2b', task_type: 'local_agent' }))
  expect(w.argvs.at(-1)).toEqual(['/opt/lich/bin/lich', 'close', 'second-1a2b'])
  expect(await footerLine($, w)).toBe('lich: 1 worker')

  await w.clock.advance(5000)
  expect(await footerLine($, w)).toBe(undefined)

  await $.tool.call({ tool: 'TaskStop', task_id: 'a712043a56e1aafb1' })
  expect(w.native).toEqual(['TaskStop a712043a56e1aafb1'])
})
