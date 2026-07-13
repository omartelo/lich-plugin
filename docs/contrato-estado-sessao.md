# Contrato de comunicação lich ⇄ plugin

## Transporte

HTTP loopback. lich injeta no env de todo PTY (herdado pelo `claude` e pelos hooks):

| Var               | Uso                          |
|-------------------|------------------------------|
| `LICH_PORT`       | porta do endpoint (loopback) |
| `LICH_TOKEN`      | token de auth                |
| `LICH_SESSION_ID` | id da sessão/card alvo       |

## Requisição

```
POST http://127.0.0.1:${LICH_PORT}/hook?token=${LICH_TOKEN}
Content-Type: application/json

{"session_id": "<LICH_SESSION_ID>", "state": "<busy|done>"}
```

Estados: só `busy` e `done`. Backend rejeita outros.

Respostas: `204` ok · `401` token inválido · `400` corpo inválido.

## Mapeamento evento → estado

| Hook               | state  |
|--------------------|--------|
| `UserPromptSubmit` | `busy` |
| `Stop`             | `done` |

## Regras do cliente

- Vars ausentes (fora do lich) → no-op, exit 0. Seguro instalar global.
- Timeout ~1s, erro engolido, sempre exit 0. Nunca trava/falha o turno.
