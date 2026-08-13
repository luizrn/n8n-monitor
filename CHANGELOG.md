# Changelog

> **English version:** [Changelog](CHANGELOG.en.md)

Todas as mudanças relevantes serão registradas aqui. O projeto segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e versionamento semântico. A primeira tag estável é **2.0.0**.

## Unreleased

- aba Workspace reorganizada, com campo para renomear o workspace ativo.
- workspace novo não herda config, tokens nem conexões do JSON legado nem de outro workspace.

## [2.0.0] — 2026-08-13

### Adicionado

- múltiplas instâncias n8n com filtros por origem;
- integração Uptime Kuma, TLS e expiração de domínio via RDAP;
- Tarefas em lista e Kanban com recuperação automática;
- notificações do navegador, som e canais contínuos por webhook HTTP, WhatsApp/Evolution API ou Discord;
- múltiplos destinos externos simultâneos, com ativação, teste, resultado e deduplicação independentes;
- interface completa em Português (Brasil) e inglês, selecionável em Configurações;
- documentação técnica e comunitária completa em Português (Brasil) e inglês;
- resumo de conexões n8n/Kuma no estado vazio e acesso direto do bloco N8N aos Logs;
- Docker, Compose e testes automatizados locais;
- documentação e arquivos comunitários para o projeto open source.
- seleção persistente entre tema escuro padrão e tema claro suave.
- login com Better Auth (e-mail/senha), workspaces isolados, cadastro interno e convites copiáveis;
- servidor TypeScript, SQLite em `n8n-monitor.sqlite` e coleta por workspace;
- guia da versão em [`docs/2.0/`](docs/2.0/README.md) e badge `v2.0.0` no painel.

### Alterado

- persistência atômica e privada para todos os arquivos de estado;
- recuperação automática condicionada à confirmação da fonte;
- barras de rolagem alinhadas aos temas claro e escuro;
- Docker Compose endurecido com filesystem somente leitura e privilégios mínimos.
- salvamento das Configurações desacoplado da coleta completa, evitando o botão preso em “Salvando…”.
- painel exige sessão; `GET /api/health` permanece público e devolve `versao`;
- persistência de arquivos JSON para SQLite por `organization_id`.

### Segurança

- signup público desligado; sessão em cookie httpOnly;
- redação de segredos em URLs, mensagens e stacks de diagnóstico;
- validação HTTP/HTTPS, bloqueio de headers reservados e proteção contra prototype pollution;
- APIs de escrita restritas a JSON, com limite de corpo, verificação de origem e erros sem detalhes internos;
- caminhos locais e URLs secretas de webhook removidos das respostas de configuração.
