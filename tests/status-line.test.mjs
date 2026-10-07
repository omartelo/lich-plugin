// Pins hooks/status-line.js: Claude Code keeps one status line per plugin, so
// the mods' parts share it instead of overwriting each other.
//
// Run: node --test tests/

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { statusLineWith } from '../hooks/status-line.js'

test('parts share the one line in a fixed order, and the line goes with the last part', () => {
  const statuses = [
    statusLineWith('edits', 'app.js also edited by "docs"'),
    statusLineWith('workers', '2 workers'),
    statusLineWith('edits', undefined),
    statusLineWith('workers', undefined),
  ]

  assert.deepEqual(statuses, [
    'app.js also edited by "docs"',
    '2 workers · app.js also edited by "docs"',
    '2 workers',
    undefined,
  ])
})
