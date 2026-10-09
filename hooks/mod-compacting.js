// Reports a Claude Code conversation being compacted to lich, as the
// session-state contract's `compacting`. Contract: ../docs/session-state.md,
// canonical in https://github.com/omartelo/lich/blob/main/docs/hooks/session-state.md
//
// A Claude Code mod, registered by hooks/lich.js. It brackets `session.compact`:
// `compacting` before the compaction runs, and the state the session goes back
// to once `next(e)` settles, whether the compaction stood or failed. A manual
// /compact runs at an idle prompt, so it closes with `done`; an automatic one
// runs inside a turn, ahead of the model request that follows, so it closes
// with `busy` and the turn's own Stop reports `done` later.
//
// A settings hook could not do this: `PostCompact` never fires for a
// compaction that fails, and two measured ones do (Claude Code 2.1.295). Esc
// on a manual /compact rejects `next(e)` with "Request was aborted", and an
// automatic one the engine gives up on rejects it within ~40ms with "reactive
// compaction did not settle ok" while the turn goes on.
//
// Every function that takes `$` is declared here at the top level: the loader
// refuses a module that hands `$` to a nested function.

// Sent as X-Lich-Plugin on every request; bumped at release (CLAUDE.md, Release).
const PLUGIN_VERSION = "0.19.0"

/**
 * @typedef {import('claude-code').EngineInterface} Engine
 * @typedef {import('claude-code').SessionCompactInput} Compaction
 * @typedef {import('claude-code').SessionCompactResult} Compacted
 * @typedef {{ base: string, token: string, session: string }} Link
 * @typedef {'done' | 'busy'} Closing
 * @typedef {{ link?: Link, sending: Promise<void> }} State
 */

/**
 * @param {Engine} $
 * @returns {Promise<Link | undefined>}
 */
async function linkFromEnv($) {
  const [port, token, session] = await Promise.all([
    $.env.get("LICH_PORT"),
    $.env.get("LICH_TOKEN"),
    $.env.get("LICH_SESSION_ID"),
  ])
  if (!port || !token || !session) return undefined
  return { base: `http://127.0.0.1:${port}`, token, session }
}

/**
 * @param {Engine} $
 * @param {Link} link
 * @param {'compacting' | Closing} sessionState
 */
async function report($, link, sessionState) {
  try {
    await $.http.fetch(`${link.base}/hook?token=${link.token}`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Lich-Plugin": PLUGIN_VERSION },
      body: JSON.stringify({ session_id: link.session, state: sessionState }),
    })
  } catch {
    // The contract drops a report that cannot be sent; it never retries one.
  }
}

/**
 * Reports beside the chain, one at a time: lich keeps the latest state, so a
 * closing report landing before its `compacting` would leave the card stuck.
 *
 * @param {Engine} $
 * @param {State} state
 * @param {Link} link
 * @param {'compacting' | Closing} sessionState
 */
function queue($, state, link, sessionState) {
  state.sending = state.sending.then(() => report($, link, sessionState))
}

/**
 * @param {Engine} $
 * @param {State} state
 * @param {Compaction} e
 * @param {(e: Compaction) => Promise<Compacted>} next
 * @param {Closing} closing
 */
async function bracket($, state, e, next, closing) {
  const link = state.link
  // A subagent compacting its own transcript leaves the session's alone.
  if (!link || e.agentId !== undefined) return next(e)
  queue($, state, link, "compacting")
  try {
    return await next(e)
  } finally {
    queue($, state, link, closing)
  }
}

/** @param {import('claude-code').On} on */
export function register(on) {
  /** @type {State} */
  const state = { sending: Promise.resolve() }

  // Interactive sessions only: a `claude -p` started from a tool inside a lich
  // session inherits its variables, and its compactions are not the card's.
  on("session.start", { isInteractive: true }, async ($, e, next) => {
    state.link = await linkFromEnv($)
    return next(e)
  })

  // Only the two triggers measured. `precompute` runs ahead of time, out of
  // sight, and a plugin's own `$.session.compact` was never observed.
  on("session.compact", { trigger: "manual" }, ($, e, next) => bracket($, state, e, next, "done"))
  on("session.compact", { trigger: "auto" }, ($, e, next) => bracket($, state, e, next, "busy"))
}
