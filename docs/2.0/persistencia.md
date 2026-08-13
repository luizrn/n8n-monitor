# Persistência

> **English:** [Persistence](persistencia.en.md)

O banco é SQLite via `node:sqlite` (DatabaseSync), arquivo:

```text
{N8N_MONITOR_DATA_DIR}/n8n-monitor.sqlite
```

Padrão: `%LOCALAPPDATA%\n8n-monitor` no Windows, `$HOME/n8n-monitor` nos demais, `/data` no Docker.

## Tabelas Better Auth

`user`, `session`, `account`, `organization`, `member`, `invitation`, mais o campo extra `mustChangePassword` no usuário. As migrations rodam na subida (`migrarAuth()`), porque `node:sqlite` não aplica sozinho o schema do Better Auth.

## Tabelas do app (`organization_id`)

| Tabela | Conteúdo |
|---|---|
| `workspace_config` | JSON da config (instâncias, Kuma, webhook, idioma, tema, limites) |
| `workspace_tarefas` | tarefas e histórico |
| `workspace_reconhecimentos` | magnitude reconhecida por alerta |
| `workspace_webhook` | assinaturas entregues e último resultado |
| `legado_importado` | marca se aquele workspace já importou JSON antigo |

## Import legado

Só no **setup inicial** (primeiro workspace), o processo lê, se existirem:

- `config.json`
- `tarefas.json`
- `reconhecimentos.json`
- `webhook-estado.json`

e copia para aquele `organization_id`. Workspace novo nasce vazio: sem instâncias, Kuma, destinos nem tokens. O JSON legado não é reimportado.

## Coletor

A cada ~10s o coletor percorre **todos** os workspaces, atualiza o snapshot em memória e dispara webhooks. `GET /api/state` e o restante das APIs leem só o workspace da sessão.
