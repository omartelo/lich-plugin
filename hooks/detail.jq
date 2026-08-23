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
# than forking it. The names are the ones the CLI binary carries; a field it
# never sends is a rung the chain falls straight through.
(.workspacePaths[0]? // .cwd) as $cwd
| def short: if ($cwd // "") != "" and startswith($cwd + "/") then ltrimstr($cwd + "/")
             elif startswith("/") then sub(".*/"; "")
             else . end;
  (.toolCall.args // .tool_input // {})
| if ((.CommandLine? // .command? // "") | tostring) != "" then
    ((.CommandLine? // .command) | tostring
     | if startswith("*** Begin Patch")
       then ((capture("\\*\\*\\* (?:Add|Update|Delete) File: (?<p>[^\n]*)") // {}) | .p // "")
       else . end)
  else
    ((.TargetFile? // .FilePath? // .AbsolutePath? // .NotebookPath? // .DirectoryPath?
      // .SearchPath? // .SearchDirectory? // .file_path? // .path?
      // .Url? // .url? // .Query? // .query? // .pattern? // "") | tostring | short)
  end
