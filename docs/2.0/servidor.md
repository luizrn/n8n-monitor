# Servidor TypeScript

> **English:** [Server](servidor.en.md)

## Layout

```text
src/*.ts     →  tsc  →  dist/*.js
public/      HTML, CSS, JS (sem bundler)
test/*.ts    tsx --test
```

Módulos principais: `server`, `auth`, `db`, `contas`, `workspace`, `coleta`, `persistencia`, `instancias`, `tarefas`, `alertas`, `uptime`, `rdap`, `webhook`, `seguranca`, `versao`.

A constante `VERSAO` em `src/versao.ts` (hoje `2.0.0`) aparece em `package.json`, `GET /api/health`, `GET /api/sessao`, no badge da UI e no `User-Agent` dos destinos externos (`n8n-monitor/2.0.0`).

## Scripts

| Comando | Uso |
|---|---|
| `npm install` | dependências (`better-auth` + TypeScript/`tsx`) |
| `npm run dev` | `tsx src/server.ts` |
| `npm run build` | `tsc` → `dist/` |
| `npm start` | `node dist/server.js` |
| `npm test` | testes |
| `npm run check` | `tsc --noEmit` |
| `npm run diag -- ID` | diagnóstico de execução |
| `npm run dump -- WORKFLOW_ID` | dump de workflow |

## Docker

Imagem multi-stage Node 22 Alpine: `npm ci && tsc`, `CMD node dist/server.js`, usuário `node`, volume `/data`, health `GET /api/health`. Compose publica só `127.0.0.1:8787`.

Em produção (`NODE_ENV=production`) o secret é obrigatório. O `compose.yaml` local já define um `BETTER_AUTH_SECRET` de desenvolvimento — troque-o se o Compose não for só loopback.
