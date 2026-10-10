// Answers the task a lich subagent worker was handed with the worker's own last
// message, the way a native subagent's final message is its result. Contract:
// ../docs/mod-answer.md, canonical in
// https://github.com/omartelo/lich/blob/main/docs/hooks/mod-answer.md
//
// A Claude Code mod, registered by hooks/lich.js beside mod-control.js. Only a
// worker reports: lich sets LICH_SUBAGENT_DEPTH on every Claude Code session it
// starts, 0 at the top and n for a worker n `lich open --subagent` levels down.
// A lich older than that variable spawns every worker with
// LICH_SUBAGENT_CARDS=off instead, which a session the user turned subagent
// cards off for also carries; lich ignores the report from a session with no
// subagent errand open, so that one costs a request per turn and nothing else.
//
// A main-loop turn reports only when its `classic.Stop` lists no background
// task (a shell, subagent, monitor or workflow still running means the turn
// handed work to the background, and the turn Claude Code resumes in once it
// finishes is the one that reports). Its `turn.complete` then says what: an
// answer that is not blank is the worker's answer, a blank one is
// `unanswered: "blank"`. Measured on Claude Code 2.1.289: `classic.Stop` fires
// on the main loop only, before `turn.complete`, and its
// `last_assistant_message` equals the completion's `answer`; an aborted turn
// fires no Stop.
//
// A refused turn and one an API error ended report nothing, though the
// contract has `unanswered: "refusal"` and `"error"` for them. Measured on
// Claude Code 2.1.296, both end through `StopFailure` (a refusal with error
// `invalid_request`) and then `turn.complete`, with no `Stop`, and neither
// carries `background_tasks`: the mod cannot tell a failed turn with nothing
// running from one whose background work resumes it later and answers then,
// so reporting would answer the errand twice.
//
// Every function that takes `$` is declared here at the top level: the loader
// refuses a module that hands `$` to a nested function.

// Sent as X-Lich-Plugin on every request; bumped at release (CLAUDE.md, Release).
const PLUGIN_VERSION = "0.20.0"

// The value a lich older than LICH_SUBAGENT_DEPTH spawns every `--subagent`
// session with.
const CARDS_OFF = "off"

// The contract cuts an answer at this many UTF-16 units, as mod-control.js
// cuts an ask's, which keeps the body under lich's 64 KiB limit.
const ANSWER_LIMIT = 16000

/**
 * @typedef {import('claude-code').EngineInterface} Engine
 * @typedef {{ base: string, token: string, session: string }} Link
 * @typedef {{ idle: boolean, text: string }} Stop
 * @typedef {{ link?: Link, stop?: Stop }} State
 * @typedef {{ text: string } | { unanswered: "blank" }} Report
 */

/**
 * @param {string | undefined} depth LICH_SUBAGENT_DEPTH
 * @param {string | undefined} cards LICH_SUBAGENT_CARDS
 */
function isWorker(depth, cards) {
  if (depth === undefined) return cards === CARDS_OFF
  const levels = Number(depth)
  return Number.isInteger(levels) && levels > 0
}

/**
 * The link to lich, for a worker only.
 *
 * @param {Engine} $
 * @returns {Promise<Link | undefined>}
 */
async function workerLink($) {
  const [port, token, session, depth, cards] = await Promise.all([
    $.env.get("LICH_PORT"),
    $.env.get("LICH_TOKEN"),
    $.env.get("LICH_SESSION_ID"),
    $.env.get("LICH_SUBAGENT_DEPTH"),
    $.env.get("LICH_SUBAGENT_CARDS"),
  ])
  if (!port || !token || !session || !isWorker(depth, cards)) return undefined
  return { base: `http://127.0.0.1:${port}`, token, session }
}

/** @param {string} text */
function cut(text) {
  if (text.length <= ANSWER_LIMIT) return text
  return `${text.slice(0, ANSWER_LIMIT)}\n[truncated]`
}

/**
 * What a finished main-loop turn reports, if anything. The Stop must be the
 * turn's own: an answer's text equals the completion's, a blank Stop comes
 * with a blank completion.
 *
 * @param {Stop | undefined} stop the turn's main-loop `classic.Stop`
 * @param {import('claude-code').TurnCompleteInput} e
 * @returns {Report | undefined}
 */
function reportOf(stop, e) {
  if (stop === undefined || !stop.idle) return undefined
  if (e.reason !== "answer") return undefined
  if (stop.text.trim() === "") return e.answer.trim() === "" ? { unanswered: "blank" } : undefined
  return stop.text === e.answer ? { text: cut(stop.text) } : undefined
}

/**
 * Posts one report beside the chain. One that cannot be sent is dropped: the
 * worker's card still holds it, and a second copy of a report is worse than
 * none.
 *
 * @param {Engine} $
 * @param {Link} link
 * @param {Report} body
 */
async function report($, link, body) {
  try {
    await $.http.fetch(`${link.base}/mod/answer?token=${link.token}`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Lich-Plugin": PLUGIN_VERSION },
      body: JSON.stringify({ session_id: link.session, ...body }),
    })
  } catch {
    // The contract's client rule: a report that cannot be sent is dropped.
  }
}

/**
 * @param {Engine} $
 * @param {State} state
 * @param {import('claude-code').TurnCompleteInput} e
 * @param {(e: import('claude-code').TurnCompleteInput) => unknown} next
 */
function settleTurn($, state, e, next) {
  const stop = state.stop
  state.stop = undefined
  const link = state.link
  const body = link !== undefined && e.agentId === undefined ? reportOf(stop, e) : undefined
  if (link !== undefined && body !== undefined) void report($, link, body)
  return next(e)
}

/** @param {import('claude-code').On} on */
export function register(on) {
  /** @type {State} */
  const state = {}

  // Interactive sessions only: a `claude -p` started from a tool inside a
  // worker inherits its variables, and its answers are not the worker's.
  on("session.start", { isInteractive: true }, async ($, e, next) => {
    state.link = await workerLink($)
    return next(e)
  })

  on("classic.Stop", ($, e, next) => {
    state.stop = { idle: (e.background_tasks ?? []).length === 0, text: e.last_assistant_message ?? "" }
    return next(e)
  })

  // One hook per reason a turn ends with: the matchers keep them beside
  // mod-control.js's own turn.complete hook, which has none, and Claude Code
  // refuses one plugin's second hook on an event with no matcher. The refused,
  // aborted and failed ones report nothing; they are here so every turn drops
  // the Stop it read, and a later turn never inherits it.
  on("turn.complete", { reason: "answer" }, ($, e, next) => settleTurn($, state, e, next))
  on("turn.complete", { reason: "refusal" }, ($, e, next) => settleTurn($, state, e, next))
  on("turn.complete", { reason: "error" }, ($, e, next) => settleTurn($, state, e, next))
  on("turn.complete", { reason: "aborted" }, ($, e, next) => settleTurn($, state, e, next))
}
