// Reports an opencode session to lich. Contracts: ../docs/, canonical in
// https://github.com/omartelo/lich/tree/main/docs/hooks
//
// opencode loads a module rather than running a script, so this one file plays
// the part the four hooks/*.sh scripts play on the other harnesses. Same
// transport, same payloads, same rule: outside lich it is a no-op, and it never
// blocks or fails the user's turn.

// Fire and forget. Nothing here is awaited: opencode awaits its hooks, so a
// slow or dead listener would sit in front of the agent's next step. The
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

// The name a card shows under a session's label, and the words for what it acts
// on. opencode's args are per-tool; these are the keys that identify a call.
function detailOf(args) {
  if (!args || typeof args !== "object") return undefined
  for (const key of ["filePath", "command", "pattern", "query", "url", "path"]) {
    const value = args[key]
    if (typeof value === "string" && value !== "") return value
  }
  return undefined
}

// The lich command every tool below shells out to. lich exports it into each
// PTY it spawns, and the contract says to call *that* one rather than whatever
// `lich` resolves to on PATH: a machine running an installed lich beside a
// `task dev` build has two, and only this one belongs to the session.
function lichBin() {
  return process.env.LICH_BIN || "lich"
}

// How long a tool that waits on another session may block. It mirrors the cap
// lich's own MCP server applies (docs/cli.md, mcpMaxWait): the ticket is what
// makes a short wait cheap, so a wait that ends unanswered costs one more tool
// call rather than a call that hangs.
const MAX_WAIT_SECONDS = 90

function waitSeconds(asked) {
  const seconds = Number(asked)
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_WAIT_SECONDS) {
    return MAX_WAIT_SECONDS
  }
  return Math.floor(seconds)
}

// flag builds one optional argument pair, dropping it when the value is empty —
// an empty --project would narrow to a project named "".
function flag(name, value) {
  return typeof value === "string" && value !== "" ? [name, value] : []
}

// runner turns a tool call into a `lich` invocation.
//
// Shelling out rather than posting to the endpoint directly is deliberate. lich
// documents one contract (docs/cli.md) and already implements it twice — the
// command line and the MCP server, both in Go. A third implementation here, in
// another repository, is one an argument change would leave behind silently.
// This way what lives here is the argv, and every refusal, every wording and
// every rule about worktrees and force stays where it is written.
//
// The command's own stderr is the answer on failure: those messages are written
// to be read by an agent — they name what was refused and what to do about it.
function runner($) {
  return async (args) => {
    const result = await $`${lichBin()} ${args}`.nothrow().quiet()
    const stdout = result.stdout?.toString().trim() ?? ""
    if (result.exitCode !== 0) {
      return result.stderr?.toString().trim() || stdout || `lich exited ${result.exitCode}`
    }
    return stdout
  }
}

