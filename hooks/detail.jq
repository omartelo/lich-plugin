# The agent's own words for what a tool call acts on, read by field rather than
# by tool name: one rule then covers every harness, because a Codex shell call
# arrives as `Bash` carrying the same `command` string Claude Code sends.
#
# Shared, so the two readings of it cannot drift: `report-tool.sh` sends it as
# the `detail` of a busy report, `report-state.sh` as half the `reason` of a
# waiting one. Contract: ../docs/session-state.md.
#
# `apply_patch` is the exception. Codex passes the whole patch as the command,
# so the plain rule would put "*** Begin Patch" on the card; the file the patch
# names is the readable half of it. A patch touching several files shows the
# first, which is the one the eye would land on anyway.
#
# A path is shortened against the session's own directory, because a card is
# 240px wide and both harnesses report absolute ones: a full path fills the line
# with the part every card shares. Outside that directory only the file name is
# left, which at least names the file. Commands are never shortened — a leading
# slash there belongs to a binary, not to a path worth cutting.
#
# Antigravity spells the same two things differently: the session's directory is
# the first of `workspacePaths`, and the arguments are PascalCase under
# `toolCall.args`. Field names only — they join the fallback chain below rather
# than forking it, so a field a harness never sends is a rung it falls straight
# through. Every one of these names was read off a payload from a real turn: the
# step-type enum in the binary is *not* what arrives here (its `MCP_TOOL` is
# `call_mcp_tool` on the wire), so it cannot be used to derive them.
#
# An MCP call is the one that needs a branch rather than a rung. Every server's
# tools arrive as the single tool `call_mcp_tool`, so the name on the card says
# nothing on its own; the server and the tool it called are arguments, and
# together they are the readable half — lich's own tools would otherwise all
# read alike.
(.workspacePaths[0]? // .cwd) as $cwd
| def short: if ($cwd // "") != "" and startswith($cwd + "/") then ltrimstr($cwd + "/")
             elif startswith("/") then sub(".*/"; "")
             else . end;
  (.toolCall.args // .tool_input // {})
| if ((.ToolName? // "") | tostring) != "" then
    ([.ServerName?, .ToolName?] | map(select(type == "string" and . != "")) | join("/"))
  elif ((.CommandLine? // .command? // "") | tostring) != "" then
    ((.CommandLine? // .command) | tostring
     | if startswith("*** Begin Patch")
       then ((capture("\\*\\*\\* (?:Add|Update|Delete) File: (?<p>[^\n]*)") // {}) | .p // "")
       else . end)
  else
    ((.TargetFile? // .AbsolutePath? // .DirectoryPath?
      // .file_path? // .path? // .pattern?
      // .Url? // .url? // .Query? // .query? // "") | tostring | short)
  end
