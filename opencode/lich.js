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

export const LichPlugin = async () => {
  // A sub-session (the `task` tool) reports its own status and would answer for
  // the card: its `idle` is a sub-agent finishing, not the turn ending. They are
  // known by the parentID their session events carry.
  const subSessions = new Set()
  // The title opencode gives a session at creation is a placeholder built from
  // the timestamp. Holding it is what tells a real title apart from it later,
  // without matching on its wording.
  const bornTitles = new Map()

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
        case "permission.asked": {
          if (subSessions.has(properties.sessionID)) return
          report("hook", { state: "waiting" })
          return
        }
        case "file.edited":
          report("session-touched", {})
          return
      }
    },

    // The tool line on the card. `file.edited` above already covers the touched
    // report, so this one only decorates the state.
    "tool.execute.before": async (input, output) => {
      if (!input?.tool || subSessions.has(input.sessionID)) return
      report("hook", { state: "busy", tool: input.tool, detail: detailOf(output?.args) })
    },
  }
}
