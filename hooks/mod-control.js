// Lets lich drive a Claude Code session from its card. Contract: ../docs/mod-control.md,
// canonical in https://github.com/omartelo/lich/blob/main/docs/hooks/mod-control.md
//
// A Claude Code mod, not a hook script: hooks/hooks.json names this file under
// `modules`, and Claude Code runs it inside its own process. It reports nothing.
// It holds a long poll open on lich, applies the commands that come back and
// acks each one. A Claude Code that does not run mods ignores the `modules`
// key, and the scripts beside this file keep reporting as before.
//
// Everything outside the module is reached through `$`, which is why every
// function that takes it is declared here at the top level: the loader refuses
// a module that hands `$` to a nested function.

// Sent as X-Lich-Plugin on every request; bumped at release (CLAUDE.md, Release).
const PLUGIN_VERSION = "0.13.2"

// The contract's client rule: after a network error or a 5xx, wait 1 second,
// doubling up to 10, and start over after a 200.
const FIRST_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 10000

// The levels `turn.step` takes. The engine checks an effort only when the next
// model request goes out, long after the command was acked `ok`, and then skips
// the hook, so a level outside these is refused here, where lich hears of it.
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"])

/**
 * @typedef {import('claude-code').EngineInterface} Engine
 * @typedef {'low' | 'medium' | 'high' | 'xhigh' | 'max'} Effort
 * @typedef {{ id: string, kind: string, text?: string, model?: string, effort?: string, instructions?: string }} Command
 * @typedef {{
 *   base: string,
 *   token: string,
 *   session: string,
 *   backoffMs: number,
 *   applying: Promise<void>,
 * }} Link
 * @typedef {{
 *   link?: Link,
 *   turnId?: string,
 *   model?: string,
 *   effort?: Effort,
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
  return { base: `http://127.0.0.1:${port}`, token, session, backoffMs: 0, applying: Promise.resolve() }
}

/**
 * One poll, then the next one scheduled: at once after a 200, later after a
 * failure, never after a 404 (a lich older than the contract).
 *
 * @param {Engine} $
 * @param {State} state
 * @param {Link} link
 */
async function poll($, state, link) {
  const url = `${link.base}/mod/commands?token=${link.token}&session_id=${link.session}`
  /** @type {Command[]} */
  let commands
  try {
    const response = await $.http.fetch(url, { headers: { "X-Lich-Plugin": PLUGIN_VERSION } })
    if (response.status === 404) return
    if (!response.ok) throw new Error(`lich answered ${response.status}`)
    commands = JSON.parse(response.text)
  } catch {
    link.backoffMs = Math.min(link.backoffMs * 2 || FIRST_BACKOFF_MS, MAX_BACKOFF_MS)
    $.clock.after(link.backoffMs, () => void poll($, state, link))
    return
  }
  link.backoffMs = 0
  for (const command of commands) {
    link.applying = link.applying.then(() => {
      const acked = applyAndAck($, state, link, command)
      // A prompt settles only once the session is idle and its turn starts.
      // Waiting on it would hold an abort meant for the running turn until that
      // turn ended, and the abort would then cancel the prompt's own turn.
      if (command.kind !== "prompt") return acked
    })
  }
  $.clock.after(0, () => void poll($, state, link))
}

/**
 * Applies one command and acks it. Every command but a `prompt` holds the next
 * one until its ack is answered: an `abort` ack makes lich end the turn it has
 * open, so one landing after the next `prompt` opened a turn would end that turn
 * instead.
 *
 * @param {Engine} $
 * @param {State} state
 * @param {Link} link
 * @param {Command} command
 */
async function applyAndAck($, state, link, command) {
  /** @type {{ ok: boolean, error?: string }} */
  let outcome
  try {
    await apply($, state, command)
    outcome = { ok: true }
  } catch (error) {
    outcome = { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  try {
    await $.http.fetch(`${link.base}/mod/acks?token=${link.token}`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Lich-Plugin": PLUGIN_VERSION },
      body: JSON.stringify({ session_id: link.session, id: command.id, kind: command.kind, ...outcome }),
    })
  } catch {
    // The contract drops an ack that cannot be sent: lich keeps no table to retry against.
  }
}

/**
 * @param {Engine} $
 * @param {State} state
 * @param {Command} command
 */
async function apply($, state, command) {
  switch (command.kind) {
    case "prompt": {
      const submitted = await $.prompt.submit({ text: command.text ?? "" })
      if (submitted.drop !== undefined) throw new Error(submitted.drop)
      return
    }
    case "abort":
      if (state.turnId === undefined) throw new Error("no turn is running")
      await $.turn.abort({ turnId: state.turnId })
      return
    case "model":
      state.model = command.model
      return
    case "effort":
      if (command.effort !== undefined && !EFFORTS.has(command.effort)) throw new Error("unknown effort")
      state.effort = /** @type {Effort | undefined} */ (command.effort)
      return
    case "compact": {
      const compacted = await $.session.compact({ instructions: command.instructions })
      if (compacted.skip !== undefined) throw new Error(compacted.skip)
      return
    }
    default:
      throw new Error("unknown kind")
  }
}

/** @param {import('claude-code').On} on */
export function register(on) {
  /** @type {State} */
  const state = {}

  on("session.start", async ($, e, next) => {
    // A `claude -p` holds its run open until a parked poll returns, up to 25
    // seconds, and one started from a tool inside a lich session inherits that
    // session's variables, so it would also take the parent's commands.
    if (e.isInteractive && state.link === undefined) {
      state.link = await linkFromEnv($)
      const link = state.link
      if (link) $.clock.after(0, () => void poll($, state, link))
    }
    return next(e)
  })

  on("turn.start", ($, e, next) => {
    state.turnId = e.turnId
    return next(e)
  })

  on("turn.complete", ($, e, next) => {
    if (e.turnId === state.turnId) state.turnId = undefined
    return next(e)
  })

  on("turn.step", async function* ($, e, next) {
    return yield* next({
      ...e,
      ...(state.model !== undefined && { model: state.model }),
      ...(state.effort !== undefined && { effort: state.effort }),
    })
  })
}
