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
// Sent as X-Lich-Plugin on every report; bumped at release (CLAUDE.md, Release).
const PLUGIN_VERSION = "0.18.4"

function report(path, body) {
  const port = process.env.LICH_PORT
  const token = process.env.LICH_TOKEN
  const session = process.env.LICH_SESSION_ID
  if (!port || !token || !session) return
  try {
    fetch(`http://127.0.0.1:${port}/${path}?token=${token}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lich-plugin": PLUGIN_VERSION },
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

// What an opencode prompt is blocking on. Read by field, the way detailOf
// above reads a tool call: the four `.asked` events spell it four ways
// (`permission`, the v2 `action`, and a question's own short `header` with its
// full text behind it), and a field rule covers the next one too. A type that
// carries none of them still reports `waiting` with no reason, which is the
// documented degrade rather than a bug.
function reasonOf(properties) {
  const first = properties?.questions?.[0]
  const reason = properties?.permission ?? properties?.action ?? first?.header ?? first?.question
  return typeof reason === "string" && reason.trim() !== "" ? reason : undefined
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

// What a send or wait exits with when it ran as it should: answered, still
// pending under a ticket, or over with no answer coming.
const ERRAND_OUTCOMES = [0, 2, 3]

// flag builds one optional argument pair, dropping it when the value is empty —
// an empty --project would narrow to a project named "".
function flag(name, value) {
  return typeof value === "string" && value !== "" ? [name, value] : []
}

// controlWords is what follows `lich control <session> <action>`: the value,
// then a slash command's arguments. Both are positional, so arguments without a
// value keep the value's place with an empty one instead of taking it.
function controlWords(value, commandArgs) {
  const word = typeof value === "string" ? value : ""
  if (typeof commandArgs === "string" && commandArgs !== "") return [word, commandArgs]
  return word !== "" ? [word] : []
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
//
// `outcomes` lists the exit codes that are a result rather than a failure. A
// send or wait exits 2 when the wait ran out and hands back a ticket, and 3 when
// the errand ended with no answer coming (docs/cli.md in lich); both explain
// themselves on stdout and write nothing on stderr.
function runner($) {
  return async (args, outcomes = [0]) => {
    const result = await $`${lichBin()} ${args}`.nothrow().quiet()
    const stdout = result.stdout?.toString().trim() ?? ""
    if (!outcomes.includes(result.exitCode)) {
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
  // The newer tools word their project the way lich's MCP server does today:
  // either a name or a directory path resolves it.
  const projectByPath = s
    .string()
    .optional()
    .describe("Project to narrow to, by name or by directory path, when the same label exists in more than one.")
  const folderProject = s
    .string()
    .optional()
    .describe("Project the folder is in, by name or by directory path. Defaults to your own.")

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
        private: s
          .boolean()
          .optional()
          .describe(
            "Set this when you are a sub-agent running inside a session rather than the " +
              "session's own agent. The answer is then yours alone: no note announces it at " +
              "the session's prompt, and only wait_for_answer with this ticket returns it.",
          ),
      },
      execute: (args) =>
        run([
          "send",
          ...(args.private === true ? ["--private"] : []),
          ...flag("--project", args.project),
          "--timeout",
          String(waitSeconds(args.timeout_seconds)),
          args.session,
          args.prompt,
        ], ERRAND_OUTCOMES),
    }),

    wait_for_answer: tool({
      description: "Wait again on a ticket an earlier send handed back.",
      args: {
        ticket: s.string().describe("The ticket from a previous send."),
        timeout_seconds: s.number().optional().describe("Seconds to wait. Capped at 90."),
      },
      execute: (args) =>
        run(["wait", "--timeout", String(waitSeconds(args.timeout_seconds)), args.ticket], ERRAND_OUTCOMES),
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

    control_session: tool({
      description:
        "Drive another running Claude Code session in lich: type a prompt into it, stop the " +
        "turn it is running, set the model or reasoning effort its next requests use, or run one " +
        "of its slash commands, such as compact or clear. It waits up to 10 seconds (60 for a " +
        "slash command) for the session to confirm. A result saying delivered, with an id, is " +
        "not a failure: the command still goes through. One the session never took fails, and " +
        "nothing ran. Claude Code sessions only, and never your own. model and effort change " +
        "that session only; the slash commands /model and /effort are refused because Claude " +
        "Code would save them as the user's default for every new session.",
      args: {
        session: s.string().describe("The session to drive, by the label on its card or the name it answers to."),
        action: s.string().describe("One of prompt, abort, model, effort, command."),
        value: s
          .string()
          .optional()
          .describe(
            "prompt: the text (required). model: the model name, or omit to go back to the " +
              "session's own. effort: low, medium, high, xhigh or max, or omit likewise. " +
              "command: the slash command's name, with or without the slash (required). " +
              "abort: omit.",
          ),
        args: s.string().optional().describe("command only: what follows the command's name, as typed."),
        project: projectByPath,
      },
      execute: (args) =>
        run([
          "control",
          ...flag("--project", args.project),
          args.session,
          args.action,
          ...controlWords(args.value, args.args),
        ], ERRAND_OUTCOMES),
    }),

    ask_session: tool({
      description:
        "Ask another running Claude Code session in lich a side question and get its " +
        "answer, without interrupting it: it answers from its own conversation while its turn " +
        "goes on, and neither the question nor the answer enters that conversation. It sees " +
        "the conversation as of its last finished reply, not the step it is taking right now, " +
        "and cannot use tools to find out more. Waits up to 90 seconds; ask for a brief " +
        "answer. Claude Code sessions only, and never your own.",
      args: {
        session: s.string().describe("The session to ask, by the label on its card or the name it answers to."),
        question: s.string().describe("The question."),
        project: projectByPath,
      },
      execute: (args) => run(["ask", ...flag("--project", args.project), args.session, args.question]),
    }),

    list_worktrees: tool({
      description:
        "A project's git worktrees as JSON: what each is called, whether it has uncommitted " +
        "work, and which sessions are open in it. Read it before opening a session on a branch " +
        "and before closing one — the last session in a checkout decides that checkout's fate.",
      args: { project: s.string().optional().describe("Project to list. Defaults to your own.") },
      execute: (args) => run(["worktrees", "--json", ...flag("--project", args.project)]),
    }),

    list_folders: tool({
      description:
        "The sidebar folders of a project: each folder's name and the sessions " +
        "filed under it, by label. A folder groups sessions by the work they are on rather " +
        "than the checkout they live in, and exists only while a session is filed under it. " +
        "Use it before filing a session, to reuse a name exactly: names are matched as " +
        'written, so "apps" beside "Apps" is a second folder.',
      args: { project: s.string().optional().describe("Project to list, by name or by directory path. Defaults to your own.") },
      execute: (args) => run(["folders", "--json", ...flag("--project", args.project)]),
    }),

    file_session: tool({
      description:
        'Move a lich session into a sidebar folder, the window\'s "Move to ' +
        'folder". Omit the session to file your own. A session is in at most one folder, ' +
        "so filing it moves it; a folder no session carries yet starts existing with this " +
        "one in it, and an empty folder takes the session out of the one it is in.",
      args: {
        folder: s
          .string()
          .describe(
            "Folder to file the session under, exactly as list_folders names it, or a new " +
              "name. An empty string takes the session out of its folder.",
          ),
        session: s
          .string()
          .optional()
          .describe(
            "Session to file, by the label on its card or the name it answers to. Omit to " +
              "file the session you are running in.",
          ),
        project: projectByPath,
      },
      // The folder is sent even when empty: "" is what takes the session out.
      // The target is dropped when empty, as rename_session's is.
      execute: (args) =>
        run([
          "file",
          ...flag("--project", args.project),
          ...(typeof args.session === "string" && args.session !== "" ? [args.session] : []),
          args.folder,
        ]),
    }),

    rename_folder: tool({
      description:
        "Rename a sidebar folder across every session filed under it (the " +
        'window\'s "Rename folder"), or, with an empty new name, take it apart: its ' +
        "sessions go back among their checkout's cards. Renaming onto a name the project " +
        "already has merges the two folders. Returns every session that moved.",
      args: {
        folder: s.string().describe("The folder to rename, exactly as list_folders names it."),
        to: s.string().describe("Its new name. An empty string takes the folder apart."),
        project: folderProject,
      },
      execute: (args) => run(["rename-folder", ...flag("--project", args.project), args.folder, args.to]),
    }),

    color_folder: tool({
      description:
        "Paint every session filed under a sidebar folder with one color, the " +
        'window\'s folder "Color", or with an empty color hand them back to the theme. ' +
        "A folder has no color of its own: it shows the one its cards share, so a card " +
        "filed later keeps its own. Returns every session painted.",
      args: {
        folder: s.string().describe("The folder to paint, exactly as list_folders names it."),
        color: s
          .string()
          .describe("One of red, orange, amber, green, teal, blue, violet, pink. An empty string clears it."),
        project: folderProject,
      },
      execute: (args) => run(["color-folder", ...flag("--project", args.project), args.folder, args.color]),
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
            report("hook", { state: "waiting", reason: reasonOf(properties) })
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
