# lich

Plugin do Claude Code — hooks.

## Estrutura

```
.claude-plugin/plugin.json   # manifesto do plugin (obrigatório)
hooks/hooks.json             # configuração dos hooks
```

Scripts de hook ficam em `hooks/` e são referenciados no `hooks.json` via
`${CLAUDE_PLUGIN_ROOT}/hooks/<script>`.

## Teste local

```bash
claude --plugin-dir .
```

O hook `SessionStart` de exemplo imprime "plugin lich ativo" no início da sessão.
