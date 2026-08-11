// lich's contract fixtures, and the assertions both clients answer to.
//
// lich owns the endpoints; this repository owns the two clients that build the
// payloads — the hook scripts (Claude Code, Codex, Crush) and the opencode
// module. The fixtures in tests/fixtures/ are lich's, vendored verbatim
// (tests/refresh-fixtures.sh); they are upstream truth and are never edited to
// make a run green.
//
// Everything here is shared by hooks.test.mjs and opencode.test.mjs so both
// clients are held to the same lines.

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export const ROOT = path.resolve(HERE, '..')
export const TOKEN = 'test-token'
export const LICH_SESSION_ID = 'lich-session-1'

// ---------------------------------------------------------------- fixtures --

/** endpoint → fixture file, per lich's docs/hooks/fixtures/README.md. */
export const FIXTURE_OF = {
  '/hook': 'session-state',
  '/session-start': 'session-start',
  '/session-title': 'session-title',
  '/session-touched': 'session-touched',
}

const readFixture = (name) =>
  readFileSync(path.join(HERE, 'fixtures', `${name}.jsonl`), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))

export const CASES = Object.fromEntries(
  Object.entries(FIXTURE_OF).map(([endpoint, file]) => [endpoint, readFixture(file)]),
)

export const accepted = (endpoint) => CASES[endpoint].filter((c) => c.accept)
export const rejected = (endpoint) => CASES[endpoint].filter((c) => c.reject)

// Enumerations come from the fixtures, not from a copy of them kept here: a
// state or a provider that lich stops accepting stops being accepted below too.
export const STATES = new Set(accepted('/hook').map((c) => c.accept.state))
export const PROVIDERS = new Set(accepted('/session-start').map((c) => c.accept.provider))

export const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
export const blank = (v) => typeof v !== 'string' || v.trim() === ''

/**
 * `reject` prose is documentation, not a matcher, so each rejected case is
 * modelled here as a predicate: true means the body is the shape that case
 * describes. A rejected case with no rule fails its own test, so a new one
 * upstream cannot slip through unmodelled.
 */
export const REJECT_RULES = {
  '/hook': {
    'missing session_id': (b) => !('session_id' in b),
    'empty session_id': (b) => b.session_id === '',
    'missing state': (b) => !('state' in b),
    'unknown state': (b) => 'state' in b && !STATES.has(b.state),
    'state is case sensitive': (b) =>
      typeof b.state === 'string' && !STATES.has(b.state) && STATES.has(b.state.toLowerCase()),
    'malformed json': (b, raw) => !isJsonObject(raw),
  },
  '/session-start': {
    'missing session_id': (b) => !('session_id' in b),
    'missing provider_session_id': (b) => !('provider_session_id' in b) && !('claude_session_id' in b),
    'empty provider_session_id': (b) => b.provider_session_id === '',
    'unregistered provider': (b) => 'provider' in b && !PROVIDERS.has(b.provider),
    'malformed json': (b, raw) => !isJsonObject(raw),
  },
  '/session-title': {
    'missing session_id': (b) => !('session_id' in b),
    'missing title': (b) => !('title' in b),
    'empty title': (b) => b.title === '',
    'blank title': (b) => 'title' in b && blank(b.title),
    'malformed json': (b, raw) => !isJsonObject(raw),
  },
  '/session-touched': {
    'missing session_id': (b) => !('session_id' in b),
    'empty session_id': (b) => b.session_id === '',
    'malformed json': (b, raw) => !isJsonObject(raw),
  },
}

export function isJsonObject(raw) {
  try {
    return isObject(JSON.parse(raw))
  } catch {
    return false
  }
}

/**
 * Compares a sent body against every `accept` case's `body` for the endpoint:
 * same key set, and each value of the same class (a non-blank string stays a
 * non-blank string). Values themselves are dynamic — session ids and titles are
 * whatever the session happens to hold — so only shape is asserted here;
 * enumerated values are pinned by the reject rules.
 *
 * Returns the name of the case it matches, or null.
 */
export function matchingAcceptCase(endpoint, body) {
  const shape = (o) =>
    Object.keys(o)
      .sort()
      .map((k) => `${k}:${blank(o[k]) ? typeof o[k] + '(blank)' : typeof o[k]}`)
      .join(',')
  const sent = shape(body)
  return accepted(endpoint).find((c) => c.body && shape(c.body) === sent)?.name ?? null
}

export function assertContractHonoured(endpoint, request) {
  assert.equal(request.method, 'POST')
  assert.equal(
    request.url,
    `${endpoint}?token=${TOKEN}`,
    `posted to ${request.url}, expected ${endpoint}?token=${TOKEN}`,
  )
  assert.match(request.headers['content-type'] ?? '', /application\/json/)

  assert.ok(isJsonObject(request.raw), `body is not a JSON object: ${request.raw}`)
  const body = JSON.parse(request.raw)

  // claude_session_id is a deprecated alias lich still folds for plugins
  // released before v0.3.0. Nothing shipping today emits it.
  assert.ok(!('claude_session_id' in body), `body still sends claude_session_id: ${request.raw}`)

  const match = matchingAcceptCase(endpoint, body)
  assert.ok(match, `body matches no accepted shape for ${endpoint}: ${request.raw}`)

  for (const [name, violates] of Object.entries(REJECT_RULES[endpoint])) {
    assert.ok(!violates(body, request.raw), `body is the rejected shape "${name}": ${request.raw}`)
  }
  return { body, match }
}

// ------------------------------------------------------------------ harness --

export async function startStub({ status = 204 } = {}) {
  const requests = []
  const server = createServer((req, res) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, raw })
      res.writeHead(status).end()
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    requests,
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

export async function withStub(fn, options) {
  const stub = await startStub(options)
  try {
    return await fn(stub)
  } finally {
    await stub.close()
  }
}

export const lichEnv = (port) => ({
  LICH_PORT: String(port),
  LICH_TOKEN: TOKEN,
  LICH_SESSION_ID,
})
