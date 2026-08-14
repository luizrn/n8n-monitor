# n8n-monitor 1.0.0

> **English:** [1.0.0 guide](README.en.md)

Esta pasta descreve a linha **1.0.0** (processo Node em `.mjs`, persistência em JSON, sem login). O código atual em `main` é a **[2.0.0](../2.0/README.md)**.

- Release: [v1.0.0](https://github.com/luizrn/n8n-monitor/releases/tag/v1.0.0)
- README atual (2.0.0): [raiz do repositório](../../README.md)

## O que era a 1.0.0

Painel unificado para n8n e Uptime Kuma, sem autenticação de usuário. Quem alcançava a porta via o painel. Estado em arquivos JSON no disco (`config.json`, `tarefas.json`, `reconhecimentos.json`, `webhook-estado.json`). Um único ambiente por processo.

## Funcionalidades da 1.0.0

| | Recurso |
|---|---|
| 🚨 | Alertas agrupados por instância, workflow e nó |
| ⏱️ | Execuções travadas (cronômetro e alerta após 30 min) |
| 📅 | Auditoria de Schedule Trigger, Cron e Interval |
| 🏷️ | Múltiplas instâncias n8n |
| ✅ | Resolução automática quando a fonte confirma recuperação |
| 📋 | Tarefas em lista e Kanban |
| 📊 | Dashboard (volume, falhas, taxa, mediana, p95) |
| 🔎 | Logs de execuções |
| 🔔 | Notificação do navegador |
| 🔊 | Som em alerta vermelho |
| 🪝 | Webhook HTTP, WhatsApp/Evolution API e Discord |
| 🟢 | Uptime Kuma (status, uptime, manutenção) |
| 🔐 | Aviso de certificado TLS |
| 🌐 | Expiração de domínio via RDAP |
| 🌍 | Interface pt-BR e inglês |
| 🌓 | Temas claro e escuro |
| 🐳 | Docker e Compose |

Não havia: login, workspaces, SQLite, TypeScript em `src/`, setup inicial nem convites.

## Migração para 2.0.0

Na primeira execução da 2.0.0, o **setup** importa o JSON legado para o primeiro workspace, se os arquivos existirem no diretório de dados. Workspaces criados depois nascem vazios. Guia: [docs/2.0](../2.0/README.md).
