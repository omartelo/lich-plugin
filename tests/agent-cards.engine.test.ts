// The Agent-call mod under Claude Code's own engine: `claude plugin test .`
// loads hooks/lich.js from hooks/hooks.json the way a session does, which
// registers hooks/agent-cards.js, and runs these against it. The test's hooks
// stand for the lich CLI (`process.run`) and for the native agent (the
// `tool.call` beneath the mod).
//
// tests/agent-cards.test.mjs is the suite CI runs; this one needs a claude
// binary, and proves the module loads beside mod-control.js and its hooks
// chain in the engine that runs it: a deny and a fallback to the native agent
// reach the caller as the engine relays them. The kit does not check a
// `tool.call` result against the Agent tool's output schema (measured on
// 2.1.289), so the `completed` shape is pinned by a live run, not here.

import { expect, mock, test } from 'claude-code/testing'
import type { On, ProcessRunResult } from 'claude-code'

const ENV = { LICH_BIN: '/opt/lich/bin/lich', LICH_SESSION_ID: 'lich-1' }
const BRANCH = 'fix-the-auth-flow-ab12'
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
  const native: string[] = []
  const argvs: string[][] = []
  const toasts: string[] = []
  mock.env(on, ENV)
  mock.clock(on)
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
  return { native, argvs, toasts }
}

test('an answered task is the Agent tool\'s completed result', async ($, on) => {
  const w = world(
    on,
    exited(0, { ...OPENED, delivery: { ticket: 't1', target: BRANCH, status: 'pending', answer: '' } }),
    exited(0, { ticket: 't1', target: BRANCH, status: 'answered', answer: 'Fixed.' }),
  )
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const ran = await $.tool.call(CALL)
  expect(ran.deny).toBe(undefined)
  expect(ran.isError).toBe(undefined)
  expect(ran.result).toEqual(
    expect.objectContaining({ status: 'completed', agentId: OPENED.name, worktreeBranch: BRANCH }),
  )
  expect(w.native).toEqual([])
  expect(w.argvs.map((argv) => argv[1])).toEqual(['branch', 'open', 'wait'])
})

test('a failed wait after the open is denied and the native agent never runs', async ($, on) => {
  const w = world(
    on,
    exited(0, { ...OPENED, delivery: { ticket: 't1', target: BRANCH, status: 'pending', answer: '' } }),
    exited(1, '', 'lich: no lich is running\n'),
  )
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const ran = await $.tool.call(CALL)
  expect(ran.deny).toEqual(expect.stringContaining(`lich stopped answering about "${BRANCH}"`))
  expect(w.native).toEqual([])
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
