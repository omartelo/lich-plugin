// Answers the task a lich subagent worker was handed with the worker's own last
// message, the way a native subagent's final message is its result. Contract:
// ../docs/mod-answer.md, canonical in
// https://github.com/omartelo/lich/blob/main/docs/hooks/mod-answer.md
//
// A Claude Code mod, registered by hooks/lich.js beside mod-control.js. Only a
// worker reports: lich spawns every `lich open --subagent` session with
// LICH_SUBAGENT_CARDS=off, which a session the user turned subagent cards off
// for also carries; lich ignores the report from a session with no subagent
// errand open, so that one costs a request per turn and nothing else.
//
// A turn is the worker's answer when its main-loop `classic.Stop` lists no
// background task (a shell, subagent, monitor or workflow still running means
// the turn handed work to the background, and the turn Claude Code resumes in
// once it finishes is the one that answers) and its `turn.complete` ended with
// an answer that is not blank. Measured on Claude Code 2.1.289: `classic.Stop`
// fires on the main loop only, before `turn.complete`, and its
// `last_assistant_message` equals the completion's `answer`; an aborted turn
// fires no Stop.
//
// Every function that takes `$` is declared here at the top level: the loader
// refuses a module that hands `$` to a nested function.

// Sent as X-Lich-Plugin on every request; bumped at release (CLAUDE.md, Release).
const PLUGIN_VERSION = "0.17.0"

// The value lich spawns a `--subagent` session with.
const CARDS_OFF = "off"

// The contract cuts an answer at this many UTF-16 units, as mod-control.js
// cuts an ask's, which keeps the body under lich's 64 KiB limit.
const ANSWER_LIMIT = 16000

/**
 * @typedef {import('claude-code').EngineInterface} Engine
 * @typedef {{ base: string, token: string, session: string }} Link
 * @typedef {{ link?: Link, idleText?: string }} State
 */

/**
 * The link to lich, for a worker only.
 *
 * @param {Engine} $
 * @returns {Promise<Link | undefined>}
 */
async function workerLink($) {
  const [port, token, session, cards] = await Promise.all([
    $.env.get("LICH_PORT"),
    $.env.get("LICH_TOKEN"),
    $.env.get("LICH_SESSION_ID"),
    $.env.get("LICH_SUBAGENT_CARDS"),
  ])
  if (!port || !token || !session || cards !== CARDS_OFF) return undefined
  return { base: `http://127.0.0.1:${port}`, token, session }
}

/** @param {string} text */
function cut(text) {
  if (text.length <= ANSWER_LIMIT) return text
  return `${text.slice(0, ANSWER_LIMIT)}\n[truncated]`
}

/**
 * Posts one answer beside the chain. One that cannot be sent is dropped: the
 * worker's card still holds it, and a second copy of a report is worse than
 * none.
 *
 * @param {Engine} $
 * @param {Link} link
 * @param {string} text
 */
async function report($, link, text) {
  try {
    await $.http.fetch(`${link.base}/mod/answer?token=${link.token}`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Lich-Plugin": PLUGIN_VERSION },
      body: JSON.stringify({ session_id: link.session, text: cut(text) }),
    })
  } catch {
    // The contract's client rule: a report that cannot be sent is dropped.
  }
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
    const idle = (e.background_tasks ?? []).length === 0
    const text = e.last_assistant_message ?? ""
    state.idleText = idle && text.trim() !== "" ? text : undefined
    return next(e)
  })

  // The matcher keeps this beside mod-control.js's own turn.complete hook, which
  // has none: Claude Code refuses one plugin's second hook on an event with no
  // matcher. An aborted, failed or refused turn never matches.
  on("turn.complete", { reason: "answer" }, ($, e, next) => {
    const text = state.idleText
    state.idleText = undefined
    const link = state.link
    const isWorkersAnswer = link !== undefined && e.agentId === undefined && !e.isAborted && text === e.answer
    if (isWorkersAnswer && text !== undefined) void report($, link, text)
    return next(e)
  })
}
