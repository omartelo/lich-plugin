// Pins hooks/status-line.js: the mods' parts share one lich line, drawn among
// the mode labels at the right of Claude Code's prompt footer.
//
// Run: node --test tests/

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { footerLine } from './contract.mjs'
import { register, setStatusPart } from '../hooks/status-line.js'

test('parts share the one line in a fixed order, and the line goes with the last part', () => {
  const lines = []
  for (const [part, text] of [
    ['edits', 'app.js also edited by "docs"'],
    ['workers', '2 workers'],
    ['edits', undefined],
    ['workers', undefined],
  ]) {
    setStatusPart(part, text)
    lines.push(footerLine())
  }

  assert.deepEqual(lines, [
    'lich: app.js also edited by "docs"',
    'lich: 2 workers · app.js also edited by "docs"',
    'lich: 2 workers',
    undefined,
  ])
})

test("the worker count is left out while lich's errands show, which include every worker", () => {
  setStatusPart('workers', '1 worker')
  setStatusPart('errands', '1 task out')
  const withErrands = footerLine()
  setStatusPart('errands', undefined)
  const without = footerLine()
  setStatusPart('workers', undefined)

  assert.equal(withErrands, 'lich: 1 task out')
  assert.equal(without, 'lich: 1 worker')
})

test("the line goes after Claude Code's own modes, which are kept", () => {
  let draw
  register((event, matcher, hook) => {
    assert.equal(event, 'ui.render')
    assert.deepEqual(matcher, { component: 'SessionMode' })
    draw = hook
  })
  const e = { surface: 'terminal', component: 'SessionMode', requestId: 'footer', props: { modes: ['focus'] } }
  const passOn = (rewritten) => rewritten

  assert.equal(draw({}, e, passOn), e, 'with no part the footer is passed on untouched')
  setStatusPart('workers', '1 worker')
  assert.deepEqual(draw({}, e, passOn).props.modes, ['focus', 'lich: 1 worker'])
  setStatusPart('workers', undefined)
})
