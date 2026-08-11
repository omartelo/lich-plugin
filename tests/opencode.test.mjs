// Pins the opencode client to lich's contract fixtures.
//
// opencode runs no commands: its client is a module its server imports, so
// instead of spawning a script this suite imports opencode/lich.js, feeds it
// the events opencode actually emits, and asserts the bodies it POSTs against
// the same fixtures the hook scripts answer to (contract.mjs).
//
// The event payloads below were taken off a real opencode run against a stub
// listener — an `opencode serve` driven through its own HTTP API — not off its
// documentation.
//
// Run: node --test tests/

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { LICH_SESSION_ID, assertContractHonoured, lichEnv, startStub, withStub } from './contract.mjs'
import { LichPlugin } from '../opencode/lich.js'

const OPENCODE_SESSION_ID = 'ses_011856954ffe5NEMhsYeTuWykR'
const SUB_SESSION_ID = 'ses_0118000000000000000000000000'
const BORN_TITLE = 'New session - 2026-08-11T01:40:39.211Z'

/** The shape `session.created` / `session.updated` carry. */
const sessionInfo = (overrides = {}) => ({
  sessionID: OPENCODE_SESSION_ID,
  info: {
    id: OPENCODE_SESSION_ID,
    slug: 'swift-wizard',
    version: '1.18.16',
    projectID: 'global',
    directory: '/w',
    path: '',
    title: BORN_TITLE,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1786412439211, updated: 1786412439211 },
    ...overrides,
  },
})

/**
 * Runs the module against a stub, feeding it events, and returns what reached
 * the listener. Reports are fired and never awaited by design, so the stub is
 * polled for the expected count rather than assumed to have it already.
 */
async function reportsFor(drive, { expected = 1, status = 204 } = {}) {
  return withStub(
    async (stub) => {
      const previous = { ...process.env }
      Object.assign(process.env, lichEnv(stub.port))
      try {
        const hooks = await LichPlugin()
        await drive({
          event: (type, properties) => hooks.event({ event: { type, properties } }),
          tool: (input, output) => hooks['tool.execute.before'](input, output),
        })
        await settle(stub, expected)
      } finally {
        for (const key of ['LICH_PORT', 'LICH_TOKEN', 'LICH_SESSION_ID']) delete process.env[key]
        Object.assign(process.env, previous)
      }
      return stub.requests
    },
    { status },
  )
}

/** Waits for `expected` requests, then a beat longer to catch an extra one. */
async function settle(stub, expected) {
  const deadline = Date.now() + 2000
  while (stub.requests.length < expected && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10))
  }
  await new Promise((r) => setTimeout(r, 60))
}

const only = (requests, endpoint) =>
  requests.filter((r) => r.url.startsWith(endpoint + '?'))

// ------------------------------------------------------------------- reports --

test('session.created reports the opencode session id', async () => {
  const requests = await reportsFor(({ event }) => event('session.created', sessionInfo()))
  assert.equal(requests.length, 1)
  const { body } = assertContractHonoured('/session-start', requests[0])
  assert.equal(body.session_id, LICH_SESSION_ID)
  assert.equal(body.provider, 'opencode')
  assert.equal(body.provider_session_id, OPENCODE_SESSION_ID)
})

const STATUS_STATES = [
  ['busy', 'busy'],
  // opencode's idle is the turn ending, which is lich's done.
  ['idle', 'done'],
  // A retry is still working, so the spinner stays on.
  ['retry', 'busy'],
]

for (const [type, state] of STATUS_STATES) {
  test(`session.status ${type} reports ${state}`, async () => {
    const requests = await reportsFor(({ event }) =>
      event('session.status', { sessionID: OPENCODE_SESSION_ID, status: { type } }),
    )
    assert.equal(requests.length, 1)
    const { body } = assertContractHonoured('/hook', requests[0])
    assert.equal(body.state, state)
  })
}

