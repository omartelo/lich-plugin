# Hook: session title

Client side of the [session-title contract](https://github.com/omartelo/lich/blob/main/docs/hooks/session-title.md)
— the contract (transport, endpoint, payload, accepted values) is defined in
the lich repository; this plugin only implements it.

Reports Claude Code's auto-generated session title (the `ai-title`) so lich
can name the session card after it. lich only applies it while the card's
label is still automatic, so re-sending on every `Stop` is idempotent.

| Claude Code hook | script            | action                              |
|------------------|-------------------|-------------------------------------|
| `Stop`           | `report-title.sh` | send the transcript's last ai-title |

`POST /session-title` with `{"session_id": $LICH_SESSION_ID, "title": <last
ai-title>}`. The title is extracted from the transcript file
(`transcript_path` on stdin): last line matching `"type":"ai-title"`, field
`aiTitle`.

The `ai-title` format is internal and undocumented — extraction failures are
swallowed and the hook no-ops. Requires `jq`; absent → no-op.
