# Sourced by the report scripts, not run: conversation_id reads a hook payload on
# stdin and prints the provider's id for the conversation that fired it, or
# nothing. Antigravity names it `conversationId`, every other harness
# `session_id`. Prefers jq; falls back to sed so it works on Windows, where jq is
# usually absent but sed (Git Bash) is not.
conversation_id() {
  if command -v jq >/dev/null 2>&1; then
    jq -r '.conversationId // .session_id // empty' 2>/dev/null
  else
    sed -n -e 's/.*"conversationId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
           -e 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1
  fi
}
