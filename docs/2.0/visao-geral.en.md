# 2.0.0 overview

> **Portuguese:** [Visão geral](visao-geral.md)

2.0.0 turns the dashboard from a login-free Node process with JSON on disk into an authenticated TypeScript server with per-workspace data.

## Before (1.x)

- root `.mjs` files, zero npm dependencies
- persistence in `config.json`, `tarefas.json`, `reconhecimentos.json`, `webhook-estado.json`
- anyone who could reach the port could use the whole dashboard
- a single implicit “account”: the process itself

## Now (2.0.0)

| Area | 2.0.0 |
|---|---|
| Language | TypeScript in `src/`, build to `dist/` |
| Runtime | Node.js 22.5+ (`node:sqlite`) |
| Auth | Better Auth, email/password, httpOnly cookie |
| Multi-tenant | organization = workspace |
| Data | SQLite `{N8N_MONITOR_DATA_DIR}/n8n-monitor.sqlite` |
| UI | HTML in `public/` (no frontend bundler) |
| Visible version | `v2.0.0` badge on the top bar and login screens; `GET /api/health` returns `versao` |

## Request flow

```text
request → /api/health or /api/auth? → continue
        → valid cookie? → otherwise login or 401
        → mustChangePassword? → /trocar-senha only
        → activeOrganizationId? → otherwise create/select a workspace
        → Monitor / Tasks / Dashboard / Logs for that workspace
```

Public routes: `GET /api/health`, `/api/auth/*`, `/api/setup`, `/api/setup-status`, `/api/convite/info`, `/api/convite/aceitar`, `/login`, `/setup`, `/aceitar-convite`, theme CSS/JS.

Everything else requires a session.