// Every way opencode 1.18.16 asks the user something. The first two were taken
// off a real run; the `.v2.` pair is published in the server's own schema and
// carries the same `sessionID`, so the suffix rule covers it the day it fires.
const ASKED_EVENTS = {
  'permission.asked': {
    id: 'per_fee7bb506001U0pyEOIdUduVvD',
    sessionID: OPENCODE_SESSION_ID,
    permission: 'edit',
    patterns: ['oc-probe.txt'],
    metadata: { filepath: '/w/oc-probe.txt' },
  },
  'question.asked': {
    id: 'que_ff1dae01f001v4G2287HaQw71N',
    sessionID: OPENCODE_SESSION_ID,
    questions: [
      {
        question: 'coffee or tea?',
        header: 'Hot drink preference',
        options: [{ label: 'Coffee', description: 'Go with coffee' }],
      },
    ],
    tool: { messageID: 'msg_ff1dac169001EiYr6PAjjcEL80', callID: 'call_e5dacd91b4a44eec' },
  },
  'permission.v2.asked': {
    id: 'per_fee7bb506001U0pyEOIdUduVvE',
    sessionID: OPENCODE_SESSION_ID,
    action: 'edit',
    resources: ['oc-probe.txt'],
  },
  'question.v2.asked': {
    id: 'que_ff1dae01f001v4G2287HaQw71T',
    sessionID: OPENCODE_SESSION_ID,
    questions: [{ question: 'coffee or tea?' }],
  },
}

for (const [type, properties] of Object.entries(ASKED_EVENTS)) {
  test(`${type} reports waiting`, async () => {
    const requests = await reportsFor(({ event }) => event(type, properties))
    assert.equal(requests.length, 1)
    const { body } = assertContractHonoured('/hook', requests[0])
    assert.equal(body.state, 'waiting')
  })
}

// The point of the suffix rule: a prompt opencode adds later, under a name
// nothing here knows, still reaches the card.
test('an unknown .asked event reports waiting', async () => {
  const requests = await reportsFor(({ event }) =>
    event('elicitation.asked', { id: 'eli_1', sessionID: OPENCODE_SESSION_ID }),
  )
  assert.equal(requests.length, 1)
  assert.equal(assertContractHonoured('/hook', requests[0]).body.state, 'waiting')
})

// ...and its bound: the suffix is the whole rule, so an event merely mentioning
// the word must not put a bell on the card.
test('an event that only contains "asked" reports nothing', async () => {
  const requests = await reportsFor(
    ({ event }) => event('question.asked.dismissed', { sessionID: OPENCODE_SESSION_ID }),
    { expected: 0 },
  )
  assert.equal(requests.length, 0, `a non-prompt raised a bell: ${requests[0]?.raw}`)
})

test('file.edited refreshes the git status', async () => {
  const requests = await reportsFor(({ event }) => event('file.edited', { file: '/w/oc-probe.txt' }))
  assert.equal(requests.length, 1)
  const { body } = assertContractHonoured('/session-touched', requests[0])
  assert.equal(body.session_id, LICH_SESSION_ID)
})

test('tool.execute.before names the tool and what it acts on', async () => {
  const requests = await reportsFor(({ tool }) =>
    tool(
      { tool: 'write', sessionID: OPENCODE_SESSION_ID, callID: 'call_1' },
      { args: { filePath: 'oc-probe.txt', content: 'ok\n' } },
    ),
  )
  assert.equal(requests.length, 1)
  const { body } = assertContractHonoured('/hook', requests[0])
  assert.equal(body.state, 'busy')
  assert.equal(body.tool, 'write')
  assert.equal(body.detail, 'oc-probe.txt')
})

// The detail is optional in the contract: absent, never blank.
test('tool.execute.before omits the detail when the call carries nothing to say', async () => {
  const requests = await reportsFor(({ tool }) =>
    tool({ tool: 'todowrite', sessionID: OPENCODE_SESSION_ID, callID: 'c' }, { args: { todos: [] } }),
  )
  const { body, match } = assertContractHonoured('/hook', requests[0])
  assert.equal(match, 'a tool with nothing to say about it')
  assert.equal(body.tool, 'todowrite')
  assert.ok(!('detail' in body), `sent a detail anyway: ${requests[0].raw}`)
})

