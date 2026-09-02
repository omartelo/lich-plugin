# Hook: session title

Client side of the [session-title contract](https://github.com/omartelo/lich/blob/main/docs/hooks/session-title.md)
— the contract (transport, endpoint, payload, accepted values) is defined in
the lich repository; this plugin only implements it.

Reports the title the agent CLI gives its own session, so lich can name the
session card after it. lich only applies it while the card's label is still
automatic, so re-sending is idempotent.

| script            | action                    | Claude Code hook       | Codex hook             | Antigravity hook         | opencode event    | omp event                    | Crush hook |
|-------------------|---------------------------|------------------------|------------------------|--------------------------|-------------------|------------------------------|------------|
| `report-title.sh` | send the session's title  | `PostToolUse` + `Stop` | `PostToolUse` + `Stop` | `PreInvocation` + `Stop` | `session.updated` | `session_stop`, `turn_start` | —          |

**The turn's end is too late to be the only place.** Claude Code fires its title
call in parallel with the turn's own first model call, so the title is on disk
about three seconds in — while a turn that runs for ten minutes used to show
`Session 3` for all ten, and an interrupted one never got a name at all. Codex
and Antigravity are later still by nothing: their title is the user's own first
message, which exists before the turn does. So the report goes out from the
turn's first event that can carry it, and again at `Stop`.

The in-turn registrations pass **`once`**, and that argument is the whole
difference: the script latches on the first title it gets lich to accept
(an empty `$TMPDIR/lich-title-$LICH_SESSION_ID`) and stops looking. Finding a
title means scanning a transcript that grows all turn — 324ms on a 168MB one —
and the in-turn hook fires on every tool call, so without the latch a fifty-tool
turn would pay that fifty times to learn what it knew after the first. A refusal
does not latch: a title lich did not take is worth looking for again next call.
`Stop` runs without the argument and keeps scanning, which is the path a later
retitle arrives on.

`POST /session-title` with `{"session_id": $LICH_SESSION_ID, "title": <title>}`.
Providers keep the title in the transcript file (`transcript_path` or `transcriptPath` on
stdin), in their own shape — the script reads whichever is there:

- **Claude Code** — the last line matching `"type":"ai-title"`, field
  `aiTitle`. An actual generated title.
- **Codex** — the first `user_message` event, field `payload.message`, first
  line. Codex generates no title: it names a thread after its first user message
  verbatim (`threads.title` in its state database), so this reports the same
  label Codex shows, only trimmed to card size.
- **Antigravity** — the first `USER_INPUT` entry's `content` text, unwrapping
  `<USER_REQUEST>` block tags and keeping the first non-blank line.

All formats are internal and undocumented — extraction failures are swallowed
and the hook no-ops. Requires `jq`; absent → no-op.

Whatever the source, the title is capped at **80 characters** on the way out —
characters, not bytes. The cap is a `jq` slice on the body rather than a
`cut -c`: a hook inherits the harness's locale, and `cut -c` counts bytes under a
C one, which slices a title mid-character and puts a replacement glyph on the
card. Nothing returns non-zero when that happens, so it surfaces only as a
mangled tail — and only on a title long enough to be cut, which is why a title
written in English never shows it.

- **opencode** — no transcript to read: `session.updated` carries the whole
  session, title included, so `opencode/lich.js` forwards it. The title a
  session is created with is a placeholder built from its timestamp, so the
  module keeps that first value and reports only a title that differs from it.
  It arrives more than once per turn, which the idempotence above covers.
- **omp** — no transcript to read either: the title is on the session manager
  every handler is handed, as `ctx.sessionManager.getSessionName()`. omp writes
  it asynchronously after a turn, so the turn that produced it may well settle
  before it exists — which is why `omp/lich.js` reads it at both ends, when a
  turn settles and when the next one starts, and sends it only when it differs
  from the last one sent. A session whose only turn is its last still reports
  its title, one turn late; a session that never gets a second turn reports
  none.
- **Crush** — nothing to report. Its one event, `PreToolUse`, is about the tool;
  a Crush card keeps the name lich gave it.
