# TypeScript server

> **Portuguese:** [Servidor](servidor.md)

## Layout

```text
src/*.ts     →  tsc  →  dist/*.js
public/      HTML, CSS, JS (no bundler)
test/*.ts    tsx --test
```

Main modules: `server`, `auth`, `db`, `contas`, `workspace`, `coleta`, `persistencia`, `instancias`, `tarefas`, `alertas`, `uptime`, `rdap`, `webhook`, `seguranca`, `versao`.

The `VERSAO` constant in `src/versao.ts` (currently `2.0.0`) appears in `package.json`, `GET /api/health`, `GET /api/sessao`, the UI badge, and the `User-Agent` of external destinations (`n8n-monitor/2.0.0`).

## Scripts

| Command | Purpose |
|---|---|
| `npm install` | dependencies (`better-auth` + TypeScript/`tsx`) |
| `npm run dev` | `tsx src/server.ts` |
| `npm run build` | `tsc` → `dist/` |
| `npm start` | `node dist/server.js` |
| `npm test` | tests |
| `npm run check` | `tsc --noEmit` |
| `npm run diag -- ID` | execution diagnostics |
| `npm run dump -- WORKFLOW_ID` | workflow dump |

## Docker

Multi-stage Node 22 Alpine image: `npm ci && tsc`, `CMD node dist/server.js`, `node` user, `/data` volume, health `GET /api/health`. Compose publishes only `127.0.0.1:8787`.

In production (`NODE_ENV=production`) the secret is required. Local `compose.yaml` already sets a development `BETTER_AUTH_SECRET` — change it if Compose is not loopback-only.
