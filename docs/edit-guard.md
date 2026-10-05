# Mod: edit guard

Tells a Claude Code session inside lich that the file it just edited was also
edited, minutes earlier, by another lich session working in the same checkout.
There is no lich contract behind it: the sessions meet in the checkout's git
dir, and nothing is sent to lich.

| client                | Claude Code                                             | Codex               | Antigravity         | opencode            | omp                 | Crush               |
|-----------------------|---------------------------------------------------------|---------------------|---------------------|---------------------|---------------------|---------------------|
| `hooks/edit-guard.js` | mod, registered by `hooks/lich.js`, the `modules` entry | none: no mod system | none: no mod system | none: no mod system | none: no mod system | none: no mod system |

## Why

A general-purpose subagent lich opens ([agent-cards.md](agent-cards.md)) works
in the asking session's checkout by default, so two Claude Code sessions can
edit the same file at once. Each one only sees the other's change when it reads
the file again, and neither knows who made it or that the other may still be at
work on it.

## What Claude Code already does

Measured on Claude Code 2.1.289 (`--model haiku`, a scratch git repository): a
session read four files, another process then changed each of them, and the
session edited them without reading again.

| tool                                          | result                                                                                                                                                                         |
|-----------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `Edit`, `old_string` still in the file        | applied, the other change kept: `The file … has been updated successfully. (note: the file had been modified on disk since you last read it — the edit applied cleanly, but the file contains other changes not in your context. Read it before edits that depend on surrounding content.)` |
| `Edit`, `old_string` changed by the other side | refused: `File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.`                                                  |
| `Write`                                       | refused, same message                                                                                                                                                          |
| `NotebookEdit`                                | refused, same message                                                                                                                                                          |

`MultiEdit` is not a tool in that release. So Claude Code never overwrites a
change it has not read: the guard denies nothing, and only adds who made the
change.

## How it behaves

It hooks `tool.call` on `Edit`, `Write` and `NotebookEdit`, and does nothing
unless `LICH_SESSION_ID` is set.

1. Before the call it asks git for the git dir of the folder holding the file
   (`git -C <folder> rev-parse --absolute-git-dir`, the worktree's own for a
   linked worktree). Outside a repository it stops here.
2. It reads `<git dir>/lich-edits/<hash of the path>`, the marker the last
   session to edit that file left: `{"path", "session", "at"}`, `at` in epoch
   milliseconds.
3. It runs the call. A `deny` from a hook beneath is passed on as it came.
4. When the call succeeded, it writes its own marker over that one.
5. When the marker named a different lich session and is under 10 minutes old,
   the result goes back with one more `context` line, which the model reads
   after the tool's result: the path, the session, the time and how long
   ago, and that `send_to_session` or `lich send` reaches that session. A
   refused call carries the line too, since it explains the refusal.

The line names the session by the label on its card, the name the user and
`lich send` know it by. lich puts no label in a session's environment and no
command tells a session its own, so the marker keeps the id and the label is
looked up when a line is about to be added, never on an edit that gets none:
`$LICH_BIN sessions --json`, two seconds at most, matched on its `id` field
(lich 0.60.0 and later). When the CLI is missing or fails, the session is
gone, or the lich is older and lists no ids, the line names the id
instead.

Ten minutes spans the turn in which the other session made its edit; past that
the work is likely finished and the file as read is the news.

A failure of the guard itself (git, a marker it cannot read or write) is logged
with `$.ui.log`, a dim line in the transcript, and the edit goes on as if the
guard were not there.

## Limits

- It speaks only after the edit. The `context` of a `tool.call` result is read
  with the tool's result; there is no slot to warn before the call runs. The
  refusals above are what keep the edit safe.
- A lich older than 0.60.0 lists no session ids in `lich sessions --json`, so
  there the line names the session by id.
- One marker per file, the last editor's: two other sessions editing the same
  file leave only the newer one's name.
- A file in a folder that does not exist yet is outside any repository to git,
  so a `Write` creating a new folder is not recorded.
- Edits made by `Bash` (`sed -i`, a formatter) are not seen, nor are edits by
  harnesses other than Claude Code, which have no mod system.
- Markers are never cleaned up; each is a few hundred bytes, one per file a
  lich session edited, under the git dir where git ignores it.
