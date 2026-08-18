# Architecture

> **Portuguese version:** [Arquitetura](arquitetura.md)

Version **2.0.0**. Guide: [docs/2.0](2.0/README.en.md). 1.0.0 line: [docs/1.0](1.0/README.en.md) · [release](https://github.com/luizrn/n8n-monitor/releases/tag/v1.0.0).

## Overview

The project is a TypeScript HTTP server (Node.js 22) with HTML pages and no frontend bundler. Authentication uses Better Auth; each workspace (organization) isolates configuration, n8n instances, Kuma, tasks, and caches. The process collects data in the background and serves normalized state to the UI.

```text
n8n APIs --+
           +-- collectors -- normalized alerts --+-- Monitor / Tasks
Kuma ------+                                     +-- browser and sound
IANA/RDAP -+                                     +-- external channels
```

| Source | Interval | Cache |
|---|---:|---|
| n8n state — workspace in use | 15s | full snapshot for 8s |
| n8n state — idle workspace | 60s | same |
| Uptime Kuma | 20s | response and monitor selection |
| Schedules | 5min | per instance, served from cache while revalidating |
| Failed execution detail | — | permanent per `executionId`, 500 per instance |
| Workflow list | 5min | per instance, shared by names and schedules |
| RDAP | 24h | per hostname |

A workspace counts as **in use** when an authenticated request touched it within the last 5 minutes. Otherwise it is still collected, just on the long interval — enough to keep alerts and webhooks alive without keeping the n8n API under continuous load.

Collectors prevent overlapping runs at three levels: one collection per workspace, one schedule sweep per instance, and one background cycle at a time. Every open UI tab reads the same snapshot, so additional tabs do not multiply calls to remote APIs.

## Deadlines

No route waits for a collection indefinitely.

| Limit | Value | Effect when exceeded |
|---|---:|---|
| n8n API call | 25s | that call fails |
| Call during a schedule sweep | 8s | that workflow has no executions this round |
| Schedule sweep per instance | 15s | partial result, revalidated in 1min |
| Execution pagination (Dashboard and Logs) | 15s | returns fewer pages, flagged as truncated |
| `GET /api/state` waiting on collection | 20s | returns the previous snapshot with `parcial: true`, or `motivo: "coletando"` |
| Browser request | 25s | `rede.js` aborts and skips the cycle |
| HTTP socket | 45s | server-side safety net |

All tunable per environment: [variables](2.0/variaveis.en.md#timing-knobs).

Each screen keeps at most **one** in-flight request per endpoint (`public/rede.js`). Without it, a `setInterval` over a slow backend piles up requests until the browser's per-origin connection limit is exhausted and the whole page freezes — not just the slow call.

A collection that exceeds its deadline is **not** cancelled: it finishes in the background and fills the cache for the next read.

## Modules

| File | Responsibility |
|---|---|
| `src/server.ts` | HTTP, session gate, and APIs |
| `src/auth.ts` | Better Auth, organizations, and admin |
| `src/db.ts` | SQLite (`node:sqlite`) and app tables |
| `src/persistencia.ts` | per-workspace config/tasks/webhook and legacy JSON import |
| `src/coleta.ts` | periodic collector per workspace |
| `src/instancias.ts` | n8n client and caches isolated by `orgId` + instance |
| `src/cron.ts` | schedule parsing and execution comparison |
| `src/alertas.ts` | alert contract and severity |
| `src/uptime.ts` | Prometheus parser and Kuma status |
| `src/rdap.ts` | IANA service discovery and domain expiration |
| `src/tarefas.ts` | statuses, notes, history, and recovery |
| `src/webhook.ts` | deduplication, payloads, retries, and delivery |
| `public/rede.js` | one in-flight request per endpoint, with a deadline |
| `public/toasts.js` | toasts, Notification API, and Web Audio |

## Persistence

The data directory is selected through `N8N_MONITOR_DATA_DIR`, `%LOCALAPPDATA%\n8n-monitor`, or `$HOME/n8n-monitor`. The database is `n8n-monitor.sqlite`.

Better Auth tables (`user`, `session`, `account`, `organization`, `member`, `invitation`) plus app tables keyed by `organization_id`:

| Table | Contents |
|---|---|
| `workspace_config` | language, theme, instances and credentials, notifications, Kuma, and external destinations |
| `workspace_reconhecimentos` | acknowledged magnitude per alert |
| `workspace_tarefas` | tasks and transition history |
| `workspace_webhook` | delivered signatures and latest result per external destination |

On first setup, legacy `config.json`, `tarefas.json`, `reconhecimentos.json`, and `webhook-estado.json` are imported into the initial workspace. Secrets and the local path never appear in `GET /api/config`. They are replaced with markers such as `temChave`, `temToken`, `temUrl`, `temBearer`, `temHeaderValor`, `temEvolutionApiKey`, and `temDiscordUrl`.

Missing acknowledgements and tasks are resolved only when their source responded successfully in the current cycle. An unreachable n8n instance or failed Kuma collection preserves prior state instead of producing a false recovery.

`public/i18n.js` centralizes the `pt-BR`/`en` catalog, translates static and dynamic content, and provides the locale used by dates and numbers. The server validates and persists only these two language codes.

When no alerts are visible, Monitor uses normalized state to show how many active n8n instances are reachable and how many selected Kuma monitors are connected. The n8n **Details** button opens `/logs`; the equivalent Kuma button opens the service inventory inside Monitor.

## Alert contract

```json
{
  "chave": "erro:production:workflow:node",
  "origem": "n8n",
  "nivel": "ruim",
  "tipo": "erro de execução",
  "titulo": "Sync customers",
  "resumo": "Sync customers: 3x error",
  "detalhe": "HTTP Request node · 3 occurrences",
  "mensagem": "HTTP 429",
  "magnitude": 3,
  "instanciaId": "production",
  "instancia": "Production",
  "workflowId": "abc",
  "executionId": "123",
  "link": "https://n8n.example/workflow/abc/executions/123"
}
```

`nivel` is either `ruim` or `atencao`. The anti-spam signature combines severity and magnitude.

## External channels

`config.webhook.destinos[]` stores destinations with a stable ID, name, activation state, mode, and credentials. The dispatcher keeps an independent state machine per ID and adapts the same event for every active destination.

| Mode | Delivery contract |
|---|---|
| HTTP Webhook | public JSON below through `POST`, `PUT`, or `PATCH`; Bearer and one additional header are optional |
| WhatsApp / Evolution API | `POST /message/sendText/{instanceName}`, `apikey` header, and `{ number, textMessage: { text } }` body |
| Discord | webhook request with `wait=true`, `content`, configurable display name, and mentions disabled |

Active destinations run in parallel. Failure, retry, latest result, and deduplication for one destination do not change any other destination. Requests use `Content-Type: application/json` and `User-Agent: n8n-monitor/2.0.0`. Only HTTP Webhook receives the full technical payload; WhatsApp and Discord receive a credential-free text representation.

```json
{
  "version": 1,
  "eventId": "uuid",
  "event": "opened",
  "occurredAt": "2026-08-11T12:00:00.000Z",
  "source": "n8n-monitor",
  "alert": {
    "key": "erro:production:workflow:node",
    "severity": "red",
    "category": "n8n",
    "type": "execution error",
    "title": "Sync customers",
    "summary": "Sync customers: 3x error",
    "detail": "HTTP Request node",
    "message": "HTTP 429",
    "magnitude": 3,
    "instance": { "id": "production", "name": "Production" },
    "url": "https://n8n.example/workflow/abc/executions/123"
  },
  "resolution": null
}
```

Events are `opened`, `worsened`, `resolved`, and `test`. A resolution contains `{ "mode": "automatic" }` or `manual`. Delivery requires HTTP 2xx, uses a 10-second timeout, and tries three times. A failure preserves the prior state for a later retry only on the affected destination. Legacy single-channel configuration is migrated to `destino-1`, including persisted anti-spam state; an empty legacy configuration is discarded.

## APIs

Public routes: `GET /api/health`, `/api/auth/*`, `/api/setup`, `/api/setup-status`, `/login`, `/setup`, `/aceitar-convite`, and theme assets. Everything else requires a session; HTML without a cookie redirects to `/login`; APIs respond `401`.

| Method and route | Purpose |
|---|---|
| `GET /api/health` | process liveness without secrets |
| `GET /api/sessao` | user, workspaces, and active workspace |
| `GET/POST /api/config` | public configuration and partial updates |
| `POST /api/teste` | tests unsaved instance values |
| `GET /api/state` | full snapshot and visible alerts |
| `GET /api/cron` | detailed schedule evaluation |
| `GET /api/uptime` | Kuma, TLS, and domain status |
| `POST /api/uptime/teste` | tests credentials and lists monitors |
| `POST /api/webhook/teste` | sends a test event to a destination identified by `id` |
| `POST /api/reconhecer` | moves an alert to analysis or acknowledges resolution |
| `GET/POST /api/tarefas` | lists and updates tasks |
| `GET /api/dashboard` | aggregates data with an `instancias` filter |
| `GET /api/logs` | filtered, paginated executions |
| `GET /api/execucao` | redacted diagnostics per instance |

## Compatibility

Legacy `baseUrl`/`apiKey` configuration is converted into an instance named `Principal`. n8n IDs are local to an instance and are never used without `instanciaId`.

Uptime Kuma does not provide a stable authenticated REST API for listing monitors. `/metrics` is the primary source; `monitor_uptime_ratio` is optional, and the public-page slug is a fallback for 24-hour uptime.
