// Pins the argv the opencode tools build.
//
// The tools are a client for lich's command line (docs/cli.md there), so what
// this suite owns is the translation: a tool call in, a `lich` invocation out.
// Everything past that — what is refused, how a worktree's fate is decided, the
// wording of an answer — belongs to lich and is tested there. Testing it again
// here would only pin a copy of it.
//
// Run: node --test tests/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LichPlugin, lichTools } from '../opencode/lich.js'

// A stand-in for the zod re-export opencode hands plugins. Only the calls the
// module makes are implemented; the shapes themselves are opencode's to read.
function fakeHelper() {
  const chainable = () => {
    const node = {}
    node.describe = () => node
    node.optional = () => node
    return node
  }
  const tool = (definition) => definition
  tool.schema = { string: chainable, number: chainable, boolean: chainable }
  return tool
}

// A stand-in for Bun's shell: records the argv it was handed and answers with
// whatever the test wants back.
function fakeShell({ exitCode = 0, stdout = '', stderr = '' } = {}) {
  const calls = []
  const $ = (_strings, bin, args) => {
    calls.push({ bin, args })
    const result = {
      nothrow: () => result,
      quiet: () => result,
      then: (resolve) =>
        resolve({ exitCode, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) }),
    }
    return result
  }
  return { $, calls }
}

const INSIDE_LICH = {
  LICH_PORT: '47821',
  LICH_TOKEN: 'tok',
  LICH_SESSION_ID: 'lich-session-1',
  LICH_BIN: '/opt/lich/lich',
}

// withEnv runs fn with the given variables set, restoring whatever was there.
// The whole call runs inside it, executes included: the module reads the
// environment per call rather than at import, which is what keeps a module
// loaded outside lich a no-op instead of a cached decision.
async function withEnv(vars, fn) {
  const before = { ...process.env }
  Object.assign(process.env, vars)
  try {
    return await fn()
  } finally {
    for (const key of Object.keys(vars)) delete process.env[key]
    Object.assign(process.env, before)
  }
}

// withoutLich is the other direction, and it is not hypothetical: this suite is
// often run from inside a lich session, where the coordinates are already in the
// environment and "outside lich" would quietly test nothing.
async function withoutLich(fn) {
  const before = { ...process.env }
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('LICH_')) delete process.env[key]
  }
  try {
    return await fn()
  } finally {
    Object.assign(process.env, before)
  }
}

// inLich runs a test body with a session's coordinates in place, handing it the
// tools and the shell they ran through.
async function inLich(shell, body) {
  return withEnv(INSIDE_LICH, async () => body(await lichTools(shell.$, fakeHelper())))
}

test('every operation lich offers is a tool', async () => {
  const shell = fakeShell()
  await inLich(shell, (tools) => {
  // The same seven the MCP server registers for Claude Code and Codex: an agent
  // that learns one surface should find the other one under the same names.
  assert.deepEqual(Object.keys(tools).sort(), [
    'close_session',
    'list_sessions',
    'list_worktrees',
    'open_session',
    'reply_to_session',
    'send_to_session',
    'wait_for_answer',
  ])
  for (const [name, definition] of Object.entries(tools)) {
    assert.ok(definition.description, `${name} has no description — it is all the agent has to go on`)
    assert.equal(typeof definition.execute, 'function', `${name} does not run`)
  }
  })
})

test('the lich a session belongs to is the one that runs', async () => {
  const shell = fakeShell({ stdout: '[]' })
  await inLich(shell, async (tools) => {
    await tools.list_sessions.execute({})
  })

  // Not "lich" off PATH: a machine running an installed lich beside a dev build
  // has two, and only the one in the environment belongs to this session.
  assert.equal(shell.calls[0].bin, '/opt/lich/lich')
  assert.deepEqual(shell.calls[0].args, ['sessions', '--json'])
})

