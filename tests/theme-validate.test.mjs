// Pins skills/theme/validate.mjs against the app tokens lich requires on
// import: a theme it calls ok must be one lich installs, and the other way round.
//
// Run: node --test tests/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const validator = new URL('../skills/theme/validate.mjs', import.meta.url).pathname
const template = JSON.parse(
  readFileSync(new URL('../skills/theme/template.json', import.meta.url), 'utf8'),
)

// The status tones lich 0.53.0 made required (omartelo/lich#617), with the
// bundled Dark theme's values.
const tones = {
  'tone-pass': 'oklch(0.696 0.17 162.48)',
  'tone-wait': 'oklch(0.769 0.188 70.08)',
}

function validate(app) {
  const path = join(mkdtempSync(join(tmpdir(), 'lich-theme-')), 'theme.json')
  writeFileSync(path, JSON.stringify({ ...template, id: 'tones', app }))
  return spawnSync(process.execPath, [validator, path], { encoding: 'utf8' })
}

test('a theme carrying the status tones passes', () => {
  const run = validate({ ...template.app, ...tones })
  assert.equal(run.status, 0, run.stderr)
})

test('a theme missing a status tone is rejected the way lich rejects it', () => {
  const { 'tone-wait': _, ...app } = { ...template.app, ...tones }
  const run = validate(app)
  assert.equal(run.status, 1)
  assert.match(run.stderr, /app\.tone-wait is required/)
})
