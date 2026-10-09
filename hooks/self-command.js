// Lets a Claude Code session run one of its own built-in slash commands when the
// person asks for one ("run /compact"). Plugin side only: lich's `control`
// refuses a session controlling itself, so nothing here goes through lich.
// Described in ../docs/self-command.md.
//
// The model asks through a tool it already reaches for, and the mod answers
// that tool's refusal by queueing the command: the Skill tool, which refuses a
// built-in ("compact is a built-in CLI command, not a skill"), and lich's
// control_session, which refuses the session's own ("... is this session, and
// a session cannot control itself"). A tool of the mod's own is not an option:
// Claude Code lists it as `mcp__lich__<name>`, and `$.tool.register` refuses
// that in a session whose MCP config already has lich's own server under that
// name, which is every lich session (measured on 2.1.295).
//
// Every function that takes `$` is declared here at the top level: the loader
// refuses a module that hands `$` to a nested function.

// Run through a mod, these save what they set as the default for every new
// session (measured on Claude Code 2.1.288 and 2.1.289).
const SAVES_A_DEFAULT = new Set(["model", "effort"])

const SKILL_NOTE =
  "\n\nIn this session a built-in slash command (compact, clear, and the like) can be named here too, " +
  "when the user asks you to run it: it is queued and runs once your turn ends, so end your turn right after."

// The name Claude Code gives lich's tool, and the words lich refuses a
// session's own label with (both measured on 2.1.295 with lich's MCP server).
const CONTROL_TOOL = "mcp__lich__control_session"
const CONTROLS_ITSELF = /is this session, and a session cannot control itself/

// A session cannot look its own label up: `list_sessions` and `lich sessions`
// leave it out. The note names it by `LICH_SESSION_ID` instead, which lich
// answers with "no session named" and the mod takes as this session.
/** @param {string} sessionId */
const controlNote = (sessionId) =>
  `\n\nIn this session, action command is accepted with this session itself as the target: pass session ` +
  `"${sessionId}". The command is queued and runs once your turn ends, so end your turn right after.`

/**
 * @typedef {import('claude-code').EngineInterface} Engine
 * @typedef {{ sessionId: string | undefined }} State
 */

/**
 * Queues `/name args` for when the session is idle. `$.command.run` rejects
 * inside a hook the turn is waiting on, so it is called from a timer; a
 * command that then fails has no turn left to answer, so its error goes to a
 * toast.
 *
 * @param {Engine} $
 * @param {string} name
 * @param {string} args
 */
async function runCommand($, name, args) {
  try {
    await $.command.run({ command: name, args })
  } catch (error) {
    $.ui.toast(`/${name} did not run: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * @param {Engine} $
 * @param {string} name
 */
async function isBuiltin($, name) {
  const commands = await $.command.list()
  return commands.some((command) => command.name === name && command.source === "builtin")
}

/**
 * Queues the built-in `name` the model asked for, or refuses it. Undefined
 * when `name` is no built-in, so the caller answers with the tool's own reply.
 *
 * @param {Engine} $
 * @param {string} name
 * @param {string} args
 */
async function queueBuiltin($, name, args) {
  if (SAVES_A_DEFAULT.has(name)) {
    return {
      deny:
        `/${name} run from inside the session would be saved as the default for every new Claude Code ` +
        `session. Ask the user to set it from lich, whose ${name} override applies to this session only.`,
    }
  }
  if (!(await isBuiltin($, name))) return undefined
  $.clock.after(0, () => runCommand($, name, args))
  return `/${[name, args].filter(Boolean).join(" ")}`
}

/** @param {string} name */
const bareName = (name) => name.trim().replace(/^\//, "")

/** @param {import('claude-code').On} on */
export function register(on) {
  /** @type {State} */
  const state = { sessionId: undefined }

  // Interactive lich sessions only: outside lich the plugin adds nothing, and a
  // `claude -p` started from a tool inside a lich session inherits its variables.
  on("session.start", { isInteractive: true }, async ($, e, next) => {
    state.sessionId = await $.env.get("LICH_SESSION_ID")
    if (state.sessionId) $.ui.invalidate("tool.describe")
    return next(e)
  })

  on("tool.describe", { tool: "Skill" }, async ($, e, next) => {
    const described = await next(e)
    if (!state.sessionId) return described
    return { ...described, description: described.description + SKILL_NOTE }
  })

  // The Skill tool runs first: a skill, or a built-in it serves as a prompt
  // (/init, /review), stays its own. Only what it refused is taken.
  on("tool.call", { tool: "Skill" }, async ($, e, next) => {
    const native = await next(e)
    if (!state.sessionId || !("isError" in native && native.isError)) return native
    const name = bareName(e.skill)
    const queued = await queueBuiltin($, name, e.args?.trim() ?? "")
    if (queued === undefined) return native
    if (typeof queued !== "string") return queued
    return {
      result: { success: true, commandName: name },
      context: [`${queued} is queued and runs once this turn ends. End the turn now.`],
    }
  })

  on("tool.describe", { tool: CONTROL_TOOL }, async ($, e, next) => {
    const described = await next(e)
    if (!state.sessionId) return described
    return { ...described, description: described.description + controlNote(state.sessionId) }
  })

  // lich answers first: a command for another session is its own. Only its
  // refusal of this session as the target is taken.
  on("tool.call", { tool: CONTROL_TOOL }, async ($, e, next) => {
    const native = await next(e)
    if (!state.sessionId || e.action !== "command" || typeof e.value !== "string") return native
    if (!("isError" in native && native.isError)) return native
    const targetsItself = e.session === state.sessionId || CONTROLS_ITSELF.test(native.text)
    if (!targetsItself) return native
    const queued = await queueBuiltin($, bareName(e.value), e.args?.trim() ?? "")
    if (queued === undefined) return native
    if (typeof queued !== "string") return queued
    return { result: `${queued} is queued on this session and runs once this turn ends. End the turn now.` }
  })
}
