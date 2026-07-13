#!/bin/sh
# Reporta estado da sessão ao lich. Contrato: docs/contrato-estado-sessao.md
# Uso: report-state.sh <busy|done>

# Fora do lich (vars ausentes) → no-op. Seguro instalar global.
[ -n "$LICH_PORT" ] && [ -n "$LICH_TOKEN" ] && [ -n "$LICH_SESSION_ID" ] || exit 0

curl -s -o /dev/null --max-time 1 \
  -X POST "http://127.0.0.1:${LICH_PORT}/hook?token=${LICH_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "{\"session_id\":\"${LICH_SESSION_ID}\",\"state\":\"$1\"}" \
  || true

# Nunca trava/falha o turno.
exit 0
