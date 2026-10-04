// Runs a general-purpose subagent Claude Code starts as a lich session: its own
// worktree and a card the user can watch and steer, instead of an agent hidden
// inside this session. Docs: ../docs/agent-cards.md. There is no HTTP contract
// behind it: it drives the lich CLI (`$LICH_BIN open`, `$LICH_BIN wait`), whose
// output and exit codes are docs/cli.md in the lich repository.
//
// The Agent call is held until the worker reports, as a foreground subagent
// holds it. Answering at once (`async_launched`) promises a task Claude Code
// can notify about, read and stop, and none of that exists for a lich session;
// held, the ticket also stays attended, so lich never expires it under a long
// run. Esc turns the held call into the unattended case on its own: the report
// then arrives at this session's prompt as a [lich] note.
//
// Claude Code fails a tool.call hook open: one that throws, overruns its budget
// or lets a `$.process.run` reject is skipped and the native agent runs in its
// place (measured on 2.1.289). Every failure is therefore caught here and
// decided: before lich has the task, the native agent runs with a toast saying
// why; after, the call is denied, because a native agent beside the worker
// would do the work twice.
//
// Every function that takes `$` is declared at the top level: the loader
// refuses a module that hands `$` to a nested function or keeps it in a variable.

// lich's `promptLimit` (internal/relay). lich checks it only after the session
// was opened, so a task over it would leave an empty card behind.
const PROMPT_LIMIT_BYTES = 8192

// `lich open --prompt` waits up to `openCall` (60s) for the session and then
// delivers like a send: `deliverWait` (20s) plus `callSlack` (30s), all in
// internal/cli/cli.go. This bound only has to outlast lich's own.
const OPEN_TIMEOUT_MS = 120000

// `$.process.run` kills a child after ten minutes at most, and `lich wait`
// holds the line for its timeout plus a 30s client slack, so each chunk ends
// on lich's answer, never on the kill.
const WAIT_CHUNK_SECONDS = 540
const WAIT_TIMEOUT_MS = 600000

// docs/cli.md, Exit status: a ticket came back (2), the errand is over with no
// answer coming (3). Both print their result like an answer (0) does.
const EXIT_PENDING = 2
const EXIT_NO_ANSWER = 3
const REPORTING_EXITS = new Set([0, EXIT_PENDING, EXIT_NO_ANSWER])

// The bounds lich's own worktree dialog slugs a typed name with
// (`toBranchName`, frontend/src/lib/git/branch-name.ts there), so a branch
// opened here reads like one a person named.
const MIN_WORDS = 2
const MAX_WORDS = 5
const MIN_CHARS = 10
const MAX_CHARS = 40
const FALLBACK_SLUG = "agent"
// Marks a worker's branch, so the mod inside that worker leaves its own
// subagents native instead of opening cards from cards.
const WORKER_BRANCH_PREFIX = "subagent/"

// The end of the Agent call's id makes each branch new: lich checks out an
// existing branch as it stands, so a bare slug could land on someone's work.
const SUFFIX_CHARS = 4

/**
 * @typedef {import('claude-code').EngineInterface} Engine
 * @typedef {{ ticket: string, target: string, status: string, answer: string }} Report
 * @typedef {{ label: string, name: string, path: string, delivery?: Report }} Opened
 * @typedef {{ interactive: boolean }} State
 * @typedef {{ tool: "Agent", tool_use_id: string, agentId?: string, description: string, prompt: string,
 *   subagent_type?: string, model?: string, team_name?: string, isolation?: string }} AgentCall
 */

/** @param {unknown} error */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * A call the model made on the main loop for a general-purpose agent, in an
 * interactive session. Another plugin's `$.agent.spawn`, a subagent's own
 * call, a typed agent and a teammate keep their native behaviour.
 *
 * @param {AgentCall} e
 * @param {{ origin: { plugin: string } }} next
 * @param {State} state
 */
function isDelegable(e, next, state) {
  const isModelOnMainLoop = next.origin.plugin === "engine" && e.agentId === undefined
  const isGeneralPurpose = e.subagent_type === undefined || e.subagent_type === "general-purpose"
  const isLocal = e.team_name === undefined && e.isolation !== "remote"
  return state.interactive && isModelOnMainLoop && isGeneralPurpose && isLocal
}

