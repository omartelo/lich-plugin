// Tells a Claude Code session inside lich when another lich session edited the
// file it is editing. Docs: ../docs/edit-guard.md. No lich contract behind it:
// the sessions meet in the checkout's git dir, not over HTTP.
//
// A subagent lich opens shares its caller's checkout, so two sessions can edit
// one file. Claude Code already refuses an edit that would overwrite a change
// it has not read (measured on 2.1.289, in the doc), so this is coordination,
// not protection: every edit leaves a marker naming the session, and an edit
// to a file another session marked recently carries a note naming it.
//
// Every function that takes `$` is declared here at the top level: the loader
// refuses a module that hands `$` to a nested function.

import { promptLang, say } from "./prompt-text.js"
import { setStatusPart } from "./status-line.js"

// Long enough to span the other session's turn that made the edit, short
// enough that a marker from work long finished stops raising notes.
const RECENT_MS = 10 * 60_000
const MARKER_DIR = "lich-edits"
const GIT_TIMEOUT_MS = 5_000
// The edit's result waits on it, so it is cut well short of the git timeout.
const LICH_TIMEOUT_MS = 2_000

/**
 * @typedef {import('claude-code').EngineInterface} Engine
 * @typedef {{ path: string, session: string, at: number }} Marker
 * @typedef {{ label: string, id?: string }} Peer
 */

/** FNV-1a, 32 bits: a file name for a path; the marker keeps the path itself. */
function hashOf(text) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

/** @param {string} path */
function folderOf(path) {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  return cut <= 0 ? path.slice(0, cut + 1) || "." : path.slice(0, cut)
}

/**
 * Where the marker for `path` lives, or undefined outside a git repository.
 *
 * @param {Engine} $
 * @param {string} path
 */
async function markerPathOf($, path) {
  const git = await $.process.run(["git", "-C", folderOf(path), "rev-parse", "--absolute-git-dir"], {
    timeoutMs: GIT_TIMEOUT_MS,
  })
  if (git.exitCode !== 0) return undefined
  return `${git.stdout.trim()}/${MARKER_DIR}/${hashOf(path)}`
}

/**
 * The marker another session left on `path`, if any.
 *
 * @param {Engine} $
 * @param {string} markerPath
 * @param {string} path
 * @returns {Promise<Marker | undefined>}
 */
async function readMarker($, markerPath, path) {
  if (!(await $.fs.exists(markerPath))) return undefined
  /** @type {Marker} */
  const marker = JSON.parse(await $.fs.read(markerPath))
  return marker.path === path ? marker : undefined
}

/**
 * @param {Marker | undefined} marker
 * @param {string} session
 * @param {number} now
 * @returns {marker is Marker}
 */
function isNews(marker, session, now) {
  return !!marker && marker.session !== session && now - marker.at <= RECENT_MS
}

/**
 * The label on the card of the session `id`, or undefined when lich cannot say.
 *
 * A lich older than the `id` field in `lich sessions --json` lists none, and
 * the session goes unnamed there.
 *
 * @param {Engine} $
 * @param {string} id
 */
async function labelOf($, id) {
  const lich = await $.env.get("LICH_BIN")
  if (!lich) return undefined
  const { exitCode, stdout } = await $.process.run([lich, "sessions", "--json"], { timeoutMs: LICH_TIMEOUT_MS })
  if (exitCode !== 0) return undefined
  /** @type {Peer[]} */
  const peers = JSON.parse(stdout)
  return peers.find((peer) => peer.id === id)?.label
}

/**
 * @param {Marker} marker
 * @param {string} who
 * @param {number} now
 * @param {string} lang
 */
function noteFor(marker, who, now, lang) {
  const minutes = Math.round((now - marker.at) / 60_000)
  const ago = minutes === 0 ? say(lang, "editNoteJustNow") : say(lang, "editNoteAgo", { minutes })
  return say(lang, "editNote", { path: marker.path, who, at: new Date(marker.at).toISOString(), ago })
}

/**
 * The session that left `marker`, by label when lich can say which.
 *
 * @param {Engine} $
 * @param {Marker} marker
 */
async function whoMarked($, marker) {
  let label
  try {
    label = await labelOf($, marker.session)
  } catch (error) {
    logFailure($, error)
  }
  return label ? `"${label}"` : marker.session
}

/** The marker the status line shows, so an older one's timer does not clear a newer one. @type {Marker | undefined} */
let shownMarker

/**
 * Tells the user too, in the status line, until the marker stops being news.
 * The note only reaches the model.
 *
 * @param {Engine} $
 * @param {Marker} marker
 * @param {string} who
 */
function showEditBy($, marker, who) {
  shownMarker = marker
  const name = marker.path.slice(Math.max(marker.path.lastIndexOf("/"), marker.path.lastIndexOf("\\")) + 1)
  setStatusPart("edits", `${name} also edited by ${who}`)
  $.ui.invalidate("ui.render")
}

/**
 * @param {Engine} $
 * @param {Marker} marker
 */
function clearEditBy($, marker) {
  if (shownMarker !== marker) return
  shownMarker = undefined
  setStatusPart("edits", undefined)
  $.ui.invalidate("ui.render")
}

/** @param {Engine} $ @param {unknown} error */
function logFailure($, error) {
  $.ui.log(`lich edit guard: ${error instanceof Error ? error.message : String(error)}`)
}

/**
 * @param {Engine} $
 * @param {{ file_path?: string, notebook_path?: string }} e
 * @param {(e: any) => Promise<any>} next
 */
async function guard($, e, next) {
  const session = await $.env.get("LICH_SESSION_ID")
  const path = e.file_path ?? e.notebook_path
  if (!session || !path) return next(e)

  let markerPath
  let previous
  try {
    markerPath = await markerPathOf($, path)
    previous = markerPath && (await readMarker($, markerPath, path))
  } catch (error) {
    logFailure($, error)
    return next(e)
  }

  const result = await next(e)
  if (!markerPath || result.deny !== undefined) return result

  let note
  try {
    const now = await $.clock.now()
    if (isNews(previous, session, now)) {
      const who = await whoMarked($, previous)
      note = noteFor(previous, who, now, await promptLang($))
      showEditBy($, previous, who)
      $.clock.after(previous.at + RECENT_MS - now, () => clearEditBy($, previous))
    }
    if (!result.isError) await $.fs.write(markerPath, JSON.stringify({ path, session, at: now }))
  } catch (error) {
    logFailure($, error)
  }
  return note ? { ...result, context: [...(result.context ?? []), note] } : result
}

/** @param {import('claude-code').On} on */
export function register(on) {
  on("tool.call", { tool: "Edit" }, guard)
  on("tool.call", { tool: "Write" }, guard)
  on("tool.call", { tool: "NotebookEdit" }, guard)
}