// lichTools is the other half of this plugin: the reports above tell lich what a
// session is doing, and these let that session act on the ones beside it.
//
// opencode has no way to register an MCP server from a plugin, which is how
// Claude Code and Codex get the same operations — but it does let a plugin
// define tools, so the tools are defined here and the transport disappears.
//
// Two guards, both about not breaking what already works:
//
//   - Nothing is registered outside lich. The module is a no-op there by
//     design, and tools that could only answer "no lich is running" would be
//     that many tools in every unrelated opencode session's prompt.
//   - The helper is imported at run time, inside a try. It resolves from
//     opencode's own plugin dependencies, and a plugin dropped somewhere they
//     do not reach would otherwise fail at import — taking the reports, which
//     need nothing, down with the tools.
// helper is the injection seam the suite uses: opencode's package resolves from
// its own plugin dependencies, which a checkout of this repository does not
// have, and the argv these tools build is worth testing without it. It is
// reached through LichPlugin's own second argument rather than exported,
// because opencode loads *every* export of a plugin module as a plugin: a
// second export would be called with a plugin input and its return value read
// for hook keys, which took the server down when it was null.
async function lichTools($, helper) {
  if (!$ || !process.env.LICH_PORT || !process.env.LICH_TOKEN || !process.env.LICH_SESSION_ID) {
    return null
  }
  let tool = helper
  if (!tool) {
    try {
      ;({ tool } = await import("@opencode-ai/plugin"))
    } catch {
      return null
    }
  }
  if (typeof tool !== "function" || !tool.schema) return null

  const s = tool.schema
  const run = runner($)
  const session = s.string().describe("The session, by the label on its card or the name it answers to.")
  const project = s.string().optional().describe("Project to narrow to, when the same label exists in more than one.")

  return {
    list_sessions: tool({
      description:
        "The lich sessions you can give work to right now, as JSON. Each carries the label on " +
        "its card and the name it answers to; either addresses it.",
      args: {},
      execute: () => run(["sessions", "--json"]),
    }),

    send_to_session: tool({
      description:
        "Give a task to another lich session and wait for its agent to answer. The answer comes " +
        "back as that agent wrote it. If the wait runs out the task is still delivered and you " +
        "get a ticket to pick the answer up with — carry on and it arrives at your own prompt.",
      args: {
        session,
        prompt: s.string().describe("What to ask that session's agent to do."),
        project,
        timeout_seconds: s.number().optional().describe("Seconds to wait. Capped at 90."),
      },
      execute: (args) =>
        run([
          "send",
          ...flag("--project", args.project),
          "--timeout",
          String(waitSeconds(args.timeout_seconds)),
          args.session,
          args.prompt,
        ]),
    }),

    wait_for_answer: tool({
      description: "Wait again on a ticket an earlier send handed back.",
      args: {
        ticket: s.string().describe("The ticket from a previous send."),
        timeout_seconds: s.number().optional().describe("Seconds to wait. Capped at 90."),
      },
      execute: (args) =>
        run(["wait", "--timeout", String(waitSeconds(args.timeout_seconds)), args.ticket]),
    }),

    reply_to_session: tool({
      description:
        "Answer a task another session sent you. A relayed task names the ticket to use, and " +
        "that ticket is the only way back: whoever asked is blocked on it and reading nothing " +
        "else. Do not answer by messaging a peer session instead.",
      args: {
        ticket: s.string().describe("The ticket named in the task you were given."),
        answer: s.string().describe("Your answer, in full."),
      },
      execute: (args) => run(["reply", args.ticket, args.answer]),
    }),

    open_session: tool({
      description:
        "Open a new lich session and start it, so it can be given work with send_to_session. " +
        "Optionally creates a git worktree first and roots the new session in it, which is how " +
        "you give a task its own checkout instead of sharing yours. A branch that is already " +
        "checked out is opened rather than created again.",
      args: {
        project: s.string().optional().describe("Project to open it in. Defaults to your own."),
        kind: s
          .string()
          .optional()
          .describe("What it runs: claude, codex, opencode, omp, crush or shell. Defaults to yours."),
        worktree: s.string().optional().describe("Branch name for the worktree to root it in."),
        base: s.string().optional().describe("Branch the new worktree starts from."),
      },
      execute: (args) =>
        run([
          "open",
          ...flag("--project", args.project),
          ...flag("--kind", args.kind),
          ...flag("--worktree", args.worktree),
          ...flag("--base", args.base),
        ]),
    }),

    close_session: tool({
      description:
        "Close a lich session. Closing the last session in a git worktree decides what happens " +
        "to that checkout, so it needs the worktree argument: keep it on disk (the session is " +
        "parked, and opening that branch again resumes its conversation) or remove it. A " +
        "checkout with uncommitted work is only removed with force, because what that discards " +
        "is in no commit and on no remote — ask the user first. You cannot close your own session.",
      args: {
        session,
        project,
        worktree: s
          .string()
          .optional()
          .describe('Required for a worktree\'s last session: "keep" or "remove".'),
        force: s.boolean().optional().describe("Remove a checkout that still has uncommitted work."),
      },
      execute: (args) =>
        run([
          "close",
          ...flag("--project", args.project),
          ...flag("--worktree", args.worktree),
          ...(args.force === true ? ["--force"] : []),
          args.session,
        ]),
    }),

    rename_session: tool({
      description:
        "Rename a lich session: the name on its card, which is also the name it is addressed " +
        "by. Omit the session to rename your own — the way a card comes to say what the work in " +
        "it is rather than the number it was born with. A name another session in that project " +
        "already holds is refused, because two sessions under one name is the one thing " +
        "send_to_session cannot resolve. The name becomes the user's: the provider's own " +
        "auto-title never overwrites it again.",
      args: {
        label: s.string().describe("The new name for the card."),
        session: s
          .string()
          .optional()
          .describe(
            "Session to rename, by the label on its card or the name it answers to. " +
              "Omit to rename the session you are running in.",
          ),
        project,
      },
      execute: (args) =>
        run([
          "rename",
          ...flag("--project", args.project),
          // The target is positional and optional, so it is dropped rather than
          // sent empty: `lich rename "" x` would look for a session named "",
          // where one argument is the label for the caller's own session.
          ...(typeof args.session === "string" && args.session !== "" ? [args.session] : []),
          args.label,
        ]),
    }),

    list_worktrees: tool({
      description:
        "A project's git worktrees as JSON: what each is called, whether it has uncommitted " +
        "work, and which sessions are open in it. Read it before opening a session on a branch " +
        "and before closing one — the last session in a checkout decides that checkout's fate.",
      args: { project: s.string().optional().describe("Project to list. Defaults to your own.") },
      execute: (args) => run(["worktrees", "--json", ...flag("--project", args.project)]),
    }),
  }
}

