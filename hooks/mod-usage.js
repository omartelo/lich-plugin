// Reports what a Claude Code session measured about itself to lich. Contract:
// ../docs/mod-usage.md, canonical in
// https://github.com/omartelo/lich/blob/main/docs/hooks/mod-usage.md
//
// A Claude Code mod, not a hook script: hooks/hooks.json names this file under
// `modules`, beside mod-control.js. It hooks `session.measure`, which fires at
// start, at the end of every main-thread turn and when a rate-limit window
// moves, and posts the context window, the rate limits and the cost to lich,
// which shows those instead of the figures it derives.
//
// Every function that takes `$` is declared here at the top level: the loader
// refuses a module that hands `$` to a nested function.

// Sent as X-Lich-Plugin on every request; bumped at release (CLAUDE.md, Release).
const PLUGIN_VERSION = "0.20.0"

/**
 * @typedef {import('claude-code').EngineInterface} Engine
 * @typedef {import('claude-code').SessionMeasureInput} Measure
 * @typedef {{ base: string, token: string, session: string }} Link
 * @typedef {{
 *   started: Promise<Link | undefined>,
 *   sending: Promise<void>,
 *   gone: boolean,
 * }} State
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
 * The body lich takes: Claude Code's figures under the contract's names, an
 * absent figure left out rather than zeroed.
 *
 * @param {string} session
 * @param {string} conversation
 * @param {Measure} e
 */
function usageBody(session, conversation, e) {
  return {
    session_id: session,
    conversation_id: conversation,
    context: {
      window: e.context.window,
      ...(e.context.tokens !== undefined && { tokens: e.context.tokens }),
      ...(e.context.percent !== undefined && { percent: e.context.percent }),
    },
    rate_limits: e.rateLimits.map((limit) => ({
      kind: limit.kind,
      percent_used: limit.percentUsed,
      ...(limit.resetsAt !== undefined && { resets_at: limit.resetsAt }),
    })),
    ...(e.cost !== undefined && { cost_usd: e.cost.usd }),
  }
}

/**
 * Posts one measurement, once the session's link is known. A report that
 * fails is dropped: the next measurement carries the whole figures again.
 *
 * @param {Engine} $
 * @param {State} state
 * @param {Measure} e
 */
async function report($, state, e) {
  const link = await state.started
  if (!link || state.gone) return
  try {
    const response = await $.http.fetch(`${link.base}/mod/usage?token=${link.token}`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Lich-Plugin": PLUGIN_VERSION },
      body: JSON.stringify(usageBody(link.session, await $.session.id(), e)),
    })
    // A lich older than the contract: nothing it would take is coming.
    if (response.status === 404) state.gone = true
  } catch {
    // The contract drops a report that cannot be sent; it never retries one.
  }
}

/** @param {import('claude-code').On} on */
export function register(on) {
  /** @type {(link: Link | undefined) => void} */
  let start = () => {}
  /** @type {State} */
  const state = {
    started: new Promise((resolve) => {
      start = resolve
    }),
    sending: Promise.resolve(),
    gone: false,
  }

  // Interactive sessions only: a `claude -p` started from a tool inside a lich
  // session inherits that session's variables, and its figures would land on
  // the parent's card. Its measurements wait on a link that never comes.
  on("session.start", { isInteractive: true }, async ($, e, next) => {
    start(await linkFromEnv($))
    return next(e)
  })

  on("session.measure", ($, e, next) => {
    // One at a time, in order: lich keeps the latest report, so an older one
    // landing last would put stale figures back on the card.
    state.sending = state.sending.then(() => report($, state, e))
    return next(e)
  })
}
