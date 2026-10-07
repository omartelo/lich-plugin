// The lich line in Claude Code's prompt footer, shared by the mods. It is drawn
// dim among the mode labels at the footer's right (`SessionMode`), not through
// `$.ui.status`, which Claude Code draws as a yellow warning. Each mod owns one
// part of the line, and the line is the parts joined in a fixed order.
//
// The errands lich lists (mod-status.js) include every worker agent-cards.js
// opened, so while that part shows, the worker count is left out of the line.
//
// The parts live in this module, not in `$.state`: every part is redrawn by
// its own mod within seconds, except an edit note, which a hot reload of the
// plugin drops early.

/** @typedef {"errands" | "workers" | "edits"} Part */

/** @type {Part[]} */
const ORDER = ["errands", "workers", "edits"]
const SEPARATOR = " · "

/** @type {Map<Part, string>} */
const parts = new Map()

/**
 * Sets this mod's part of the line; undefined removes it. The caller then
 * redraws the footer with `$.ui.invalidate("ui.render")`, since the loader
 * refuses `$` handed across an import.
 *
 * @param {Part} part
 * @param {string | undefined} text
 */
export function setStatusPart(part, text) {
  if (text === undefined) parts.delete(part)
  else parts.set(part, text)
}

function statusLine() {
  const shown = ORDER.filter((p) => parts.has(p) && !(p === "workers" && parts.has("errands")))
  return shown.length === 0 ? undefined : `lich: ${shown.map((p) => parts.get(p)).join(SEPARATOR)}`
}

/** @param {import('claude-code').On} on */
export function register(on) {
  on("ui.render", { component: "SessionMode" }, ($, e, next) => {
    const line = statusLine()
    return line === undefined ? next(e) : next({ ...e, props: { ...e.props, modes: [...e.props.modes, line] } })
  })
}