// The one export, and it has to stay the one: opencode calls every export of a
// plugin module with a plugin input and reads hook keys off what comes back.
// helper is the suite's seam for the tool package — opencode passes one
// argument, so the second is invisible to it.
export const LichPlugin = async ({ $ } = {}, helper) => {
  // A sub-session (the `task` tool) reports its own status and would answer for
  // the card: its `idle` is a sub-agent finishing, not the turn ending. They are
  // known by the parentID their session events carry.
  const subSessions = new Set()
  // The title opencode gives a session at creation is a placeholder built from
  // the timestamp. Holding it is what tells a real title apart from it later,
  // without matching on its wording.
  const bornTitles = new Map()

  const tools = await lichTools($, helper)

  const track = (properties) => {
    const info = properties?.info
    if (!info?.id) return
    if (info.parentID) {
      subSessions.add(info.id)
      return
    }
    if (!bornTitles.has(info.id)) bornTitles.set(info.id, info.title ?? "")
  }

  return {
    event: async ({ event }) => {
      const properties = event?.properties ?? event?.data ?? {}

      switch (event?.type) {
        case "session.created": {
          track(properties)
          const id = properties.info?.id ?? properties.sessionID
          if (id && !subSessions.has(id)) {
            report("session-start", { provider_session_id: id, provider: "opencode" })
          }
          return
        }
        case "session.updated": {
          track(properties)
          const info = properties.info
          if (!info?.id || subSessions.has(info.id)) return
          const title = typeof info.title === "string" ? info.title.trim() : ""
          if (title && title !== bornTitles.get(info.id)) report("session-title", { title })
          return
        }
        case "session.status": {
          if (subSessions.has(properties.sessionID)) return
          // opencode's `idle` is the turn ending, which is lich's `done`.
          // lich's own `idle` means the CLI has left, which nothing here can
          // report — the plugin dies with the server that would say it.
          const type = properties.status?.type
          if (type === "idle") report("hook", { state: "done" })
          else if (type === "busy" || type === "retry") report("hook", { state: "busy" })
          return
        }
        case "file.edited":
          report("session-touched", {})
          return
        default:
          // Anything opencode *asked* the user is "your turn": a permission and
          // a question today, each in two spellings (`permission.asked`,
          // `question.asked`, and their `.v2.` variants). Matched by suffix
          // rather than by name because opencode's event catalogue is not
          // exhaustive — its server emits types its own schema does not list —
          // and a prompt whose name is not here would leave the card silent,
          // which is the failure this line exists for. A surplus bell costs the
          // next status report, which follows a reply within ~100ms; a missing
          // one costs the user the session.
          if (event?.type?.endsWith(".asked") && !subSessions.has(properties.sessionID)) {
            report("hook", { state: "waiting" })
          }
      }
    },

    // The tool line on the card. `file.edited` above already covers the touched
    // report, so this one only decorates the state.
    "tool.execute.before": async (input, output) => {
      if (!input?.tool || subSessions.has(input.sessionID)) return
      report("hook", { state: "busy", tool: input.tool, detail: detailOf(output?.args) })
    },

    // Absent outside lich, and absent when the helper cannot be imported: the
    // reports above must work in both cases (see lichTools).
    ...(tools ? { tool: tools } : {}),
  }
}
