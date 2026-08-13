# Visão geral 2.0.0

> **English:** [Overview](visao-geral.en.md)

A 2.0.0 transforma o painel de um processo Node sem login e JSON em disco em um servidor TypeScript autenticado, com dados isolados por workspace.

## Antes (1.x)

- arquivos `.mjs` na raiz, zero dependências npm
- persistência em `config.json`, `tarefas.json`, `reconhecimentos.json`, `webhook-estado.json`
- qualquer um com acesso à porta via o painel inteiro
- uma única “conta” implícita: o processo

## Agora (2.0.0)

| Área | 2.0.0 |
|---|---|
| Linguagem | TypeScript em `src/`, build para `dist/` |
| Runtime | Node.js 22.5+ (`node:sqlite`) |
| Auth | Better Auth, e-mail e senha, cookie httpOnly |
| Multi-tenant | organization = workspace |
| Dados | SQLite `{N8N_MONITOR_DATA_DIR}/n8n-monitor.sqlite` |
| UI | HTML em `public/` (sem bundler de frontend) |
| Versão visível | badge `v2.0.0` no topo e nas telas de login; `GET /api/health` devolve `versao` |

## Fluxo de um pedido

```text
pedido → /api/health ou /api/auth? → segue
       → cookie válido? → senão login ou 401
       → mustChangePassword? → só /trocar-senha
       → activeOrganizationId? → senão criar/escolher workspace
       → Monitor / Tarefas / Dashboard / Logs do workspace
```

Rotas públicas: `GET /api/health`, `/api/auth/*`, `/api/setup`, `/api/setup-status`, `/api/convite/info`, `/api/convite/aceitar`, `/login`, `/setup`, `/aceitar-convite`, CSS/JS de tema.

O restante exige sessão.
