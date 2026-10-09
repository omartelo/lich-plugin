// Pins the Claude Code mod that runs a built-in slash command the model asks
// for through the Skill tool (hooks/self-command.js): which calls it takes,
// what it queues, and what reaches the model.
//
// Like the other mod suites it imports the module and hands it a fake engine:
// `$.command.list` answers a few commands, `$.command.run` records each run,
// `$.process.run` answers `lich whoami --json` with this session, and a
// `$.clock.after` timer runs when the test fires it.
//
// Run: node --test tests/

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { register } from '../hooks/self-command.js'

const COMMANDS = [
  { name: 'compact', description: 'Compacts the conversation.', source: 'builtin' },
  { name: 'clear', description: 'Clears the conversation.', source: 'builtin' },
  { name: 'model', description: 'Sets the model.', source: 'builtin' },
  { name: 'effort', description: 'Sets the effort.', source: 'builtin' },
  { name: 'deploy', description: 'A user command.', source: 'user' },
]

// What the Skill tool answers for a built-in, as Claude Code 2.1.295 did.
const refusedBy = (name) => {
  const text = `${name} is a built-in CLI command, not a skill. Ask the user to run /${name} themselves — it cannot be invoked via the Skill tool.`
  return { ref: 1, result: `Error: ${text}`, text: `<tool_use_error>${text}</tool_use_error>`, isError: true }
}
const LOADED = { ref: 1, result: { success: true, commandName: 'review' }, text: 'Launching skill: review' }

// What lich's control_session answers, as the lich MCP server did on Claude
// Code 2.1.295: a session targeting itself, and one targeting a peer.
const SELF_REFUSAL = (() => {
  const text =
    '"fix/x" is this session, and a session cannot control itself: an abort would end the turn asking for it, ' +
    'and a prompt or a slash command would only run once that turn is over'
  return { ref: 1, result: `Error: ${text}`, text, isError: true }
})()
const NO_SUCH = { ref: 1, result: 'Error: no session named "ghost"', text: 'no session named "ghost"', isError: true }
const DELIVERED = { ref: 1, result: 'ran /compact on "peer"', text: 'ran /compact on "peer"' }

const CONTROL = 'mcp__lich__control_session'

// This session as `lich whoami --json` prints it (docs/cli.md in lich).
const WHOAMI = { label: 'fix/x', name: 'lich-plugin-a1b2', project: 'lich-plugin', kind: 'claude', state: 'busy', id: 'lich-1' }

/** Registers the module against a fake engine started with `env`. */
async function session({
  env = { LICH_SESSION_ID: 'lich-1', LICH_BIN: '/bin/lich' },
  isInteractive = true,
  runFails = false,
  whoami = { exitCode: 0, stdout: JSON.stringify(WHOAMI) },
} = {}) {
  const hooks = {}
  register((event, matcher, hook) => {
    hooks[`${event} ${JSON.stringify(matcher)}`] = hook
  })
  const runs = []
  const toasts = []
  const timers = []
  const invalidated = []
  const processes = []
  const $ = {
    env: { get: async (name) => env[name] },
    clock: { after: (ms, fn) => timers.push({ ms, fn }) },
    command: {
      list: async () => COMMANDS,
      run: async (input) => {
        runs.push(input)
        if (runFails) throw new Error('the command queue is closed')
        return {}
      },
    },
    ui: { toast: (text) => toasts.push(text), invalidate: (event) => invalidated.push(event) },
    process: {
      run: async (argv) => {
        processes.push(argv)
        assert.deepEqual(argv, ['/bin/lich', 'whoami', '--json'])
        return { stderr: '', ...whoami }
      },
    },
  }
  const start = hooks['session.start {"isInteractive":true}']
  if (isInteractive) await start($, { cwd: '/w', surface: 'terminal', isInteractive }, async (e) => e)
  return {
    runs,
    toasts,
    timers,
    invalidated,
    processes,
    describe: (description) =>
      hooks['tool.describe {"tool":"Skill"}']($, { tool: 'Skill', description }, async (e) => ({ description: e.description })),
    call: (input, beneath) =>
      hooks['tool.call {"tool":"Skill"}']($, { tool: 'Skill', tool_use_id: 'toolu_1', ...input }, async () => beneath),
    describeControl: (description) =>
      hooks[`tool.describe {"tool":"${CONTROL}"}`]($, { tool: CONTROL, description }, async (e) => ({
        description: e.description,
      })),
    control: (input, beneath) =>
      hooks[`tool.call {"tool":"${CONTROL}"}`]($, { tool: CONTROL, tool_use_id: 'toolu_2', ...input }, async () => beneath),
    fire: async () => {
      for (const timer of timers.splice(0)) await timer.fn()
    },
  }
}

