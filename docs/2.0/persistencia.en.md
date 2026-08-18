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

Only on **initial setup** (first workspace), the process reads, if present:

- `config.json`
- `tarefas.json`
- `reconhecimentos.json`
- `webhook-estado.json`

and copies them into that `organization_id`. A new workspace starts empty: no instances, Kuma, destinations, or tokens. Legacy JSON is not imported again.

## Collector

Every 15s the collector walks **all** workspaces, refreshes the in-memory snapshot, and dispatches webhooks. Each workspace has its own cadence: 15s while someone is using it, 60s while idle (no authenticated request in the last 5 minutes). A cycle starts only after the previous one finishes.

`GET /api/state` and the other APIs read only the session workspace. The response waits at most 20s for the collection; past that deadline it returns the previous snapshot flagged `parcial: true` — or `{ "ok": false, "motivo": "coletando" }` on a workspace's first read — while the collection finishes in the background.

Tasks and webhook anti-spam state are read from SQLite **once** per workspace, when the runtime is created. From then on memory is the source of truth and every change is written immediately.
