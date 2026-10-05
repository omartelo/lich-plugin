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

// Long enough to span the other session's turn that made the edit, short
// enough that a marker from work long finished stops raising notes.
const RECENT_MS = 10 * 60_000
const MARKER_DIR = "lich-edits"
const GIT_TIMEOUT_MS = 5_000

/**
 * @typedef {import('claude-code').EngineInterface} Engine
 * @typedef {{ path: string, session: string, at: number }} Marker
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
 */
function noteFor(marker, session, now) {
  if (!marker || marker.session === session || now - marker.at > RECENT_MS) return undefined
  const minutes = Math.round((now - marker.at) / 60_000)
  const ago = minutes === 0 ? "under a minute ago" : `${minutes} min ago`
  return (
    `${marker.path} was also edited by the lich session ${marker.session} at ` +
    `${new Date(marker.at).toISOString()} (${ago}), which shares this checkout and may still be ` +
    `working on it. Re-read the file before building on it, and coordinate with that session through ` +
    `send_to_session or lich send rather than undoing its change.`
  )
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
    note = noteFor(previous, session, now)
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
