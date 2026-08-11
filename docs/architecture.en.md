# Architecture

> **Portuguese version:** [Arquitetura](arquitetura.md)

## Overview

The project is a Node.js HTTP server with four HTML pages and no build step. The process keeps clients and caches isolated by n8n instance, collects data in the background, and serves normalized state to the UI.

```text
n8n APIs --+
           +-- collectors -- normalized alerts --+-- Monitor / Tasks
Kuma ------+                                     +-- browser and sound
IANA/RDAP -+                                     +-- external channels
```

| Source | Interval | Cache |
|---|---:|---|
| n8n state | 10s | full snapshot for 8s |
| Uptime Kuma | 20s | response and monitor selection |
| Schedules | 5min | per instance |
| RDAP | 24h | per hostname |

Collectors prevent overlapping runs. Every open UI tab reads the same snapshot, so additional tabs do not multiply calls to remote APIs.

## Modules

| File | Responsibility |
|---|---|
| `server.mjs` | configuration, HTTP, collection, caches, and diagnostics |
| `instancias.mjs` | n8n client and per-instance caches |
| `cron.mjs` | schedule parsing and execution comparison |
| `alertas.mjs` | alert contract and severity |
| `uptime.mjs` | Prometheus parser and Kuma status |
| `rdap.mjs` | IANA service discovery and domain expiration |
| `tarefas.mjs` | statuses, notes, history, and recovery |
| `webhook.mjs` | deduplication, payloads, retries, and delivery |
| `public/toasts.js` | toasts, Notification API, and Web Audio |

## Persistence

The data directory is selected through `N8N_MONITOR_DATA_DIR`, `%LOCALAPPDATA%\n8n-monitor`, or `$HOME/n8n-monitor`.

| File | Contents |
|---|---|
| `config.json` | language, instances and credentials, notifications, Kuma, and external destinations |
| `reconhecimentos.json` | acknowledged magnitude per alert |
| `tarefas.json` | tasks and transition history |
| `webhook-estado.json` | delivered signatures and latest result per external destination |

Secrets never appear in `GET /api/config`. They are replaced with markers such as `temChave`, `temToken`, `temBearer`, `temHeaderValor`, `temEvolutionApiKey`, and `temDiscordUrl`.

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

Active destinations run in parallel. Failure, retry, latest result, and deduplication for one destination do not change any other destination. Requests use `Content-Type: application/json` and `User-Agent: n8n-monitor/1.0`. Only HTTP Webhook receives the full technical payload; WhatsApp and Discord receive a credential-free text representation.

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

| Method and route | Purpose |
|---|---|
| `GET /api/health` | process liveness without secrets |
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
