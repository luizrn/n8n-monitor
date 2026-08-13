# Variáveis de ambiente

> **English:** [Variables](variaveis.en.md)

Arquivo copiável: [env.exemplo](env.exemplo). Não versione `.env` com secrets reais.

## Tabela

| Variável | Obrigatória em produção | Padrão | Uso |
|---|---|---|---|
| `HOST` | não | `127.0.0.1` (Docker: `0.0.0.0`) | interface de escuta |
| `PORT` | não | `8787` | porta HTTP |
| `N8N_MONITOR_DATA_DIR` | não | pasta do usuário / `/data` | SQLite e legado |
| `TZ` | não | do sistema | fuso dos logs |
| `BETTER_AUTH_SECRET` | **sim** (32+ chars) | só em desenvolvimento | assina a sessão |
| `BETTER_AUTH_URL` | recomendada | inferida do pedido | URL pública do painel |
| `N8N_BASE_URL` | não | `http://localhost:5678` | semeia a 1ª instância no import |
| `N8N_API_KEY` | não | vazio | semeia a 1ª chave no import |
| `NODE_ENV` | Docker define `production` | — | exige secret quando `production` |

## Local (Node)

```bash
HOST=127.0.0.1
PORT=8787
TZ=America/Cuiaba
BETTER_AUTH_SECRET=troque-por-32-caracteres-aleatorios-minimo
BETTER_AUTH_URL=http://127.0.0.1:8787
```

Gerar um secret:

```bash
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url')+'\n')"
```

## Docker Compose local

O `compose.yaml` já envia um secret de desenvolvimento e `BETTER_AUTH_URL=http://127.0.0.1:8787`. Troque o secret se alguém além de você alcançar a porta.

## Produção (Coolify / HTTPS)

```bash
HOST=0.0.0.0
PORT=8787
N8N_MONITOR_DATA_DIR=/data
TZ=America/Cuiaba
BETTER_AUTH_SECRET=<32+ caracteres aleatórios>
BETTER_AUTH_URL=https://monitor.exemplo.com
```

No painel, marque `BETTER_AUTH_SECRET` como secret e só runtime. Preview deixa `BETTER_AUTH_URL` vazio para o Better Auth inferir o host do PR.

## Preview

Não aponte `BETTER_AUTH_URL` do preview para a URL de produção: cookies e CSRF quebram. Deixe vazio ou use o FQDN do preview.
