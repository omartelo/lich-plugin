// Runs a general-purpose subagent Claude Code starts as a lich session: a card
// the user can watch and steer, instead of an agent hidden inside this session.
// It works in this session's checkout, as a native subagent does, or in a
// worktree of its own when the call asks for `isolation: "worktree"`.
// Docs: ../docs/agent-cards.md. There is no HTTP contract behind it: it drives
// the lich CLI (`$LICH_BIN open`), whose output and exit codes are docs/cli.md
// in the lich repository.
//
// Once lich has the task the Agent call answers at once, as a background
// subagent does, and nothing here waits on the worker: `--subagent` makes lich
// type the worker's whole report at this session's prompt as a [lich] note.
// While workers run, the status line counts them from `$LICH_BIN sessions
// --json`, and Claude Code's TaskStop on one is taken here and done by lich.
//
// Claude Code fails a tool.call hook open: one that throws, overruns its budget
// or lets a `$.process.run` reject is skipped and the native agent runs in its
// place (measured on 2.1.289). Every failure is therefore caught here and
// decided: before lich has the task, the native agent runs with a toast saying
// why; once lich may have it, the call is denied, because a native agent beside
// the worker would do the work twice.
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

// The value lich's Settings › Providers › Claude Code writes into a session's
// environment when "Subagents as lich sessions" is off.
const CARDS_OFF = "off"

// The bounds lich's own worktree dialog slugs a typed name with
// (`toBranchName`, frontend/src/lib/git/branch-name.ts there), so a branch
// opened here reads like one a person named.
const MIN_WORDS = 2
const MAX_WORDS = 5
const MIN_CHARS = 10
const MAX_CHARS = 40
const FALLBACK_SLUG = "agent"
// Marks a worker's branch, so the mod inside that worker leaves its own
// subagents native instead of opening cards from cards. A worker in this
// session's checkout has no branch of its own: lich starts every `--subagent`
// session with LICH_SUBAGENT_CARDS=off instead.
const WORKER_BRANCH_PREFIX = "subagent/"

// How often the status line asks lich which workers still run. Claude Code's
// own "N agents" hint moves as each agent ends; a worker's end reaches lich, not
// this session, so it is read from `lich sessions --json`, one short run of the
// CLI per period while any worker runs.
const WORKER_POLL_MS = 5000

// The end of the Agent call's id makes each branch new: lich checks out an
// existing branch as it stands, so a bare slug could land on someone's work.
const SUFFIX_CHARS = 4

/**
 * @typedef {import('claude-code').EngineInterface} Engine
 * @typedef {{ ticket: string, target: string, status: string, answer: string }} Report
 * @typedef {{ label: string, name: string, path: string, delivery?: Report }} Opened
 * @typedef {{ label: string, name: string, description: string, shared: boolean }} Worker
 * @typedef {{ interactive: boolean, workers: Map<string, Worker>, watching: boolean, lich: string }} State
 * @typedef {{ label: string, name: string, state: string }} Peer
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
 * @param {string} branch "" opens the worker in this session's checkout
 * @param {string} base
 * @returns {Promise<Opened & { delivery: Report }>}
 */
