# AGENTS.md

Leia **este arquivo inteiro** antes de abrir código, docs ou o terminal. Depois leia [`docs/2.0/README.md`](docs/2.0/README.md). Só então mude arquivos.

> **English:** [AGENTS.en.md](AGENTS.en.md)

Este repositório é o **n8n-monitor 2.0.0**: painel de monitoramento para n8n e Uptime Kuma. Servidor TypeScript (Node 22.5+), SQLite, Better Auth, páginas HTML sem bundler.

## Ordem obrigatória

1. Este arquivo.
2. [`docs/2.0/README.md`](docs/2.0/README.md) (guia da versão: auth, workspaces, SQLite, envs).
3. O módulo que a tarefa toca em `src/`, nunca um `.mjs` antigo — eles não existem mais.
4. Testes em `test/` relacionados. UI em `public/`. Docs pt **e** en se a mudança for pública.

Não invente stack. Não volte para JSON como fonte da verdade. Não desligue o login.

## O que é (e o que não é)

- **É:** HTTP nativo (`node:http`), ESM (`"type": "module"`), `tsc` → `dist/`, SQLite em `{N8N_MONITOR_DATA_DIR}/n8n-monitor.sqlite` via `node:sqlite`.
- **Não é:** Express/Fastify, React, bundler de frontend, `better-sqlite3`, signup público, um único tenant global.
- **Versão visível:** `src/versao.ts` (`VERSAO`), `package.json`, `GET /api/health` (`versao`), badge `v2.0.0` no topo e nas telas de login. Se subir versão, altere **todos** esses pontos e o changelog.

Dependência de runtime intencional: **better-auth**. Não adicione biblioteca sem benefício técnico claro.

## Estrutura

```text
src/                 servidor TypeScript (rootDir)
  server.ts          HTTP, gate de sessão, rotas
  auth.ts            Better Auth (email/senha, organization, admin)
  contas.ts          setup, membros, convite, papéis
  db.ts              SQLite + tabelas do app
  persistencia.ts    config/tarefas/webhook por org + import JSON legado
  workspace.ts       runtime e coletor por organization_id
  coleta.ts          snapshot n8n/Kuma por workspace
  versao.ts          constante VERSAO
  *.ts               instancias, cron, alertas, uptime, rdap, tarefas, webhook, seguranca, config, http, tipos
public/              HTML + JS + CSS (sem build)
  index.html         Monitor + Configurações (aba Workspace)
  tarefas.html dashboard.html logs.html
  login.html setup.html aceitar-convite.html trocar-senha.html
  sessao.js i18n.js theme.js toasts.js base.css
test/*.test.ts       node:test via tsx
docs/2.0/            guia desta versão (pt + .en.md) e env.exemplo
docs/                arquitetura, operação, decisões (pt + en)
scripts/             diag-exec.ts, dump-wf.ts
compose.yaml Dockerfile
```

Imports internos usam extensão `.js` (NodeNext), mesmo o fonte sendo `.ts`.

## Auth e isolamento (não negociável)

Workspace = **organization** do Better Auth. Dados do app levam `organization_id`. Coletor percorre todos os workspaces; APIs leem só `session.activeOrganizationId`. Cliente n8n é `orgId + instanciaId`.

**Público (sem sessão):** `GET /api/health`, `/api/auth/*`, `/api/setup`, `/api/setup-status`, `/api/convite/info`, `/api/convite/aceitar`, `/login`, `/setup`, `/aceitar-convite`, `/trocar-senha`, `theme.js`, `i18n.js`, `toasts.js`, `sessao.js`, `base.css`.

Todo o resto: HTML sem cookie → `/login`; API → `401`. `mustChangePassword` → só `/trocar-senha` até trocar. Sem org ativa → `403` `sem-workspace`.

Regras:

- Signup público permanece **desligado**.
- Cadastro de usuário só de dentro (aba Workspace / admin).
- `/api/health` permanece público (Coolify). Não coloque segredos nele.
- Nova rota: ou entra na lista pública **com justificativa**, ou passa pelo gate.
- Teste de API sobe servidor, faz `/api/setup` (ou login) e manda cookie. Não chame `/api/config` sem sessão.
- Não misture config/tarefas/webhook de um workspace em outro.

## Persistência e segredos

- Fonte da verdade: SQLite. JSON (`config.json` etc.) só existe para **import legado** no setup.
- `GET /api/config` nunca devolve chave, token, URL secreta nem caminho local — só marcadores `temChave`, `temToken`, …
- Campo secreto vazio no POST = manter o valor salvo.
- Não versione `.env`, `*.sqlite`, dumps de execução, `config.json`.
- Envs de exemplo: [`docs/2.0/env.exemplo`](docs/2.0/env.exemplo) e [`docs/2.0/variaveis.md`](docs/2.0/variaveis.md).
- Produção exige `BETTER_AUTH_SECRET` (32+) e `BETTER_AUTH_URL` (URL pública). Preview **não** aponta `BETTER_AUTH_URL` para produção.
- Este repositório é **público**. Não versione FQDN de instância, UUID de painel, token, nem runbook de um host específico.

## Código e UI

- Identificadores e comentários no estilo já existente (pt: `chave`, `instanciaId`, `tarefas`, `reconhecer`).
- `public/i18n.js` é o catálogo. Texto novo de interface entra em pt-BR **e** inglês.
- Documentação pública (README, `docs/`, `docs/2.0/`, CHANGELOG, SECURITY, CONTRIBUTING) também em pt **e** en.
- Não reformate arquivo fora da tarefa. Não recrie `server.mjs` nem testes `.mjs`.
- Docker: Node 22 Alpine, `npm ci && npm run build`, `CMD node dist/server.js`, volume `/data`. `.dockerignore` **não** pode excluir `src/` nem `test/` (o build roda os testes).
- User-Agent de destinos externos: `n8n-monitor/${VERSAO}`.

## Comandos

```bash
npm install
npm test                 # todas as suítes
npm run test:unit        # funções puras, sem HTTP
npm run test:server      # HTTP + auth + workspaces
npm run test:html        # sintaxe das páginas + catálogo i18n
npm run test:docs        # pares pt/en da documentação
npm run test:file -- test/alertas.test.ts
npm run check            # tsc --noEmit
npm run compile          # só tsc
npm run build            # testes rápidos (unit/html/docs) + tsc
npm run dev              # tsx src/server.ts
```

`npm run build` executa `test:unit`, `test:html` e `test:docs` e depois o `tsc`. A suíte HTTP (`test:server`) entra em `npm test` e no CI — é mais lenta porque sobe o processo.

Primeiro browser: `/setup` se não houver usuários. Local: `http://127.0.0.1:8787`.

Antes de considerar uma mudança pronta: `npm test` e `npm run check`. Teste de isolamento entre workspaces e 401 sem sessão devem continuar passando se você tocar em auth, persistência ou HTTP.

## O que não fazer

- Expor o painel “só com VPN” como se não houvesse login — o login existe; VPN ainda é recomendada.
- Confiar em IDs de workflow/execução sem `instanciaId`.
- Tratar ausência de dados n8n/Kuma como recuperação (falso positivo).
- Logar ou devolver secret, cookie, API key, `BETTER_AUTH_SECRET`.
- Adicionar SMTP “porque convite existe” — convite é link copiável.
- Alterar o arquivo de plano em `.cursor/plans/` salvo pedido explícito.
