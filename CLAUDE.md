# lich-plugin

Plugin do Claude Code para comunicação com o **lich** — harness que orquestra sessões do `claude`. O plugin implementa apenas hooks que reportam o estado da sessão ao lich via HTTP loopback.

## Estrutura

```
.claude-plugin/plugin.json   # manifesto do plugin
hooks/hooks.json             # registro dos hooks
hooks/                       # scripts dos hooks (${CLAUDE_PLUGIN_ROOT}/hooks/<script>)
docs/                        # contratos de comunicação lich ⇄ plugin
```

## Contratos

Todo hook implementado aqui segue um contrato documentado em `docs/`. Antes de criar ou alterar um hook, leia o contrato correspondente:

- [docs/contrato-estado-sessao.md](docs/contrato-estado-sessao.md) — reporte de estado (`busy`/`done`) via `UserPromptSubmit`/`Stop`

## Regras

- Hooks nunca podem travar ou falhar o turno do usuário: timeout curto, erros engolidos, sempre exit 0.
- Fora do lich (env vars ausentes) todo hook é no-op com exit 0 — o plugin deve ser seguro para instalação global.

## Teste local

```bash
claude --plugin-dir .
```
