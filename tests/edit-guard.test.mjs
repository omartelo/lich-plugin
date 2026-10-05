// Pins the Claude Code edit guard (hooks/edit-guard.js): what it records after
// an edit, and when it tells the model another lich session edited the file.
//
// Like the other mod suites it imports the module and hands it a fake engine:
// `$.fs` is an in-memory map, `$.process.run` answers `git rev-parse` for one
// repository, `$.clock.now` is a number the test moves.
//
// Run: node --test tests/

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { register } from '../hooks/edit-guard.js'
import { register as registerEntry } from '../hooks/lich.js'

const REPO = '/work/repo'
const GIT_DIR = `${REPO}/.git`
const FILE = `${REPO}/src/app.js`
const MINUTE = 60_000
const T0 = Date.parse('2026-10-05T12:00:00.000Z')

const EDITED = { ref: 1, result: { filePath: FILE }, text: 'The file has been updated successfully.' }
const STALE = {
  ref: 2,
  isError: true,
  result: 'File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.',
  text: 'File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.',
}

/**
 * One Claude Code session with the guard loaded. Sessions built over the same
 * `disk` share a checkout. `beneath` answers the call as core would.
 */
function session({ id, disk = new Map(), clock = { now: T0 }, beneath = async () => EDITED, failWrites = false }) {
  const hooks = new Map()
  register((event, matcher, hook) => {
    assert.equal(event, 'tool.call')
    hooks.set(matcher.tool, hook)
  })
  const logs = []
  const env = id === undefined ? {} : { LICH_SESSION_ID: id }
  const $ = {
    env: { get: async (name) => env[name] },
    clock: { now: async () => clock.now },
    ui: { log: (text) => logs.push(text) },
    process: {
      run: async (argv) => {
        assert.deepEqual(argv.slice(0, 1), ['git'])
        const dir = argv[2]
        const inside = dir === REPO || dir.startsWith(`${REPO}/`)
        return inside
          ? { exitCode: 0, stdout: `${GIT_DIR}\n`, stderr: '' }
          : { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' }
      },
    },
    fs: {
      exists: async (path) => disk.has(path),
      read: async (path) => {
        if (!disk.has(path)) throw new Error(`ENOENT: ${path}`)
        return disk.get(path)
      },
      write: async (path, text) => {
        if (failWrites) throw new Error('EACCES: permission denied')
        disk.set(path, text)
      },
    },
  }
  const call = (tool, input) => {
    const hook = hooks.get(tool)
    const e = { tool, tool_use_id: 'toolu_1', ...input }
    return hook ? hook($, e, beneath) : beneath(e)
  }
  return {
    disk,
    clock,
    logs,
    hooks,
    edit: (path = FILE) => call('Edit', { file_path: path, old_string: 'a', new_string: 'b' }),
    write: (path = FILE) => call('Write', { file_path: path, content: 'x' }),
    notebook: (path) => call('NotebookEdit', { notebook_path: path, new_source: 'x = 1' }),
  }
}

const markers = (disk) => [...disk.keys()].filter((k) => k.startsWith(`${GIT_DIR}/lich-edits/`))

test('an edit is recorded under the checkout git dir', async () => {
  const a = session({ id: 'lich-a' })

  const result = await a.edit()

  assert.equal(result, EDITED, 'the result is passed on untouched')
  const [marker] = markers(a.disk)
  assert.ok(marker, 'no marker written')
  assert.deepEqual(JSON.parse(a.disk.get(marker)), { path: FILE, session: 'lich-a', at: T0 })
})

test('another session editing the file within the window is told who and when', async () => {
  const disk = new Map()
  const clock = { now: T0 }
  const a = session({ id: 'lich-a', disk, clock })
  const b = session({ id: 'lich-b', disk, clock })

  await a.edit()
  clock.now = T0 + 3 * MINUTE
  const result = await b.edit()

  assert.equal(result.ref, EDITED.ref, 'the edit went ahead')
  assert.equal(result.context.length, 1)
  assert.match(result.context[0], /lich session lich-a/)
  assert.match(result.context[0], /2026-10-05T12:00:00\.000Z/)
  assert.match(result.context[0], /3 min ago/)
  assert.match(result.context[0], /send_to_session/)
  assert.match(result.context[0], /lich send/)
  assert.equal(JSON.parse(disk.get(markers(disk)[0])).session, 'lich-b', 'the marker now names the last editor')
})

test('the note rides on a refused edit too, where it explains the refusal', async () => {
  const disk = new Map()
  const a = session({ id: 'lich-a', disk })
  const b = session({ id: 'lich-b', disk, beneath: async () => STALE })

  await a.edit()
  const result = await b.write()

  assert.equal(result.isError, true)
  assert.equal(result.text, STALE.text)
  assert.match(result.context[0], /lich session lich-a/)
  assert.match(result.context[0], /under a minute ago/)
  assert.equal(JSON.parse(disk.get(markers(disk)[0])).session, 'lich-a', 'a refused edit is not recorded')
})

test('a session re-editing its own file gets no note', async () => {
  const a = session({ id: 'lich-a' })

  await a.edit()
  const result = await a.edit()

  assert.equal(result, EDITED)
})

test('an edit older than the window gets no note', async () => {
  const disk = new Map()
  const clock = { now: T0 }
  const a = session({ id: 'lich-a', disk, clock })
  const b = session({ id: 'lich-b', disk, clock })

  await a.edit()
  clock.now = T0 + 11 * MINUTE
  const result = await b.edit()

  assert.equal(result, EDITED)
})

test('another file edited by another session gets no note', async () => {
  const disk = new Map()
  const a = session({ id: 'lich-a', disk })
  const b = session({ id: 'lich-b', disk })

  await a.edit(`${REPO}/other.js`)
  const result = await b.edit()

  assert.equal(result, EDITED)
  assert.equal(markers(disk).length, 2)
})

test('Write and NotebookEdit are guarded like Edit', async () => {
  const disk = new Map()
  const nb = `${REPO}/n.ipynb`
  const a = session({ id: 'lich-a', disk })
  const b = session({ id: 'lich-b', disk })

  await a.write()
  await a.notebook(nb)

  assert.match((await b.edit()).context[0], /lich-a/)
  assert.match((await b.notebook(nb)).context[0], /lich-a/)
})

test('a hook deny beneath is passed on and nothing is recorded', async () => {
  const deny = { deny: 'blocked by policy' }
  const a = session({ id: 'lich-a', beneath: async () => deny })

  assert.equal(await a.edit(), deny)
  assert.equal(markers(a.disk).length, 0)
})

test('outside lich nothing is read or written', async () => {
  const a = session({ id: undefined })

  assert.equal(await a.edit(), EDITED)
  assert.equal(a.disk.size, 0)
})

test('outside a git repository nothing is written', async () => {
  const a = session({ id: 'lich-a' })

  assert.equal(await a.edit('/elsewhere/notes.txt'), EDITED)
  assert.equal(a.disk.size, 0)
  assert.deepEqual(a.logs, [])
})

test('a file system failure is logged and the edit result still returned', async () => {
  const a = session({ id: 'lich-a', failWrites: true })

  assert.equal(await a.edit(), EDITED)
  assert.equal(a.logs.length, 1)
  assert.match(a.logs[0], /EACCES/)
})

test('an unreadable marker is logged and the edit result still returned', async () => {
  const disk = new Map()
  const a = session({ id: 'lich-a', disk })
  await a.edit()
  disk.set(markers(disk)[0], '{not json')
  const b = session({ id: 'lich-b', disk })

  const result = await b.edit()

  assert.equal(result.ref, EDITED.ref)
  assert.equal(result.context, undefined)
  assert.equal(b.logs.length, 1)
})

test('the plugin entry module registers the guard on every file-editing tool', () => {
  const tools = []
  registerEntry((event, matcher) => {
    if (event === 'tool.call') tools.push(matcher.tool)
  })
  for (const tool of ['Edit', 'Write', 'NotebookEdit']) assert.ok(tools.includes(tool), `${tool} is not guarded`)
})
