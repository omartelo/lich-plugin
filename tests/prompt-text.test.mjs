// Pins the agent-facing text catalog (hooks/prompt-text.js) and that each hook
// renders it in the prompt language lich exports as LICH_PROMPT_LANG. The
// English texts are pinned verbatim by each hook's own suite; this one holds
// the catalogs level with each other and runs one text per hook in pt-BR.
//
// Run: node --test tests/

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { en, ptBR, say, promptLang } from '../hooks/prompt-text.js'
import { register as registerAgentCards } from '../hooks/agent-cards.js'
import { register as registerEditGuard } from '../hooks/edit-guard.js'
import { register as registerSelfCommand } from '../hooks/self-command.js'
import { register as registerModControl } from '../hooks/mod-control.js'

const slots = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

// Names the model or the contract matches on: kept literal in every locale.
const LITERALS = [
  '[lich]',
  'send_to_session',
  'wait_for_answer',
  'SendMessage',
  'lich send',
  'mcp__lich__control_session',
  'subagent/',
]

test('every English text has a pt-BR twin and the other way round', () => {
  assert.deepEqual(Object.keys(ptBR).sort(), Object.keys(en).sort())
})

test('a translation fills the same slots as the English text', () => {
  for (const key of Object.keys(en)) assert.deepEqual(slots(ptBR[key]), slots(en[key]), key)
})

test('names that must stay literal are kept in every translation', () => {
  for (const key of Object.keys(en)) {
    for (const literal of LITERALS) {
      if (en[key].includes(literal)) assert.ok(ptBR[key].includes(literal), `${key} lost ${literal}`)
    }
  }
})

test('an unknown or absent language says the English text', () => {
  for (const lang of [undefined, '', 'fr', 'PT-br']) assert.equal(say(lang, 'lichExited', { code: 2 }), 'lich exited 2')
  assert.equal(say('pt-BR', 'lichExited', { code: 2 }), 'o lich saiu com 2')
})

test('a key no catalog has is an error, not an empty text', () => {
  assert.throws(() => say('en', 'nope'), /no prompt text named "nope"/)
})

test('the language is read from LICH_PROMPT_LANG, English when unset or unknown', async () => {
  const lang = (value) => promptLang({ env: { get: async (n) => (n === 'LICH_PROMPT_LANG' ? value : undefined) } })
  assert.equal(await lang('pt-BR'), 'pt-BR')
  assert.equal(await lang('en'), 'en')
  assert.equal(await lang(undefined), 'en')
  assert.equal(await lang('klingon'), 'en')
})

// ------------------------------------------------------------ per hook, pt-BR --

const PT = { LICH_PROMPT_LANG: 'pt-BR' }

function hooksOf(register) {
  const hooks = new Map()
  register((event, ...rest) => {
    const matcher = rest.length > 1 ? rest[0] : {}
    hooks.set(`${event} ${matcher.tool ?? ''}`.trim(), rest.at(-1))
  })
  return hooks
}

const pass = (value) => async () => value
const exits = (code, stdout = '', stderr = '') => ({ exitCode: code, stdout, stderr })

test('agent-cards: the background note, the completed addendum and the denies speak pt-BR', async () => {
  const OPENED = { name: 'w-1', label: 'w', path: '/wt/w', id: 'x' }
  const env = { ...PT, LICH_BIN: '/lich', LICH_SESSION_ID: 'lich-1' }
  const call = async (status, { stderr = '' } = {}) => {
    const hooks = hooksOf(registerAgentCards)
    const runs = [exits(2, JSON.stringify({ ...OPENED, delivery: { ticket: 't', target: 'w', status, answer: 'feito' } }), stderr)]
    const $ = {
      env: { get: async (n) => env[n] },
      clock: { now: async () => 0, after: () => ({ cancel() {} }) },
      process: { run: async () => runs.shift() },
      ui: { toast() {}, invalidate() {} },
    }
    await hooks.get('session.start')($, { isInteractive: true }, async (x) => x)
    const next = Object.assign(pass({ result: 'native' }), { origin: { plugin: 'engine' }, signal: new AbortController().signal })
    const e = { tool: 'Agent', tool_use_id: 't1', description: 'd', prompt: 'p', subagent_type: 'general-purpose' }
    return hooks.get('tool.call Agent')($, e, next)
  }

  const background = await call('pending')
  assert.match(background.context[0], /^O agente roda como a sessão lich "w", neste mesmo checkout, \/wt\/w/)
  assert.match(background.context[0], /\[lich\].*wait_for_answer.*SendMessage.*send_to_session ou lich send/)

  const done = await call('answered')
  assert.match(done.result.content[0].text, /^feito\n\nO trabalho está neste mesmo checkout, \/wt\/w \(sessão lich "w"\)\./)

  assert.equal((await call('unread')).deny, 'a tarefa nunca chegou a "w" (unread): abra o card dela.')
})

