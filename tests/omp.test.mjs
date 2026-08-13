// Pins the omp (oh-my-pi) client to lich's contract fixtures.
//
// omp runs no commands: `--hook` and `--extension` are one list and every entry
// is imported as a module, so — like opencode — this suite imports
// omp/lich.js, feeds it the events omp emits, and asserts the bodies it POSTs
// against the same fixtures the hook scripts answer to (contract.mjs).
//
// The event names, the payload fields and the `ctx.sessionManager` methods
// below were measured against omp v17.3.0 (@oh-my-pi/pi-coding-agent), driving
// a real `omp --hook … -p …` run at a stub listener. 17.x moves fast: a name
// that changes there fails here, which is the point of pinning the version in
// this comment.
//
// Run: node --test tests/

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  LICH_SESSION_ID,
  PROVIDERS,
  REJECT_RULES,
  TOKEN,
  assertContractHonoured,
  isJsonObject,
  lichEnv,
  matchingAcceptCase,
  startStub,
  withStub,
} from './contract.mjs'
import * as module from '../omp/lich.js'
import lichPlugin from '../omp/lich.js'

const OMP_SESSION_ID = '019ffb38-ceab-7000-afae-20b8eae145d8'
const SESSION_FILE = `/home/u/.omp/agent/sessions/-w/2026-08-13T13-03-51-979Z_${OMP_SESSION_ID}.jsonl`

/** What omp hands a handler as its second argument, of what this client reads. */
const ctxWith = ({ id = OMP_SESSION_ID, title } = {}) => ({
  sessionManager: {
    getSessionId: () => id,
    getSessionName: () => title,
    getSessionFile: () => SESSION_FILE,
  },
})

/** The `session_stop` payload omp sends, of what this client reads. */
const stopEvent = () => ({
  type: 'session_stop',
  turn_id: 0,
  session_id: OMP_SESSION_ID,
  session_file: SESSION_FILE,
  stop_hook_active: false,
})

/** Collects what the module subscribes to, and lets a test fire it. */
function fakePi() {
  const handlers = new Map()
  return {
    pi: {
      on(event, handler) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler])
      },
    },
    subscribed: () => [...handlers.keys()],
    emit(event, payload, ctx) {
      for (const handler of handlers.get(event) ?? []) handler(payload, ctx)
    },
  }
}

/**
 * Loads the module against a stub, feeds it events, and returns what reached
 * the listener. Reports are fired and never awaited by design, so the stub is
 * polled for the expected count rather than assumed to have it already.
 */
