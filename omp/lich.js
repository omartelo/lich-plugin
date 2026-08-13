// Reports an omp (oh-my-pi) session to lich. Contracts: ../docs/, canonical in
// https://github.com/omartelo/lich/tree/main/docs/hooks
//
// omp runs no hook commands. `--hook` and `--extension` are the same list — it
// merges both into one set of extension paths and loads every entry as a module
// (`import()`), so even the files it calls "hooks" are modules, never scripts
// fed a payload on stdin. So this one file plays the part the four hooks/*.sh
// scripts play on the harnesses that do run commands, the way opencode/lich.js
// does: same transport, same payloads, same rule — outside lich it is a no-op,
// and it never blocks or fails the user's turn.
//
// Every event name and context method used here was measured against omp
// v17.3.0 (@oh-my-pi/pi-coding-agent), against a stub listener, not read off
// its documentation. 17.x moves fast: re-measure before trusting a name that is
// not in this file.
//
// The transport below is a copy of opencode/lich.js's, not an import of it.
// Each client is a single file dropped into its harness's own directory, with
// no package around it to resolve a shared module from — so the duplication is
// the packaging, not an oversight.

// Fire and forget. Nothing here is awaited: omp awaits its extension handlers,
// so a slow or dead listener would sit in front of the agent's next step. The
// environment is read per report rather than at import, so a module loaded
// outside lich stays a no-op instead of a cached decision.
function report(path, body) {
  const port = process.env.LICH_PORT
  const token = process.env.LICH_TOKEN
  const session = process.env.LICH_SESSION_ID
  if (!port || !token || !session) return
  try {
    fetch(`http://127.0.0.1:${port}/${path}?token=${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: session, ...body }),
      signal: AbortSignal.timeout(1000),
    }).catch(() => {})
  } catch {}
}

function inLich() {
  return Boolean(process.env.LICH_PORT && process.env.LICH_TOKEN && process.env.LICH_SESSION_ID)
}

// The words for what a tool acts on. omp's built-ins name it `path` (read,
// write, edit, glob), `command` (bash) or `pattern` (grep) — those three are
// measured. `filePath` / `query` / `url` follow for the tools omp does not
// define itself: an extension's or an MCP server's, which spell it however
// their author did. A call carrying none of them sends no detail, which the
// contract accepts.
function detailOf(input) {
  if (!input || typeof input !== "object") return undefined
  for (const key of ["path", "command", "pattern", "filePath", "query", "url"]) {
    const value = input[key]
    if (typeof value === "string" && value !== "") return value
  }
  return undefined
}

// The tools that write to disk, so a git-status refresh is worth its cost.
// Mirrors the `Edit|Write|NotebookEdit|Bash` matcher the script harnesses
// register, in omp's own lower-case spelling. Read-only tools (`read`, `grep`,
// `glob`) must stay out: a refresh per read would cost more than the ~3s poll
// it front-runs.
const WRITERS = new Set(["write", "edit", "bash", "notebook"])

// omp catches what a handler throws, but a throwing extension is still a
// visible startup warning and a line in its log. Nothing here is worth either.
const safely = (fn) => (event, ctx) => {
  try {
    fn(event, ctx)
  } catch {}
}

export default function lichPlugin(pi) {
  // Outside lich, nothing is subscribed at all. omp discovers `~/.claude`
  // wholesale, so an install meant for lich is loaded by every omp run on the
  // machine; there is no per-harness registration to gate on. `report` guards
  // itself too — this one just makes sure there is nothing to guard.
  if (!pi || typeof pi.on !== "function" || !inLich()) return

  // The last title sent, so a title that has not changed is not re-sent. lich
  // applies a title only while the card's label is still automatic, so a repeat
  // would be harmless — but it would also be a POST per turn saying nothing.
  let reportedTitle = ""

  // omp generates its session title asynchronously, after a turn: the manager
  // holds it (`getSessionName`) once `setSessionName` has run. So it is read at
  // the end of a turn and at the start of the next — a session whose only turn
  // is its last still reports the title that turn produced, one turn later.
  const reportTitle = (ctx) => {
    const title = ctx?.sessionManager?.getSessionName?.()
    const trimmed = typeof title === "string" ? title.trim() : ""
    if (!trimmed || trimmed === reportedTitle) return
    reportedTitle = trimmed
    report("session-title", { title: trimmed })
  }

  // The session id lich resumes from. It is on the manager rather than in the
  // environment: omp exports nothing about the running session to its own
  // process env, so `ctx` is the only source.
  pi.on(
    "session_start",
    safely((_event, ctx) => {
      const id = ctx?.sessionManager?.getSessionId?.()
      if (typeof id === "string" && id !== "") {
        report("session-start", { provider_session_id: id, provider: "omp" })
      }
    }),
  )

  // The user has sent something: the turn starts here in an interactive
  // session, which is the only kind lich spawns.
  pi.on(
    "input",
    safely(() => report("hook", { state: "busy" })),
  )

  // Every turn passes through here, including the ones no `input` precedes — a
  // continuation, a retry, a print-mode run. It is this contract's equivalent of
  // the `PostToolUse → busy` the script harnesses register: the spinner comes
  // back after anything that cleared it.
  pi.on(
    "turn_start",
    safely((_event, ctx) => {
      report("hook", { state: "busy" })
      reportTitle(ctx)
    }),
  )

  // The tool line on the card. This handler is on the agent's critical path:
  // returning `{block: true}` from it would refuse the call, so it returns
  // nothing, always.
  pi.on(
    "tool_call",
    safely((event) => {
      if (typeof event?.toolName !== "string" || event.toolName === "") return
      report("hook", { state: "busy", tool: event.toolName, detail: detailOf(event.input) })
    }),
  )

  // After the write, not before it: `tool_result` is where the tree has already
  // changed, so the refresh lich runs sees it.
  pi.on(
    "tool_result",
    safely((event) => {
      if (WRITERS.has(event?.toolName)) report("session-touched", {})
    }),
  )

  // The turn settling, which is this contract's `done`. It fires even when the
  // turn ended in a provider error, so the spinner always comes off.
  //
  // Nothing reports `idle`: the event that would say "the CLI has left" is the
  // process exiting with this module inside it. `session_shutdown` fires there,
  // but a report fired and not awaited during shutdown is a report that may not
  // leave — so an omp card holds its last indicator until lich respawns its
  // terminal, like a Codex or an opencode one.
  pi.on(
    "session_stop",
    safely((_event, ctx) => {
      report("hook", { state: "done" })
      reportTitle(ctx)
    }),
  )
}