test('a bash call names its command line', async () => {
  const requests = await reportsFor(({ tool }) =>
    tool({ tool: 'bash', sessionID: OPENCODE_SESSION_ID, callID: 'c' }, { args: { command: 'go test ./...' } }),
  )
  const { body } = assertContractHonoured('/hook', requests[0])
  assert.equal(body.detail, 'go test ./...')
})

// ------------------------------------------------------------------- titles --

test('the title a session is created with is not reported', async () => {
  const requests = await reportsFor(
    async ({ event }) => {
      await event('session.created', sessionInfo())
      await event('session.updated', sessionInfo())
    },
    { expected: 1 },
  )
  assert.equal(only(requests, '/session-title').length, 0, 'reported the placeholder title')
})

test('a title that replaces the placeholder is reported', async () => {
  const requests = await reportsFor(
    async ({ event }) => {
      await event('session.created', sessionInfo())
      await event('session.updated', sessionInfo({ title: '  Fix the replay ring overflow  ' }))
    },
    { expected: 2 },
  )
  const titles = only(requests, '/session-title')
  assert.equal(titles.length, 1)
  const { body } = assertContractHonoured('/session-title', titles[0])
  assert.equal(body.title, 'Fix the replay ring overflow')
})

test('an update with no title at all is silent', async () => {
  const requests = await reportsFor(
    async ({ event }) => {
      await event('session.created', sessionInfo())
      await event('session.updated', sessionInfo({ title: '   ' }))
    },
    { expected: 1 },
  )
  assert.equal(only(requests, '/session-title').length, 0, 'posted a blank title, which lich rejects')
})

// --------------------------------------------------------------- sub-sessions --

// The task tool runs a sub-agent as its own session. Its idle is that sub-agent
// finishing, not the turn ending, so nothing it says may reach the card.
const sub = { ...sessionInfo().info, id: SUB_SESSION_ID, parentID: OPENCODE_SESSION_ID, title: 'sub' }

test('a sub-session reports no session id of its own', async () => {
  const requests = await reportsFor(
    ({ event }) => event('session.created', { sessionID: SUB_SESSION_ID, info: sub }),
    { expected: 0 },
  )
  assert.equal(requests.length, 0, `a sub-session answered for the card: ${requests[0]?.raw}`)
})

test('a sub-session finishing does not end the turn', async () => {
  const requests = await reportsFor(
    async ({ event }) => {
      await event('session.created', { sessionID: SUB_SESSION_ID, info: sub })
      await event('session.status', { sessionID: SUB_SESSION_ID, status: { type: 'idle' } })
      await event('permission.asked', { sessionID: SUB_SESSION_ID, permission: 'edit' })
      await event('question.asked', { sessionID: SUB_SESSION_ID, questions: [{ question: 'q' }] })
    },
    { expected: 0 },
  )
  assert.equal(requests.length, 0, `a sub-session answered for the card: ${requests[0]?.raw}`)
})

test('a sub-session title is not the card label', async () => {
  const requests = await reportsFor(
    async ({ event }) => {
      await event('session.created', { sessionID: SUB_SESSION_ID, info: sub })
      await event('session.updated', { sessionID: SUB_SESSION_ID, info: { ...sub, title: 'renamed' } })
    },
    { expected: 0 },
  )
  assert.equal(requests.length, 0, `a sub-session renamed the card: ${requests[0]?.raw}`)
})

test('a tool call inside a sub-session is not the card tool line', async () => {
  const requests = await reportsFor(
    async ({ event, tool }) => {
      await event('session.created', { sessionID: SUB_SESSION_ID, info: sub })
      await tool({ tool: 'bash', sessionID: SUB_SESSION_ID, callID: 'c' }, { args: { command: 'ls' } })
    },
    { expected: 0 },
  )
  assert.equal(requests.length, 0, `a sub-session put a tool on the card: ${requests[0]?.raw}`)
})

// ------------------------------------------------------------ client rules --

const PARTIAL_ENVS = {
  'no lich variables at all': {},
  'only LICH_PORT': ['LICH_PORT'],
  'no LICH_TOKEN': ['LICH_PORT', 'LICH_SESSION_ID'],
  'no LICH_SESSION_ID': ['LICH_PORT', 'LICH_TOKEN'],
}

