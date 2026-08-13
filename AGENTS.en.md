# AGENTS.md

Read **this entire file** before opening code, docs, or a terminal. Then read [`docs/2.0/README.en.md`](docs/2.0/README.en.md). Only then change files.

> **Português:** [AGENTS.md](AGENTS.md)

This repository is **n8n-monitor 2.0.0**: a monitoring dashboard for n8n and Uptime Kuma. TypeScript server (Node 22.5+), SQLite, Better Auth, HTML pages with no bundler.

## Required order

1. This file.
2. [`docs/2.0/README.en.md`](docs/2.0/README.en.md) (version guide: auth, workspaces, SQLite, envs).
3. The module the task touches under `src/` — never an old `.mjs`; those are gone.
4. Related tests in `test/`. UI in `public/`. Public docs in **pt and en**.

Do not invent a stack. Do not go back to JSON as the source of truth. Do not turn login off.

## What this is (and is not)

- **Is:** native HTTP (`node:http`), ESM (`"type": "module"`), `tsc` → `dist/`, SQLite at `{N8N_MONITOR_DATA_DIR}/n8n-monitor.sqlite` via `node:sqlite`.
- **Is not:** Express/Fastify, React, a frontend bundler, `better-sqlite3`, public signup, a single global tenant.
- **Visible version:** `src/versao.ts` (`VERSAO`), `package.json`, `GET /api/health` (`versao`), `v2.0.0` badge on the top bar and login screens. When bumping the version, change **all** of those plus the changelog.

Intentional runtime dependency: **better-auth**. Do not add a library without a clear technical benefit.

## Layout

```text
src/                 TypeScript server (rootDir)
  server.ts          HTTP, session gate, routes
  auth.ts            Better Auth (email/password, organization, admin)
  contas.ts          setup, members, invites, roles
  db.ts              SQLite + app tables
  persistencia.ts    per-org config/tasks/webhook + legacy JSON import
  workspace.ts       runtime and collector keyed by organization_id
  coleta.ts          n8n/Kuma snapshot per workspace
  versao.ts          VERSAO constant
  *.ts               instancias, cron, alertas, uptime, rdap, tarefas, webhook, seguranca, config, http, tipos
public/              HTML + JS + CSS (no build)
test/*.test.ts       node:test via tsx
docs/2.0/            this version’s guide (pt + .en.md) and env.exemplo
```

Internal imports use the `.js` extension (NodeNext) even though sources are `.ts`.

## Auth and isolation (non-negotiable)

A workspace is a Better Auth **organization**. App data is keyed by `organization_id`. The collector walks every workspace; APIs read only `session.activeOrganizationId`. The n8n client key is `orgId + instanciaId`.

**Public (no session):** `GET /api/health`, `/api/auth/*`, `/api/setup`, `/api/setup-status`, `/api/convite/info`, `/api/convite/aceitar`, `/login`, `/setup`, `/aceitar-convite`, `/trocar-senha`, `theme.js`, `i18n.js`, `toasts.js`, `sessao.js`, `base.css`.

Everything else: HTML without a cookie → `/login`; API → `401`. `mustChangePassword` → `/trocar-senha` only until changed. No active org → `403` `sem-workspace`.

- Public signup stays **off**. Users are created from Settings > Workspace.
- `/api/health` stays public (Coolify). No secrets in it.
- New route: either join the public list **with a reason**, or go through the gate.
- API tests boot the server, call `/api/setup` (or login), and send the cookie.
- Do not mix one workspace’s config/tasks/webhook into another.

## Persistence and secrets

- Source of truth: SQLite. JSON files exist only for **legacy import** on setup.
- `GET /api/config` never returns keys, tokens, secret URLs, or the local path.
- An empty secret field on POST means keep the saved value.
- Do not commit `.env`, `*.sqlite`, execution dumps, or `config.json`.
- Example envs: [`docs/2.0/env.exemplo`](docs/2.0/env.exemplo) and [`docs/2.0/variaveis.en.md`](docs/2.0/variaveis.en.md).
- Production requires `BETTER_AUTH_SECRET` (32+) and `BETTER_AUTH_URL`. Preview must **not** point `BETTER_AUTH_URL` at production.
- This repository is **public**. Do not commit instance FQDNs, panel UUIDs, tokens, or host-specific runbooks.

## Code and UI

- Follow existing identifier style (`chave`, `instanciaId`, `tarefas`).
- `public/i18n.js` is the catalog. New UI copy goes in pt-BR **and** English.
- Public documentation is bilingual.
- Do not reformat unrelated files. Do not recreate `server.mjs`.
- External destination User-Agent: `n8n-monitor/${VERSAO}`.

## Commands

```bash
npm install
npm test                 # all suites
npm run test:unit        # pure functions, no HTTP
npm run test:server      # HTTP + auth + workspaces
npm run test:html        # page syntax + i18n catalog
npm run test:docs        # pt/en documentation pairs
npm run test:file -- test/alertas.test.ts
npm run check
npm run compile          # tsc only
npm run build            # fast tests (unit/html/docs) + tsc
npm run dev
```

`npm run build` runs `test:unit`, `test:html`, and `test:docs`, then `tsc`. The HTTP suite (`test:server`) runs in `npm test` and CI — it is slower because it boots the process.

First browser visit: `/setup` if there are no users. Local: `http://127.0.0.1:8787`.

## Do not

- Talk as if the dashboard had no login.
- Use workflow/execution IDs without `instanciaId`.
- Treat n8n/Kuma unavailability as recovery.
- Log or return secrets.
- Add SMTP because invites exist — invites are copyable links.
- Edit plan files under `.cursor/plans/` unless explicitly asked.