test('agent-cards: TaskStop failure speaks pt-BR, the success message stays Claude Code\'s own wording', async () => {
  const env = { ...PT, LICH_BIN: '/lich', LICH_SESSION_ID: 'lich-1' }
  const hooks = hooksOf(registerAgentCards)
  const runs = [
    exits(2, JSON.stringify({ name: 'w-1', label: 'w', path: '/w', delivery: { ticket: 't', target: 'w', status: 'pending', answer: '' } })),
    exits(1, '', 'boom'),
    exits(0, 'ok'),
  ]
  const $ = {
    env: { get: async (n) => env[n] },
    clock: { now: async () => 0, after: () => ({ cancel() {} }) },
    process: { run: async () => runs.shift() },
    ui: { toast() {}, invalidate() {} },
  }
  await hooks.get('session.start')($, { isInteractive: true }, async (x) => x)
  const next = Object.assign(pass({ result: 'native' }), { origin: { plugin: 'engine' }, signal: new AbortController().signal })
  await hooks.get('tool.call Agent')($, { tool: 'Agent', tool_use_id: 't1', description: 'd', prompt: 'p', subagent_type: 'general-purpose' }, next)

  const failed = await hooks.get('tool.call TaskStop')($, { tool: 'TaskStop', task_id: 'w-1' }, next)
  assert.equal(failed.deny, 'o lich não conseguiu parar "w": boom')
  const stopped = await hooks.get('tool.call TaskStop')($, { tool: 'TaskStop', task_id: 'w-1' }, next)
  assert.equal(stopped.result.message, 'Successfully stopped task: w-1 (d)')
})

test('edit-guard: the note about another session speaks pt-BR', async () => {
  const MIN = 60_000
  const T0 = Date.parse('2026-10-05T12:00:00.000Z')
  const disk = new Map()
  let now = T0
  const hooks = hooksOf(registerEditGuard)
  const session = (id) => {
    const env = { ...PT, LICH_SESSION_ID: id }
    const $ = {
      env: { get: async (n) => env[n] },
      clock: { now: async () => now, after: () => ({ cancel() {} }) },
      ui: { log() {}, invalidate() {} },
      process: { run: async () => exits(0, '/r/.git\n') },
      fs: {
        exists: async (p) => disk.has(p),
        read: async (p) => disk.get(p),
        write: async (p, t) => void disk.set(p, t),
      },
    }
    return () => hooks.get('tool.call Edit')($, { tool: 'Edit', file_path: '/r/a.js' }, pass({ result: {}, text: 'ok' }))
  }
  await session('lich-a')()
  now = T0 + 3 * MIN
  const result = await session('lich-b')()
  assert.match(result.context[0], /^\/r\/a\.js também foi editado pela sessão lich lich-a em 2026-10-05T12:00:00\.000Z \(há 3 min\)/)
  assert.match(result.context[0], /send_to_session ou lich send/)
})

test('self-command: the tool notes and the queued answers speak pt-BR', async () => {
  const hooks = hooksOf(registerSelfCommand)
  const env = { ...PT, LICH_SESSION_ID: 'lich-1', LICH_BIN: '/lich' }
  const $ = {
    env: { get: async (n) => env[n] },
    clock: { after() {} },
    command: { list: async () => [{ name: 'compact', source: 'builtin' }, { name: 'model', source: 'builtin' }], run: async () => ({}) },
    ui: { toast() {}, invalidate() {} },
    process: { run: async () => exits(0, JSON.stringify({ label: 'x', name: 'y' })) },
  }
  await hooks.get('session.start')($, { isInteractive: true }, async (e) => e)

  const skill = await hooks.get('tool.describe Skill')($, { tool: 'Skill', description: 'base' }, async (e) => e)
  assert.match(skill.description, /^base\n\nNesta sessão um slash command embutido/)
  const control = await hooks.get('tool.describe mcp__lich__control_session')(
    $,
    { tool: 'mcp__lich__control_session', description: 'base' },
    async (e) => e,
  )
  assert.match(control.description, /passe session "lich-1"\./)

  const refused = { isError: true, result: 'compact is a built-in CLI command, not a skill' }
  const queued = await hooks.get('tool.call Skill')($, { tool: 'Skill', skill: 'compact' }, async () => refused)
  assert.equal(queued.context[0], '/compact está na fila e roda quando este turno terminar. Encerre o turno agora.')

  const denied = await hooks.get('tool.call Skill')($, { tool: 'Skill', skill: 'model', args: 'opus' }, async () => refused)
  assert.match(denied.deny, /^\/model executado de dentro da sessão/)
})

test('mod-control: the side question is prefaced in pt-BR', async () => {
  const hooks = hooksOf(registerModControl)
  const forks = []
  const env = { ...PT, LICH_PORT: '1', LICH_TOKEN: 't', LICH_SESSION_ID: 's' }
  let served = false
  const $ = {
    env: { get: async (n) => env[n] },
    clock: { after: (ms, fn) => setImmediate(fn) },
    http: {
      fetch: async (url) => {
        if (url.includes('/mod/acks')) return { status: 204, ok: true, headers: {}, text: '' }
        if (served) return new Promise(() => {})
        served = true
        const body = [{ id: 'm1', kind: 'ask', question: 'o que faz?' }]
        return { status: 200, ok: true, headers: {}, text: JSON.stringify(body) }
      },
    },
    model: {
      fork: async (args) => {
        forks.push(args)
        return { isAnswered: true, text: 'a', usage: {} }
      },
    },
  }
  await hooks.get('session.start')($, { isInteractive: true }, async (e) => e)
  for (let i = 0; i < 50 && forks.length === 0; i++) await new Promise((r) => setImmediate(r))
  assert.equal(forks.length, 1)
  assert.match(forks[0].prompt, /^Esta é uma pergunta lateral feita de fora do seu turno/)
  assert.ok(forks[0].prompt.endsWith('Pergunta: o que faz?'))
})
