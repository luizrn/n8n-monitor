# Environment variables

> **Portuguese:** [Variáveis](variaveis.md)

Copy-paste file: [env.exemplo](env.exemplo). Do not commit a `.env` with real secrets.

## Table

| Variable | Required in production | Default | Purpose |
|---|---|---|---|
| `HOST` | no | `127.0.0.1` (Docker: `0.0.0.0`) | listen address |
| `PORT` | no | `8787` | HTTP port |
| `N8N_MONITOR_DATA_DIR` | no | user folder / `/data` | SQLite and legacy files |
| `TZ` | no | system | log timezone |
| `BETTER_AUTH_SECRET` | **yes** (32+ chars) | development only | signs the session |
| `BETTER_AUTH_URL` | recommended | inferred from the request | public dashboard URL |
| `N8N_BASE_URL` | no | `http://localhost:5678` | seeds the first instance on import |
| `N8N_API_KEY` | no | empty | seeds the first key on import |
| `NODE_ENV` | Docker sets `production` | — | requires the secret when `production` |

## Local (Node)

```bash
HOST=127.0.0.1
PORT=8787
TZ=America/Cuiaba
BETTER_AUTH_SECRET=replace-with-at-least-32-random-characters
BETTER_AUTH_URL=http://127.0.0.1:8787
```

Generate a secret:

```bash
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url')+'\n')"
```

## Local Docker Compose

`compose.yaml` already sends a development secret and `BETTER_AUTH_URL=http://127.0.0.1:8787`. Change the secret if anyone else can reach the port.

## Production (Coolify / HTTPS)

```bash
HOST=0.0.0.0
PORT=8787
N8N_MONITOR_DATA_DIR=/data
TZ=America/Cuiaba
BETTER_AUTH_SECRET=<32+ random characters>
BETTER_AUTH_URL=https://monitor.example.com
```

In the panel, mark `BETTER_AUTH_SECRET` as a secret and runtime-only. Preview leaves `BETTER_AUTH_URL` empty so Better Auth infers the PR host.

## Preview

Do not point preview `BETTER_AUTH_URL` at the production URL: cookies and CSRF break. Leave it empty or use the preview FQDN.