for (const [label, keep] of Object.entries(PARTIAL_ENVS)) {
  test(`no report outside lich: ${label}`, async () => {
    await withStub(async (stub) => {
      const previous = { ...process.env }
      const full = lichEnv(stub.port)
      for (const key of ['LICH_PORT', 'LICH_TOKEN', 'LICH_SESSION_ID']) delete process.env[key]
      // LICH_PORT points at the stub so a leak is caught, not refused.
      for (const key of Array.isArray(keep) ? keep : []) process.env[key] = full[key]
      try {
        const hooks = await LichPlugin()
        await hooks.event({ event: { type: 'session.created', properties: sessionInfo() } })
        await hooks.event({
          event: { type: 'session.status', properties: { sessionID: OPENCODE_SESSION_ID, status: { type: 'busy' } } },
        })
        await new Promise((r) => setTimeout(r, 80))
        assert.equal(stub.requests.length, 0, 'reported without a full lich environment')
      } finally {
        for (const key of ['LICH_PORT', 'LICH_TOKEN', 'LICH_SESSION_ID']) delete process.env[key]
        Object.assign(process.env, previous)
      }
    })
  })
}

test('lich answering 500 changes nothing for the turn', async () => {
  const requests = await reportsFor(
    ({ event }) => event('session.status', { sessionID: OPENCODE_SESSION_ID, status: { type: 'busy' } }),
    { status: 500 },
  )
  assert.equal(requests.length, 1)
})

test('a refused connection is swallowed', async () => {
  const stub = await startStub()
  const { port } = stub
  await stub.close() // nothing listens there any more
  const previous = { ...process.env }
  Object.assign(process.env, lichEnv(port))
  try {
    const hooks = await LichPlugin()
    await hooks.event({
      event: { type: 'session.status', properties: { sessionID: OPENCODE_SESSION_ID, status: { type: 'busy' } } },
    })
    await new Promise((r) => setTimeout(r, 80))
  } finally {
    for (const key of ['LICH_PORT', 'LICH_TOKEN', 'LICH_SESSION_ID']) delete process.env[key]
    Object.assign(process.env, previous)
  }
})

// opencode awaits its plugin hooks, so a report that waited on the listener
// would sit in front of the agent's next step.
test('a hook returns before the listener answers', async () => {
  const server = (await import('node:http')).createServer((req, res) => {
    req.resume()
    setTimeout(() => res.writeHead(204).end(), 3000)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const previous = { ...process.env }
  Object.assign(process.env, lichEnv(server.address().port))
  try {
    const hooks = await LichPlugin()
    const started = Date.now()
    await hooks.event({
      event: { type: 'session.status', properties: { sessionID: OPENCODE_SESSION_ID, status: { type: 'busy' } } },
    })
    const elapsed = Date.now() - started
    assert.ok(elapsed < 500, `the hook waited ${elapsed}ms on the listener`)
  } finally {
    for (const key of ['LICH_PORT', 'LICH_TOKEN', 'LICH_SESSION_ID']) delete process.env[key]
    Object.assign(process.env, previous)
    await new Promise((resolve) => server.close(resolve))
  }
})

// An unknown event must not reach the card, and must not throw either: opencode
// grows events between releases and this module sees all of them.
test('an event the module knows nothing about is ignored', async () => {
  const requests = await reportsFor(
    async ({ event }) => {
      await event('lsp.client.diagnostics', { serverID: 'gopls', path: '/w/main.go' })
      await event('todo.updated', { sessionID: OPENCODE_SESSION_ID, todos: [] })
      await event('installation.updated', { version: '1.18.17' })
    },
    { expected: 0 },
  )
  assert.equal(requests.length, 0, `an unhandled event reached lich: ${requests[0]?.raw}`)
})

test('a malformed event payload is survived', async () => {
  const requests = await reportsFor(
    async ({ event, tool }) => {
      await event('session.created', {})
      await event('session.created', undefined)
      await event('session.status', { sessionID: OPENCODE_SESSION_ID })
      await event('session.updated', { info: null })
      await tool(undefined, undefined)
    },
    { expected: 0 },
  )
  assert.equal(requests.length, 0, `a malformed payload reached lich: ${requests[0]?.raw}`)
})
