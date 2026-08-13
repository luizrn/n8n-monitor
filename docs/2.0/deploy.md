# Deploy

> **English:** [Deploy](deploy.en.md)

## Local

```bash
npm install
npm run dev
```

Primeiro browser: `http://127.0.0.1:8787/setup`. Sem usuários, o login redireciona para o setup.

```bash
npm run build
npm start
```

## Compose

```bash
docker compose up -d --build
curl http://127.0.0.1:8787/api/health
```

A resposta inclui `"versao":"2.0.0"`. Volume `n8n-monitor-data` → `/data`.

## Coolify (ou similar)

Buildpack Dockerfile, health `GET /api/health` (público), volume `/data`.

Envs: `HOST`, `PORT`, `N8N_MONITOR_DATA_DIR`, `TZ`, `BETTER_AUTH_SECRET` (só runtime, trate como secret) e `BETTER_AUTH_URL` (URL pública do painel; no preview deixe vazio).

O build da imagem roda `test:unit`, `test:html` e `tsc` (não os testes de docs, que exigem markdowns da raiz). `BETTER_AUTH_SECRET` é só runtime — não deve ir como ARG de build.

Depois do deploy: abra `/setup` uma vez, crie o admin, depois use `/login`. JSON legado no volume, se existir, entra no primeiro workspace.