test('optional arguments are left out rather than sent empty', async () => {
  const shell = fakeShell()
  await inLich(shell, async (tools) => {
    await tools.open_session.execute({ worktree: 'auth-fix' })
    await tools.open_session.execute({ project: 'lich', kind: 'codex', worktree: 'x', base: 'main' })
  })
  // An empty --project would narrow to a project named "".
  assert.deepEqual(shell.calls[0].args, ['open', '--worktree', 'auth-fix'])
  assert.deepEqual(shell.calls[1].args, [
    'open', '--project', 'lich', '--kind', 'codex', '--worktree', 'x', '--base', 'main',
  ])
})

test('a task carries its target, its prompt and a bounded wait', async () => {
  const shell = fakeShell({ stdout: 'PONG' })
  await inLich(shell, async (tools) => {
    const answer = await tools.send_to_session.execute({ session: 'docs', prompt: 'run the tests' })
    assert.equal(answer, 'PONG')
    // Capped, and never zero: a wait longer than the cap is a call that hangs
    // where a ticket would have cost one more turn.
    await tools.send_to_session.execute({ session: 'docs', prompt: 'x', timeout_seconds: 500 })
    await tools.send_to_session.execute({ session: 'docs', prompt: 'x', timeout_seconds: 20 })
    await tools.send_to_session.execute({ session: 'docs', prompt: 'x', timeout_seconds: 'soon' })
  })

  assert.deepEqual(shell.calls[0].args, ['send', '--timeout', '90', 'docs', 'run the tests'])
  assert.equal(shell.calls[1].args[2], '90')
  assert.equal(shell.calls[2].args[2], '20')
  assert.equal(shell.calls[3].args[2], '90')
})

test('force is only passed when it is really true', async () => {
  const shell = fakeShell()
  await inLich(shell, async (tools) => {
    // What it discards is in no commit and on no remote, so a model that fills
    // the field with anything but a boolean true must not read as consent.
    for (const force of [undefined, false, 'false', 'yes', 1, null]) {
      await tools.close_session.execute({ session: 'auth-fix', worktree: 'remove', force })
    }
    for (const call of shell.calls) {
      assert.ok(!call.args.includes('--force'), `--force sent for ${JSON.stringify(call.args)}`)
    }
    await tools.close_session.execute({ session: 'auth-fix', worktree: 'remove', force: true })
  })

  assert.deepEqual(shell.calls.at(-1).args, ['close', '--worktree', 'remove', '--force', 'auth-fix'])
})

test('a refusal comes back as lich worded it', async () => {
  const shell = fakeShell({
    exitCode: 1,
    stderr: 'lich: the worktree /wt/x has uncommitted work\n',
  })

  await inLich(shell, async (tools) => {
    const answer = await tools.close_session.execute({ session: 'x', worktree: 'remove' })
    // Those messages name what was refused and what to do about it; rewriting
    // them here would be a second, worse copy of lich's contract.
    assert.equal(answer, 'lich: the worktree /wt/x has uncommitted work')
  })
})

test('nothing is registered outside a lich session', async () => {
  const shell = fakeShell()

  await withoutLich(async () => {
    assert.equal(await lichTools(shell.$, fakeHelper()), null)

    const plugin = await LichPlugin({ $: shell.$ })
    assert.equal(plugin.tool, undefined)
    // The reports are the part that must survive: they need no helper and no
    // shell, and a session outside lich is exactly where they are a no-op.
    assert.equal(typeof plugin.event, 'function')
  })
})

test('the reports survive a helper that cannot be imported', async () => {
  const shell = fakeShell()
  const plugin = await withEnv(INSIDE_LICH, () => LichPlugin({ $: shell.$ }))

  // opencode resolves its own plugin dependencies; a module dropped where they
  // do not reach still has to report.
  assert.equal(plugin.tool, undefined)
  assert.equal(typeof plugin.event, 'function')
  assert.equal(typeof plugin['tool.execute.before'], 'function')
})