async function openWorker($, lich, e, branch, base) {
  const argv = [
    lich, "open", "--kind", "claude", "--subagent",
    ...(branch ? ["--worktree", branch] : []),
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
 * The Agent tool's `async_launched` arm, plus what the model reads after it.
 * Claude Code's own text for this arm promises a task notification and points
 * at SendMessage, and neither reaches a lich session, so `context` says how the
 * report really comes back. `outputFile` is "", Claude Code's own value for an
 * agent with no output file: without `canReadOutputFile` the model is never
 * shown it.
 *
 * @param {AgentCall} e
 * @param {Opened} opened
 * @param {string} branch
 */
function backgrounded(e, opened, branch) {
  const where = branch
    ? `on branch ${branch} in ${opened.path}, not in this checkout`
    : `in this same checkout, ${opened.path}, and edits its files as you do`
  return {
    result: {
      status: /** @type {const} */ ("async_launched"),
      agentId: opened.name,
      description: e.description,
      prompt: e.prompt,
      outputFile: "",
    },
    context: [
      `The agent runs as the lich session "${opened.label}", ${where}. ` +
        `Its full report arrives at this prompt on its own as a [lich] note, not as a task notification, so there ` +
        `is no need to call wait_for_answer (it still works). SendMessage cannot reach that session; ` +
        `send_to_session or lich send can.`,
    ],
  }
}

/**
 * The Agent tool's `completed` arm, which Claude Code checks a hook's result
 * against. The worker's tokens and tools are its own session's, so none are
 * counted here; a worker in this checkout names no worktree, as a native agent
 * without isolation does.
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
    ...(branch ? { worktreePath: opened.path, worktreeBranch: branch } : {}),
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
    // A worker whose turn ended unanswered is usually still at it: it left a
    // command running in the background and resumes when it finishes, and its
    // report still arrives as a [lich] note.
    case "pending":
    case "unanswered":
      return backgrounded(e, opened, branch)
    case "answered": {
      const where =
        (branch
          ? `The work is on branch ${branch} in ${opened.path} (lich session "${opened.label}"), not in this checkout. `
          : `The work is in this same checkout, ${opened.path} (lich session "${opened.label}"). `) +
        `Reach that session with send_to_session or lich send, not SendMessage.`
      return { result: completed(e, opened, branch, `${report.answer}\n\n${where}`, durationMs) }
    }
    case "unread":
    case "undelivered":
      return { deny: `the task never reached "${opened.label}" (${report.status}): open its card.` }
    default:
      return { deny: `lich answered "${report.status}" about "${opened.label}"${branch ? `, on branch ${branch}` : ""}: open its card.` }
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
  const [lich, session, cards] = await Promise.all([
    $.env.get("LICH_BIN"),
    $.env.get("LICH_SESSION_ID"),
    $.env.get("LICH_SUBAGENT_CARDS"),
  ])
  if (!lich || !session) return next(e)
  if (cards === CARDS_OFF) return next(e)
  const bytes = new TextEncoder().encode(e.prompt).length
  if (bytes > PROMPT_LIMIT_BYTES) {
    return runNatively($, e, next, `the task is ${bytes} bytes, over lich's ${PROMPT_LIMIT_BYTES}`)
  }

  const isolated = e.isolation === "worktree"
  const base = isolated ? await currentBranch($) : ""
  if (base.startsWith(WORKER_BRANCH_PREFIX)) return next(e)
  const startedMs = await $.clock.now()
  const branch = isolated ? branchFor(e) : ""
  /** @type {Opened & { delivery: Report }} */
  let opened
  try {
    opened = await openWorker($, lich, e, branch, base)
  } catch (error) {
    if (next.signal.aborted) {
      return {
        deny: `interrupted; a lich session${branch ? ` on branch ${branch}` : ""} may already have the task, and a report it sends arrives here as a [lich] note.`,
      }
    }
    return runNatively($, e, next, messageOf(error))
  }
  const answer = answerFor(e, opened, branch, opened.delivery, (await $.clock.now()) - startedMs)
  if (opened.delivery.status === "pending") trackWorker($, state, lich, opened, e, branch)
  return answer
}

/**
 * Pins how many workers this session waits on under its prompt, as Claude
 * Code's own hint does for its background agents, and clears it at none.
 * Claude Code puts the plugin's name before the line, so it reads
 * "lich: 2 workers" (measured on 2.1.289).
 *
 * @param {Engine} $
 * @param {State} state
 */
function showWorkers($, state) {
  const count = state.workers.size
  $.ui.status(count === 0 ? undefined : `${count} worker${count === 1 ? "" : "s"}`)
}

/**
 * Keeps one watch running while any worker does.
 *
 * @param {Engine} $
 * @param {State} state
 */
function watchWorkers($, state) {
  if (state.watching || state.workers.size === 0) return
  state.watching = true
  $.clock.after(WORKER_POLL_MS, () => refreshWorkers($, state))
}

/**
 * A worker in this checkout still runs while lich lists it: lich closes one
 * once it reported, and a turn it ended with a command left in the background
 * is done without being finished. An isolated worker keeps its card after it
 * reported, so for it a done turn is the end.
 *
 * @param {Worker} worker
 * @param {Peer[]} peers
 */
function stillRuns(worker, peers) {
  const listed = peers.find((p) => p.name === worker.name)
  return listed !== undefined && (worker.shared || listed.state !== "done")
}

/**
 * Drops the workers lich lists as finished. A list lich could not give leaves
 * the count as it is until the next period.
 *
 * @param {Engine} $
 * @param {State} state
 */
async function refreshWorkers($, state) {
  state.watching = false
  try {
    const { exitCode, stdout } = await $.process.run([state.lich, "sessions", "--json"])
    /** @type {Peer[] | undefined} */
    const peers = exitCode === 0 ? parsedOrUndefined(stdout) : undefined
    const before = state.workers.size
    if (Array.isArray(peers)) {
      for (const [id, worker] of state.workers) {
        if (!stillRuns(worker, peers)) state.workers.delete(id)
      }
    }
    if (state.workers.size !== before) showWorkers($, state)
  } catch {
    // A rejection here reaches no hook; the next period asks again.
  }
  watchWorkers($, state)
}

/**
 * @param {Engine} $
 * @param {State} state
 * @param {string} lich
 * @param {Opened} opened
 * @param {AgentCall} e
 * @param {string} branch
 */
function trackWorker($, state, lich, opened, e, branch) {
  state.lich = lich
  state.workers.set(opened.name, { label: opened.label, name: opened.name, description: e.description, shared: !branch })
  showWorkers($, state)
  watchWorkers($, state)
}

/**
 * Claude Code's TaskStop for a worker this mod opened: Esc in this session
 * leaves a background agent running, and TaskStop is how the model stops one
 * (both measured on 2.1.289). A worker in this checkout is closed, having
 * nothing of its own to keep; an isolated one has its turn stopped, and its
 * card and worktree stay for the user. Any other task goes to Claude Code.
 *
 * @param {Engine} $
 * @param {State} state
 * @param {{ tool: "TaskStop", task_id?: string, shell_id?: string }} e
 * @param {any} next
 */
async function stopWorker($, state, e, next) {
  const id = e.task_id ?? e.shell_id ?? ""
  const worker = state.workers.get(id)
  if (worker === undefined) return next(e)
  const argv = worker.shared
    ? [state.lich, "close", worker.name]
    : [state.lich, "control", worker.name, "abort"]
  let outcome
  try {
    outcome = await $.process.run(argv)
  } catch (error) {
    return { deny: `lich could not stop "${worker.label}": ${messageOf(error)}` }
  }
  if (outcome.exitCode !== 0) {
    return { deny: `lich could not stop "${worker.label}": ${outcome.stderr.trim() || `lich exited ${outcome.exitCode}`}` }
  }
  state.workers.delete(id)
  showWorkers($, state)
  return {
    result: {
      message: `Successfully stopped task: ${id} (${worker.description})`,
      task_id: id,
      task_type: "local_agent",
      command: worker.description,
    },
  }
}

/** @param {import('claude-code').On} on */
export function register(on) {
  /** @type {State} */
  const state = { interactive: false, workers: new Map(), watching: false, lich: "" }

  // A `claude -p` started from a tool inside a lich session inherits its
  // variables; its subagents are its own and stay inside it. The matcher is
  // also what lets this module hook `session.start` beside mod-control.js:
  // Claude Code refuses one plugin's second hook on an event with no matcher.
  on("session.start", { isInteractive: true }, ($, e, next) => {
    state.interactive = true
    return next(e)
  })

  on("tool.call", { tool: "Agent" }, ($, e, next) => runAsSession($, state, e, next))
  on("tool.call", { tool: "TaskStop" }, ($, e, next) => stopWorker($, state, e, next))
}
