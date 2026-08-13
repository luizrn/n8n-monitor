# Persistence

> **Portuguese:** [Persistência](persistencia.md)

The database is SQLite through `node:sqlite` (DatabaseSync), file:

```text
{N8N_MONITOR_DATA_DIR}/n8n-monitor.sqlite
```

Defaults: `%LOCALAPPDATA%\n8n-monitor` on Windows, `$HOME/n8n-monitor` elsewhere, `/data` in Docker.

## Better Auth tables

`user`, `session`, `account`, `organization`, `member`, `invitation`, plus the extra `mustChangePassword` user field. Migrations run on boot (`migrarAuth()`), because `node:sqlite` does not apply Better Auth’s schema by itself.

## App tables (`organization_id`)

| Table | Contents |
|---|---|
| `workspace_config` | config JSON (instances, Kuma, webhook, language, theme, limits) |
| `workspace_tarefas` | tasks and history |
| `workspace_reconhecimentos` | acknowledged magnitude per alert |
| `workspace_webhook` | delivered signatures and latest result |
| `legado_importado` | whether that workspace already imported old JSON |

## Legacy import

On setup (and when creating a still-empty workspace), the process reads, if present:

- `config.json`
- `tarefas.json`
- `reconhecimentos.json`
- `webhook-estado.json`

and copies them into the current `organization_id`. Each workspace imports at most once.

## Collector

About every 10s the collector walks **all** workspaces, refreshes the in-memory snapshot, and dispatches webhooks. `GET /api/state` and the other APIs read only the session workspace.
