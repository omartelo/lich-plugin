// The edit guard under Claude Code's own engine: `claude plugin test .` loads
// hooks/lich.js from hooks/hooks.json, which registers hooks/edit-guard.js.
// The test's hooks stand for git (`process.run`), the checkout's git dir
// (`fs.*`) and the Edit tool itself (the `tool.call` beneath the mod).
//
// tests/edit-guard.test.mjs is the suite CI runs; this one proves the module
// loads beside the other mods and its note reaches the caller as the engine
// relays a tool result.

import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const GIT_DIR = '/w/.git'
const FILE = '/w/src/app.js'
const T0 = Date.parse('2026-10-05T12:00:00.000Z')
const EDIT = { tool: 'Edit', tool_use_id: 'toolu_1', file_path: FILE, old_string: 'a', new_string: 'b' } as const

/** A checkout another lich session (`lich-a`) edited one minute before T0. */
function world(on: On, session: string | undefined) {
  const disk = new Map<string, string>()
  const edited: string[] = []
  mock.env(on, session ? { LICH_SESSION_ID: session } : {})
  mock.clock(on, { now: T0 })
  on('process.run', async () => ({
    value: { exitCode: 0, stdout: `${GIT_DIR}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('fs.exists', async (_$, e) => ({ value: disk.has(e.path) }))
  on('fs.read', async (_$, e) => ({ value: disk.get(e.path) ?? '' }))
  on('fs.write', async (_$, e) => {
    disk.set(e.path, e.text)
    return { value: undefined }
  })
  on('tool.call', { tool: 'Edit' }, async (_$, e) => {
    edited.push(e.file_path)
    return { result: { filePath: e.file_path } }
  })
  return { disk, edited }
}

const markerOf = (disk: Map<string, string>) => [...disk.entries()].find(([k]) => k.startsWith(`${GIT_DIR}/lich-edits/`))

test('an edit to a file another lich session just edited goes ahead with a note', async ($, on) => {
  const w = world(on, 'lich-a')
  await $.tool.call(EDIT)
  const [path] = markerOf(w.disk) ?? []
  expect(path).toBeDefined()
  w.disk.set(path!, JSON.stringify({ path: FILE, session: 'lich-b', at: T0 - 60_000 }))

  const ran = await $.tool.call(EDIT)

  expect(w.edited).toHaveLength(2)
  expect(ran.deny).toBe(undefined)
  expect(ran.context?.[0]).toContain('lich session lich-b')
  expect(ran.context?.[0]).toContain('send_to_session')
  expect(JSON.parse(markerOf(w.disk)![1]).session).toBe('lich-a')
})

test('outside lich the edit runs untouched and nothing is recorded', async ($, on) => {
  const w = world(on, undefined)
  const ran = await $.tool.call(EDIT)
  expect(w.edited).toHaveLength(1)
  expect(ran.context).toBe(undefined)
  expect(w.disk.size).toBe(0)
})