/** @param {string} text */
function slugOf(text) {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  /** @type {string[]} */
  const picked = []
  let length = 0
  for (const word of words) {
    const grown = length === 0 ? word.length : length + 1 + word.length
    const hasMinimum = picked.length >= MIN_WORDS && length >= MIN_CHARS
    if (picked.length >= MAX_WORDS || (grown > MAX_CHARS && hasMinimum)) break
    picked.push(word)
    length = grown
  }
  return picked.join("-").slice(0, MAX_CHARS).replace(/-+$/, "")
}

/** @param {AgentCall} e */
function branchFor(e) {
  const suffix = e.tool_use_id.replace(/[^A-Za-z0-9]/g, "").slice(-SUFFIX_CHARS).toLowerCase()
  return `${WORKER_BRANCH_PREFIX}${slugOf(e.description ?? "") || FALLBACK_SLUG}-${suffix}`
}

/**
 * The branch the asking session is on, so the worker starts from its work and
 * not from the main checkout's branch; "" on a detached HEAD or when git
 * cannot answer, which leaves the base to lich.
 *
 * @param {Engine} $
 */
async function currentBranch($) {
  try {
    const { exitCode, stdout } = await $.process.run(["git", "branch", "--show-current"])
    return exitCode === 0 ? stdout.trim() : ""
  } catch {
    // A rejection here would fail the whole hook open; lich's default base is the answer instead.
    return ""
  }
}

/** @param {string} stdout */
function parsedOrUndefined(stdout) {
  try {
    return JSON.parse(stdout)
  } catch {
    return undefined
  }
}

/**
 * Opens the worker and hands it the task. Throws when the task did not reach
 * it, with lich's own reason.
 *
 * @param {Engine} $
 * @param {string} lich
 * @param {AgentCall} e
 * @param {string} branch
 * @param {string} base
 * @returns {Promise<Opened & { delivery: Report }>}
 */
async function openWorker($, lich, e, branch, base) {
  const argv = [
    lich, "open", "--kind", "claude", "--worktree", branch,
    ...(base ? ["--base", base] : []),
    ...(e.model ? ["--model", e.model] : []),
    "--prompt", e.prompt, "--json",
  ]
  const { exitCode, stdout, stderr } = await $.process.run(argv, { timeoutMs: OPEN_TIMEOUT_MS })
  /** @type {Opened | undefined} */
  const opened = parsedOrUndefined(stdout)
  const reason = stderr.trim() || `lich open exited ${exitCode}`
  if (opened === undefined) throw new Error(reason)
  if (opened.delivery === undefined) throw new Error(`the task did not reach "${opened.label}": ${reason}`)
  return /** @type {Opened & { delivery: Report }} */ (opened)
}

/**
 * Waits on the ticket a chunk at a time until the errand has an outcome.
 *
 * @param {Engine} $
 * @param {string} lich
 * @param {Report} delivery
 * @returns {Promise<Report>}
 */
async function awaitReport($, lich, delivery) {
  let report = delivery
  while (report.status === "pending") {
    const argv = [lich, "wait", "--timeout", String(WAIT_CHUNK_SECONDS), "--json", delivery.ticket]
    const { exitCode, stdout, stderr } = await $.process.run(argv, { timeoutMs: WAIT_TIMEOUT_MS })
    if (!REPORTING_EXITS.has(exitCode)) throw new Error(stderr.trim() || `lich wait exited ${exitCode}`)
    report = JSON.parse(stdout)
  }
  return report
}

/**
 * The Agent tool's `completed` arm, which Claude Code checks a hook's result
 * against. The worker's tokens and tools are its own session's, so none are
 * counted here.
 *
 * @param {AgentCall} e
 * @param {Opened} opened
 * @param {string} branch
 * @param {string} text
 * @param {number} durationMs
 */
