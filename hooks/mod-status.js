// Shows the relay errands a Claude Code session is part of in its status line:
// who it owes an answer, the tasks it handed out that are still running, and
// the answers waiting to be collected. Contract: ../docs/mod-status.md,
// canonical in https://github.com/omartelo/lich/blob/main/docs/hooks/mod-status.md
//
// The one contract that reads rather than reports, and reading never collects:
// an answer listed as ready stays in the inbox for the agent.
//
// Every function that takes `$` is declared here at the top level: the loader
// refuses a module that hands `$` to a nested function.

import { setStatusPart } from "./status-line.js"

// Sent as X-Lich-Plugin on every request; bumped at release (CLAUDE.md, Release).
const PLUGIN_VERSION = "0.18.1"

// The contract asks for a read at most every few seconds; the worker count in
// agent-cards.js polls lich on the same period.
const READ_EVERY_MS = 5000

/**
 * @typedef {import('claude-code').EngineInterface} Engine
 * @typedef {{ ticket: string, from: string, asked: string }} Owed
 * @typedef {{ ticket: string, target: string, state: string }} Open
 * @typedef {{ ticket: string, target: string, status: string }} Ready
 * @typedef {{ owed: Owed[], open: Open[], ready: Ready[] }} Status
 * @typedef {{ url: string, timer?: import('claude-code').Timer, reading: boolean }} State
 */

/** @param {number} count @param {string} noun */
function counted(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

/**
 * The status line's text for `status`, or undefined when there is nothing to
 * show. A task out on a session waiting for a human is called out: nobody but
 * the user can move it.
 *
 * @param {Status} status
 */
function errandsLine({ owed, open, ready }) {
  const pieces = []
  if (owed.length === 1 && owed[0].from) pieces.push(`owes "${owed[0].from}" an answer`)
  else if (owed.length > 0) pieces.push(`owes ${counted(owed.length, "answer")}`)
  if (open.length > 0) {
    const waiting = open.filter((errand) => errand.state === "waiting").length
    pieces.push(`${counted(open.length, "task")} out${waiting > 0 ? ` (${waiting} waiting)` : ""}`)
  }
  if (ready.length > 0) pieces.push(`${counted(ready.length, "answer")} to collect`)
  return pieces.length === 0 ? undefined : pieces.join(", ")
}

/**
 * @param {Engine} $
 * @returns {Promise<string | undefined>}
 */
async function statusUrlFromEnv($) {
  const [port, token, session] = await Promise.all([
    $.env.get("LICH_PORT"),
    $.env.get("LICH_TOKEN"),
    $.env.get("LICH_SESSION_ID"),
  ])
  if (!port || !token || !session) return undefined
  return `http://127.0.0.1:${port}/mod/status?token=${encodeURIComponent(token)}&session_id=${encodeURIComponent(session)}`
}

/**
 * One read. A failed one draws nothing from lich until a read works again,
 * and is never retried; a 404 is a lich older than the contract, which stops
 * the reads for the session.
 *
 * @param {Engine} $
 * @param {State} state
 */
async function read($, state) {
  if (state.reading) return
  state.reading = true
  /** @type {string | undefined} */
  let line
  try {
    const response = await $.http.fetch(state.url, { headers: { "X-Lich-Plugin": PLUGIN_VERSION } })
    if (response.status === 404) state.timer?.cancel()
    if (response.ok) line = errandsLine(JSON.parse(response.text))
  } catch {
    // Unreachable or unreadable: the line goes until the next read works.
  }
  state.reading = false
  setStatusPart("errands", line)
  $.ui.invalidate("ui.render")
}

/** @param {import('claude-code').On} on */
export function register(on) {
  // Interactive sessions only: a `claude -p` started from a tool inside a lich
  // session inherits its variables, and would read the parent's errands.
  on("session.start", { isInteractive: true }, async ($, e, next) => {
    const url = await statusUrlFromEnv($)
    if (url) {
      /** @type {State} */
      const state = { url, reading: false }
      state.timer = $.clock.every(READ_EVERY_MS, () => read($, state))
      read($, state)
    }
    return next(e)
  })
}
