// The lich status line under the prompt, shared by the mods. Claude Code keeps
// one `$.ui.status` line per plugin and every mod here is the plugin `lich`, so
// a mod that set it directly would wipe what another mod put there. Each mod
// owns one part instead, and the line is the parts joined in a fixed order.

/** @typedef {"workers" | "edits"} Part */

/** @type {Part[]} */
const ORDER = ["workers", "edits"]
const SEPARATOR = " · "

/** @type {Map<Part, string>} */
const parts = new Map()

/**
 * The line with this mod's part set to `text`, undefined removing it; the
 * caller passes it to `$.ui.status` itself, since the loader refuses `$`
 * handed across an import. Undefined when no part is left, which clears it.
 *
 * @param {Part} part
 * @param {string | undefined} text
 */
export function statusLineWith(part, text) {
  if (text === undefined) parts.delete(part)
  else parts.set(part, text)
  const shown = ORDER.filter((p) => parts.has(p)).map((p) => parts.get(p))
  return shown.length === 0 ? undefined : shown.join(SEPARATOR)
}