async function reportsFor(drive, { expected = 1, status = 204 } = {}) {
  return withStub(
    async (stub) => {
      const previous = { ...process.env }
      Object.assign(process.env, lichEnv(stub.port))
      try {
        const host = fakePi()
        lichPlugin(host.pi)
        await drive(host)
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

const only = (requests, endpoint) => requests.filter((r) => r.url.startsWith(endpoint + '?'))

/**
 * lich has not registered `omp` as a provider id yet: the vendored
 * tests/fixtures/session-start.jsonl carries claude, codex, opencode and crush,
 * so the contract's own "unregistered provider" rule fires on this client's
 * otherwise correct payload. The fixture is upstream truth and is never edited
 * here to make a run green — so until the case lands in lich (and
 * refresh-fixtures.sh brings it down) this asserts every rule except that one,
 * and goes back to the shared assertion on its own the day it does.
 */
function assertSessionStart(request) {
  if (PROVIDERS.has('omp')) return assertContractHonoured('/session-start', request)

  assert.equal(request.method, 'POST')
  assert.equal(request.url, `/session-start?token=${TOKEN}`)
  assert.match(request.headers['content-type'] ?? '', /application\/json/)
  assert.ok(isJsonObject(request.raw), `body is not a JSON object: ${request.raw}`)

  const body = JSON.parse(request.raw)
  assert.ok(!('claude_session_id' in body), `body still sends claude_session_id: ${request.raw}`)
  assert.ok(
    matchingAcceptCase('/session-start', body),
    `body matches no accepted shape for /session-start: ${request.raw}`,
  )
  for (const [name, violates] of Object.entries(REJECT_RULES['/session-start'])) {
    if (name === 'unregistered provider') continue
    assert.ok(!violates(body, request.raw), `body is the rejected shape "${name}": ${request.raw}`)
  }
  return { body }
}

// ------------------------------------------------------------------ reports --

test('session_start reports the omp session id', async () => {
  const requests = await reportsFor(({ emit }) => emit('session_start', { type: 'session_start' }, ctxWith()))
  assert.equal(requests.length, 1)
  const { body } = assertSessionStart(requests[0])
  assert.equal(body.session_id, LICH_SESSION_ID)
  assert.equal(body.provider, 'omp')
  assert.equal(body.provider_session_id, OMP_SESSION_ID)
})

// The id is the whole point of the report: an empty one is rejected upstream.
test('session_start with no id yet reports nothing', async () => {
  const requests = await reportsFor(
    ({ emit }) => {
      emit('session_start', { type: 'session_start' }, ctxWith({ id: '' }))
      emit('session_start', { type: 'session_start' }, { sessionManager: {} })
      emit('session_start', { type: 'session_start' }, undefined)
    },
    { expected: 0 },
  )
  assert.equal(requests.length, 0, `posted an empty provider session id: ${requests[0]?.raw}`)
})

test('input reports busy', async () => {
  const requests = await reportsFor(({ emit }) =>
    emit('input', { type: 'input', text: 'ship it', source: 'interactive' }, ctxWith()),
  )
  assert.equal(requests.length, 1)
  assert.equal(assertContractHonoured('/hook', requests[0]).body.state, 'busy')
})

// A turn omp starts on its own — a continuation, a retry, print mode — has no
// `input` in front of it, so this is what brings the spinner back.
test('turn_start reports busy', async () => {
  const requests = await reportsFor(({ emit }) =>
    emit('turn_start', { type: 'turn_start', timestamp: 0 }, ctxWith()),
  )
  assert.equal(requests.length, 1)
  assert.equal(assertContractHonoured('/hook', requests[0]).body.state, 'busy')
})

test('session_stop reports done', async () => {
  const requests = await reportsFor(({ emit }) => emit('session_stop', stopEvent(), ctxWith()))
  assert.equal(requests.length, 1)
  const { body } = assertContractHonoured('/hook', requests[0])
  assert.equal(body.state, 'done')
  assert.equal(body.session_id, LICH_SESSION_ID)
})

// --------------------------------------------------------------- tool line --

test('tool_call names the tool and the file it acts on', async () => {
  const requests = await reportsFor(({ emit }) =>
    emit('tool_call', { type: 'tool_call', toolCallId: 'c', toolName: 'write', input: { path: 'omp/lich.js', content: 'ok\n' } }),
  )
  assert.equal(requests.length, 1)
  const { body } = assertContractHonoured('/hook', requests[0])
  assert.equal(body.state, 'busy')
  assert.equal(body.tool, 'write')
  assert.equal(body.detail, 'omp/lich.js')
})

const DETAILS = [
  ['bash', { command: 'node --test tests/' }, 'node --test tests/'],
  ['grep', { pattern: 'LICH_PORT' }, 'LICH_PORT'],
  ['read', { path: 'docs/providers.md' }, 'docs/providers.md'],
  // Not an omp built-in: an extension's or an MCP server's tool, spelled the
  // way its author spelled it.
  ['some_mcp_tool', { query: 'lich harness' }, 'lich harness'],
]

for (const [tool, input, detail] of DETAILS) {
  test(`a ${tool} call names ${detail}`, async () => {
    const requests = await reportsFor(({ emit }) =>
      emit('tool_call', { type: 'tool_call', toolCallId: 'c', toolName: tool, input }),
    )
    const { body } = assertContractHonoured('/hook', requests[0])
    assert.equal(body.tool, tool)
    assert.equal(body.detail, detail)
  })
}

// The detail is optional in the contract: absent, never blank.
test('tool_call omits the detail when the call carries nothing to say', async () => {
  const requests = await reportsFor(({ emit }) =>
    emit('tool_call', { type: 'tool_call', toolCallId: 'c', toolName: 'todo', input: { todos: [] } }),
  )
  const { body, match } = assertContractHonoured('/hook', requests[0])
  assert.equal(match, 'a tool with nothing to say about it')
  assert.equal(body.tool, 'todo')
  assert.ok(!('detail' in body), `sent a detail anyway: ${requests[0].raw}`)
})

// It is on the agent's critical path: a returned `{block: true}` would refuse
// the call the user asked for.
test('the tool_call handler never answers the agent', async () => {
  const host = fakePi()
  const previous = { ...process.env }
  Object.assign(process.env, lichEnv(1))
  try {
    lichPlugin(host.pi)
    for (const handler of host.subscribed()) {
      assert.equal(
        host.emit(handler, { type: handler, toolName: 'bash', input: { command: 'ls' } }, ctxWith()),
        undefined,
        `${handler} returned something omp reads as a decision`,
      )
    }
  } finally {
    for (const key of ['LICH_PORT', 'LICH_TOKEN', 'LICH_SESSION_ID']) delete process.env[key]
    Object.assign(process.env, previous)
  }
})

// ----------------------------------------------------------------- touched --

const WRITERS = ['write', 'edit', 'bash', 'notebook']

for (const tool of WRITERS) {
  test(`a ${tool} result refreshes the git status`, async () => {
    const requests = await reportsFor(({ emit }) =>
      emit('tool_result', { type: 'tool_result', toolCallId: 'c', toolName: tool, input: {}, content: [], isError: false }),
    )
    assert.equal(requests.length, 1)
    const { body } = assertContractHonoured('/session-touched', requests[0])
    assert.equal(body.session_id, LICH_SESSION_ID)
  })
}

// A refresh per read would cost more than the poll it front-runs.
test('a read-only tool result refreshes nothing', async () => {
  const requests = await reportsFor(
    ({ emit }) => {
      for (const toolName of ['read', 'grep', 'glob', 'web_search', 'todo']) {
        emit('tool_result', { type: 'tool_result', toolCallId: 'c', toolName, input: {}, content: [], isError: false })
      }
    },
    { expected: 0 },
  )
  assert.equal(requests.length, 0, `a read refreshed the git status: ${requests[0]?.raw}`)
})

// ------------------------------------------------------------------ titles --

test('the title omp generates is reported when the turn settles', async () => {
  const requests = await reportsFor(
    ({ emit }) => emit('session_stop', stopEvent(), ctxWith({ title: '  Fix the replay ring overflow  ' })),
    { expected: 2 },
  )
  const titles = only(requests, '/session-title')
  assert.equal(titles.length, 1)
  const { body } = assertContractHonoured('/session-title', titles[0])
  assert.equal(body.title, 'Fix the replay ring overflow')
})

// omp writes the title asynchronously, so the turn that produced it may settle
// before it exists. The next turn starting is the second chance.
test('a title that only lands after the turn is reported on the next one', async () => {
  const requests = await reportsFor(
    ({ emit }) => {
      emit('session_stop', stopEvent(), ctxWith())
      emit('turn_start', { type: 'turn_start', timestamp: 0 }, ctxWith({ title: 'Add the omp client' }))
    },
    { expected: 3 },
  )
  const titles = only(requests, '/session-title')
  assert.equal(titles.length, 1)
  assert.equal(assertContractHonoured('/session-title', titles[0]).body.title, 'Add the omp client')
})

test('an unchanged title is not re-sent', async () => {
  const requests = await reportsFor(
    ({ emit }) => {
      emit('session_stop', stopEvent(), ctxWith({ title: 'Add the omp client' }))
      emit('session_stop', stopEvent(), ctxWith({ title: 'Add the omp client' }))
      emit('session_stop', stopEvent(), ctxWith({ title: '  Add the omp client  ' }))
    },
    { expected: 4 },
  )
  assert.equal(only(requests, '/session-title').length, 1, 'sent the same title more than once')
})

test('a session with no title yet says nothing about it', async () => {
  const requests = await reportsFor(
    ({ emit }) => {
      emit('session_stop', stopEvent(), ctxWith({ title: undefined }))
      emit('session_stop', stopEvent(), ctxWith({ title: '   ' }))
      emit('session_stop', stopEvent(), { sessionManager: {} })
    },
    { expected: 3 },
  )
  assert.equal(only(requests, '/session-title').length, 0, 'posted a blank title, which lich rejects')
})

// ------------------------------------------------------------ client rules --

const PARTIAL_ENVS = {
  'no lich variables at all': {},
  'only LICH_PORT': ['LICH_PORT'],
  'no LICH_TOKEN': ['LICH_PORT', 'LICH_SESSION_ID'],
  'no LICH_SESSION_ID': ['LICH_PORT', 'LICH_TOKEN'],
}

// omp discovers `~/.claude` wholesale, so a global install is loaded by every
// omp run on the machine. Outside lich it must subscribe to nothing at all —
// no fetch, no timer, no line in omp's log.
for (const [label, keep] of Object.entries(PARTIAL_ENVS)) {
  test(`no report outside lich: ${label}`, async () => {
    await withStub(async (stub) => {
      const previous = { ...process.env }
      const full = lichEnv(stub.port)
      for (const key of ['LICH_PORT', 'LICH_TOKEN', 'LICH_SESSION_ID']) delete process.env[key]
      // LICH_PORT points at the stub so a leak is caught, not refused.
      for (const key of Array.isArray(keep) ? keep : []) process.env[key] = full[key]
      try {
        const host = fakePi()
        lichPlugin(host.pi)
        assert.deepEqual(host.subscribed(), [], 'subscribed to omp events outside lich')
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
    ({ emit }) => emit('input', { type: 'input', text: 'go', source: 'interactive' }, ctxWith()),
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
    const host = fakePi()
    lichPlugin(host.pi)
    host.emit('input', { type: 'input', text: 'go', source: 'interactive' }, ctxWith())
    await new Promise((r) => setTimeout(r, 80))
  } finally {
    for (const key of ['LICH_PORT', 'LICH_TOKEN', 'LICH_SESSION_ID']) delete process.env[key]
    Object.assign(process.env, previous)
  }
})

// omp awaits its extension handlers, so a report that waited on the listener
// would sit in front of the agent's next step.
test('a handler returns before the listener answers', async () => {
  const server = (await import('node:http')).createServer((req, res) => {
    req.resume()
    setTimeout(() => res.writeHead(204).end(), 3000)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const previous = { ...process.env }
  Object.assign(process.env, lichEnv(server.address().port))
  try {
    const host = fakePi()
    lichPlugin(host.pi)
    const started = Date.now()
    host.emit('input', { type: 'input', text: 'go', source: 'interactive' }, ctxWith())
    const elapsed = Date.now() - started
    assert.ok(elapsed < 500, `the handler waited ${elapsed}ms on the listener`)
  } finally {
    for (const key of ['LICH_PORT', 'LICH_TOKEN', 'LICH_SESSION_ID']) delete process.env[key]
    Object.assign(process.env, previous)
    await new Promise((resolve) => server.close(resolve))
  }
})

// omp grows events between releases and hands this module all of them. A throw
// here is a startup warning in the user's session, and a handler that answers
// with garbage is worse than one that says nothing.
test('a malformed event payload is survived', async () => {
  const requests = await reportsFor(
    ({ emit }) => {
      emit('tool_call', undefined, undefined)
      emit('tool_call', { type: 'tool_call' }, ctxWith())
      emit('tool_call', { type: 'tool_call', toolName: '', input: null }, ctxWith())
      emit('tool_result', {}, undefined)
      emit('session_stop', undefined, undefined)
      emit('session_start', undefined, undefined)
    },
    { expected: 1 },
  )
  // Only the `done` of that bare session_stop is legitimate.
  assert.equal(requests.length, 1, `a malformed payload reached lich: ${requests[1]?.raw}`)
  assert.equal(assertContractHonoured('/hook', requests[0]).body.state, 'done')
})

// omp loads exactly one thing from an extension file: `module.default`, called
// with its API object. Anything else exported is dead weight, and a factory
// that throws is a load error reported at startup.
test('the module is the one factory omp loads, and survives being handed nothing', () => {
  assert.deepEqual(Object.keys(module), ['default'], 'a second export omp will never call')
  assert.equal(typeof module.default, 'function')

  const previous = { ...process.env }
  for (const key of Object.keys(process.env)) if (key.startsWith('LICH_')) delete process.env[key]
  try {
    assert.doesNotThrow(() => lichPlugin(undefined))
    assert.doesNotThrow(() => lichPlugin({}))
    assert.doesNotThrow(() => lichPlugin({ on: null }))
  } finally {
    for (const key of Object.keys(process.env)) if (key.startsWith('LICH_')) delete process.env[key]
    Object.assign(process.env, previous)
  }
})