test('a built-in the Skill tool refused is queued, and runs only after the hook answered', async () => {
  const mod = await session()
  const answer = await mod.call({ skill: 'compact', args: ' focus on the tests ' }, refusedBy('compact'))

  assert.deepEqual(answer.result, { success: true, commandName: 'compact' })
  assert.match(answer.context[0], /\/compact focus on the tests is queued and runs once this turn ends/)
  assert.deepEqual(mod.runs, [], 'ran inside the hook the turn is waiting on')
  await mod.fire()
  assert.deepEqual(mod.runs, [{ command: 'compact', args: 'focus on the tests' }])
})

test('a leading slash in the name is dropped', async () => {
  const mod = await session()
  await mod.call({ skill: '/clear' }, refusedBy('/clear'))
  await mod.fire()
  assert.deepEqual(mod.runs, [{ command: 'clear', args: '' }])
})

test('/model and /effort are refused and never run: they would save a default for every session', async () => {
  const mod = await session()
  for (const name of ['model', 'effort']) {
    const answer = await mod.call({ skill: name, args: 'opus' }, refusedBy(name))
    assert.match(answer.deny, new RegExp(`/${name} .*default for every new Claude Code session`))
    assert.match(answer.deny, /lich/)
  }
  await mod.fire()
  assert.deepEqual(mod.runs, [])
})

test('what the Skill tool served stays its own', async () => {
  const mod = await session()
  assert.equal(await mod.call({ skill: 'review' }, LOADED), LOADED)
  assert.equal(mod.timers.length, 0)
})

test('a refusal for a name that is no built-in reaches the model untouched', async () => {
  const mod = await session()
  for (const name of ['deploy', 'nonexistent']) {
    const refused = refusedBy(name)
    assert.equal(await mod.call({ skill: name }, refused), refused)
  }
  assert.equal(mod.timers.length, 0)
})

test('a command that fails once queued says so in a toast', async () => {
  const mod = await session({ runFails: true })
  await mod.call({ skill: 'compact' }, refusedBy('compact'))
  await mod.fire()
  assert.deepEqual(mod.toasts, ['/compact did not run: the command queue is closed'])
})

test('the Skill description tells the model it can name a built-in, and is redrawn once enabled', async () => {
  const mod = await session()
  assert.deepEqual(mod.invalidated, ['tool.describe'])
  const { description } = await mod.describe('Execute a skill.')
  assert.ok(description.startsWith('Execute a skill.'))
  assert.match(description, /built-in slash command .* queued and runs once your turn ends/)
})

test('a built-in lich refused because the target is this session is queued on it', async () => {
  const mod = await session()
  const answer = await mod.control(
    { session: 'fix/x', action: 'command', value: '/compact', args: ' keep the plan ' },
    SELF_REFUSAL,
  )

  assert.match(answer.result, /\/compact keep the plan is queued on this session and runs once this turn ends/)
  assert.equal(answer.isError, undefined)
  assert.deepEqual(mod.runs, [], 'ran inside the hook the turn is waiting on')
  await mod.fire()
  assert.deepEqual(mod.runs, [{ command: 'compact', args: 'keep the plan' }])
})