function completed(e, opened, branch, text, durationMs) {
  return {
    status: /** @type {const} */ ("completed"),
    agentId: opened.name,
    content: [{ type: /** @type {const} */ ("text"), text }],
    totalToolUseCount: 0,
    totalDurationMs: durationMs,
    totalTokens: 0,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      server_tool_use: null,
      service_tier: null,
      cache_creation: null,
    },
    prompt: e.prompt,
    worktreePath: opened.path,
    worktreeBranch: branch,
  }
}

/**
 * @param {AgentCall} e
 * @param {Opened} opened
 * @param {string} branch
 * @param {Report} report
 * @param {number} durationMs
 */
function answerFor(e, opened, branch, report, durationMs) {
  switch (report.status) {
    case "answered": {
      const where =
        `The work is on branch ${branch} in ${opened.path} (lich session "${opened.label}"), not in this checkout. ` +
        `Reach that session with send_to_session or lich send, not SendMessage.`
      return { result: completed(e, opened, branch, `${report.answer}\n\n${where}`, durationMs) }
    }
    case "unanswered": {
      const text =
        `"${opened.label}" ended its turn without reporting back through lich. What it did is on its card and on ` +
        `branch ${branch}; a report it sends later arrives here as a [lich] note.`
      return { result: completed(e, opened, branch, text, durationMs) }
    }
    case "unread":
    case "undelivered":
      return { deny: `the task never reached "${opened.label}" (${report.status}): open its card.` }
    default:
      throw new Error(`lich answered "${report.status}"`)
  }
}

/**
 * @param {Engine} $
 * @param {AgentCall} e
 * @param {(e: AgentCall) => Promise<unknown>} next
 * @param {string} reason
 */
function runNatively($, e, next, reason) {
  $.ui.toast(`lich: ran "${e.description}" as a Claude Code subagent: ${reason}`)
  return next(e)
}

/**
 * @param {Engine} $
 * @param {State} state
 * @param {AgentCall} e
 * @param {any} next
 */
async function runAsSession($, state, e, next) {
  if (!isDelegable(e, next, state)) return next(e)
  const [lich, session] = await Promise.all([$.env.get("LICH_BIN"), $.env.get("LICH_SESSION_ID")])
  if (!lich || !session) return next(e)
  const bytes = new TextEncoder().encode(e.prompt).length
  if (bytes > PROMPT_LIMIT_BYTES) {
    return runNatively($, e, next, `the task is ${bytes} bytes, over lich's ${PROMPT_LIMIT_BYTES}`)
  }

  const base = await currentBranch($)
  if (base.startsWith(WORKER_BRANCH_PREFIX)) return next(e)
  const startedMs = await $.clock.now()
  const branch = branchFor(e)
  /** @type {Opened & { delivery: Report }} */
  let opened
  try {
    opened = await openWorker($, lich, e, branch, base)
  } catch (error) {
    if (next.signal.aborted) {
      return {
        deny: `interrupted; a lich session on branch ${branch} may already have the task, and a report it sends arrives here as a [lich] note.`,
      }
    }
    return runNatively($, e, next, messageOf(error))
  }

  try {
    const report = await awaitReport($, lich, opened.delivery)
    return answerFor(e, opened, branch, report, (await $.clock.now()) - startedMs)
  } catch (error) {
    if (next.signal.aborted) {
      return {
        deny: `interrupted; "${opened.label}" keeps running on branch ${branch}, and a report it sends arrives here as a [lich] note.`,
      }
    }
    return {
      deny:
        `lich stopped answering about "${opened.label}" (${messageOf(error)}). It may still be running on branch ` +
        `${branch}, but a report it sends reaches this session only while the lich that opened it runs: open its card.`,
    }
  }
}

/** @param {import('claude-code').On} on */
export function register(on) {
  /** @type {State} */
  const state = { interactive: false }

  // A `claude -p` started from a tool inside a lich session inherits its
  // variables; its subagents are its own and stay inside it. The matcher is
  // also what lets this module hook `session.start` beside mod-control.js:
  // Claude Code refuses one plugin's second hook on an event with no matcher.
  on("session.start", { isInteractive: true }, ($, e, next) => {
    state.interactive = true
    return next(e)
  })

  on("tool.call", { tool: "Agent" }, ($, e, next) => runAsSession($, state, e, next))
}
