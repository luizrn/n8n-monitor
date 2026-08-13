# Deploy

> **Portuguese:** [Deploy](deploy.md)

## Local

```bash
npm install
npm run dev
```

First browser visit: `http://127.0.0.1:8787/setup`. With no users, login redirects to setup.

```bash
npm run build
npm start
```

## Compose

```bash
docker compose up -d --build
curl http://127.0.0.1:8787/api/health
```

The response includes `"versao":"2.0.0"`. Volume `n8n-monitor-data` → `/data`.

## Coolify (or similar)

Dockerfile buildpack, health `GET /api/health` (public), volume `/data`.

Envs: `HOST`, `PORT`, `N8N_MONITOR_DATA_DIR`, `TZ`, `BETTER_AUTH_SECRET` (runtime only, treat as a secret) and `BETTER_AUTH_URL` (public dashboard URL; leave empty on preview).

The image build runs `test:unit`, `test:html`, and `tsc` (not the docs tests, which need root markdown files). `BETTER_AUTH_SECRET` is runtime-only — do not inject it as a build ARG.

After deploy: open `/setup` once, create the admin, then use `/login`. Legacy JSON on the volume, if present, is imported into the first workspace.