test('control_session naming this session by its id, label or name, in any case, is queued on it', async () => {
  for (const target of ['lich-1', 'fix/x', 'FIX/X', 'lich-plugin-a1b2']) {
    const mod = await session()
    const answer = await mod.control({ session: target, action: 'command', value: 'compact' }, SELF_REFUSAL)
    assert.match(answer.result, /\/compact is queued on this session/, target)
    await mod.fire()
    assert.deepEqual(mod.runs, [{ command: 'compact', args: '' }], target)
  }
})

test('lich refusing a target that whoami does not name as this session reaches the model untouched', async () => {
  const mod = await session()
  assert.equal(await mod.control({ session: 'other', action: 'command', value: 'compact' }, SELF_REFUSAL), SELF_REFUSAL)
  assert.equal(mod.timers.length, 0)
})

test('when whoami fails, only the session id is taken as this session', async () => {
  const mod = await session({ whoami: { exitCode: 1, stdout: '' } })
  assert.equal(await mod.control({ session: 'fix/x', action: 'command', value: 'compact' }, SELF_REFUSAL), SELF_REFUSAL)
  const answer = await mod.control({ session: 'lich-1', action: 'command', value: 'compact' }, SELF_REFUSAL)
  assert.match(answer.result, /\/compact is queued on this session/)
})

test('whoami runs only for a refused command, never for a delivered one', async () => {
  const mod = await session()
  await mod.control({ session: 'peer', action: 'command', value: 'compact' }, DELIVERED)
  await mod.control({ session: 'fix/x', action: 'abort' }, SELF_REFUSAL)
  assert.deepEqual(mod.processes, [])
})

test('control_session on this session refuses /model and /effort, and never runs them', async () => {
  const mod = await session()
  for (const name of ['model', 'effort']) {
    const answer = await mod.control({ session: 'fix/x', action: 'command', value: name }, SELF_REFUSAL)
    assert.match(answer.deny, new RegExp(`/${name} .*default for every new Claude Code session`))
  }
  await mod.fire()
  assert.deepEqual(mod.runs, [])
})

test('what lich answered for another session, or for no self command, reaches the model untouched', async () => {
  const mod = await session()
  for (const [input, beneath] of [
    [{ session: 'peer', action: 'command', value: 'compact' }, DELIVERED],
    [{ session: 'ghost', action: 'command', value: 'compact' }, NO_SUCH],
    [{ session: 'fix/x', action: 'abort' }, SELF_REFUSAL],
    [{ session: 'fix/x', action: 'prompt', value: 'hi' }, SELF_REFUSAL],
    [{ session: 'fix/x', action: 'command', value: 'deploy' }, SELF_REFUSAL],
  ]) {
    assert.equal(await mod.control(input, beneath), beneath)
  }
  assert.equal(mod.timers.length, 0)
})

test('the control_session description says a command on this session is accepted', async () => {
  const mod = await session()
  const { description } = await mod.describeControl('Drive another session. Claude Code sessions only, and never your own.')
  assert.ok(description.startsWith('Drive another session.'))
  assert.match(description, /action command .* this session itself as the target: pass session "lich-1"/)
  assert.match(description, /queued and runs once your turn ends/)
})

for (const [why, options] of [
  ['outside lich', { env: {} }],
  ['in a non-interactive run', { isInteractive: false }],
]) {
  test(`${why} the mod changes nothing`, async () => {
    const mod = await session(options)
    const refused = refusedBy('compact')
    assert.equal(await mod.call({ skill: 'compact' }, refused), refused)
    assert.deepEqual(await mod.describe('Execute a skill.'), { description: 'Execute a skill.' })
    assert.equal(await mod.control({ session: 'fix/x', action: 'command', value: 'compact' }, SELF_REFUSAL), SELF_REFUSAL)
    assert.deepEqual(await mod.describeControl('Drive.'), { description: 'Drive.' })
    assert.equal(mod.timers.length, 0)
    assert.deepEqual(mod.invalidated, [])
  })
}
