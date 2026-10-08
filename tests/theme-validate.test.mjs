// Pins skills/theme/validate.mjs against what lich does when it installs a
// theme: a theme it calls ok must be one lich installs, and the other way round.
//
// Run: node --test tests/

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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

function validatePath(path) {
  return spawnSync(process.execPath, [validator, path], { encoding: 'utf8' })
}

function validateTheme(theme) {
  const path = join(mkdtempSync(join(tmpdir(), 'lich-theme-')), 'theme.json')
  writeFileSync(path, JSON.stringify({ ...template, ...theme }))
  return validatePath(path)
}

function validate(app) {
  return validateTheme({ id: 'tones', app })
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

// From here on the rule is what lich does when it installs: readPackTheme and
// Import in lich's internal/themes, not the schema it generates.

test('formatVersion 0 passes, the way lich reads an omitted one', () => {
  const result = validateTheme({ formatVersion: 0 })
  assert.equal(result.status, 0, result.stderr)
})

test('a negative formatVersion is rejected with lich\'s message', () => {
  const result = validateTheme({ formatVersion: -1 })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /theme formatVersion -1 must be a positive integer/)
})

test('a source lich cannot decode is rejected, as lich fails to parse the file', () => {
  const result = validateTheme({ source: 'https://example.com/themes.git' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /parse theme JSON: source/)
})

// lich replaces a written source on both install paths (Import drops it,
// readPackTheme stamps the repository's), so it never checks the URL in one.
test('a decodable source passes whatever it names, since lich discards it', () => {
  const result = validateTheme({ source: { url: 'ext::sh -c id', version: '1.0.0-rc1' } })
  assert.equal(result.status, 0, result.stderr)
})

test('a directory named like a theme is no theme, so a pack of only that has none', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lich-pack-'))
  writeFileSync(join(dir, 'lich-theme.json'), JSON.stringify({ name: 'Pack', version: '1.0.0' }))
  mkdirSync(join(dir, 'assets.json'))
  const result = validatePath(dir)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /no theme JSON next to lich-theme\.json/)
})
