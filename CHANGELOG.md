# Changelog

> **English version:** [Changelog](CHANGELOG.en.md)

Todas as mudanças relevantes serão registradas aqui. O projeto segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e versionamento semântico. A linha atual é **2.0.0**. A linha anterior está no [guia 1.0.0](docs/1.0/README.md) e no [release v1.0.0](https://github.com/luizrn/n8n-monitor/releases/tag/v1.0.0).

## Unreleased

- aba Workspace reorganizada, com campo para renomear o workspace ativo.
- workspace novo não herda config, tokens nem conexões do JSON legado nem de outro workspace.

### Corrigido

- **troca de workspace travando em "Girando manivelas..."**: `GET /api/state` não tinha prazo de resposta. Com um n8n lento, as requisições do painel se acumulavam até esgotar o limite de conexões por origem do navegador e congelar a página inteira, inclusive para quem estava em outro workspace.
- detalhe de execução com erro passa a ser guardado por `executionId`. Antes, até dez execuções eram baixadas com dados completos, em série, a cada ciclo de coleta — o workspace com mais erros era o mais lento.
- varredura de agendamentos ganhou orçamento de 15s e passa a ser servida do cache anterior enquanto revalida. Antes, 40 fluxos em série com timeout de 25s por chamada podiam segurar a resposta por minutos.
- ciclo de coleta não se sobrepõe mais a si mesmo, e a lista de fluxos é compartilhada entre nomes e agendamentos, com trava de chamada em curso.
- tarefas e estado do webhook deixam de ser relidos do SQLite a cada ciclo; a releitura podia descartar uma alteração feita entre a mutação em memória e a gravação.

### Alterado

- coleta de fundo passou de 10s fixos para 15s em workspace em uso e 60s em workspace ocioso (sem requisição autenticada há mais de 5 minutos).
- **Agendamentos** passa a listar apenas fluxos publicados e ativos no n8n, com gatilho de tempo habilitado. O veredito `inativo` deixou de existir; fluxo só de webhook continua fora, e fluxo com webhook e cron continua dentro. Menos ruído na tela e varredura mais curta.
- chamadas à API do n8n durante a varredura de agendamentos usam timeout de 8s em vez de 25s.
- `GET /api/state` pode responder `parcial: true` (snapshot anterior) ou `motivo: "coletando"` em vez de esperar sem limite.
- `PRAGMA busy_timeout = 5000` no SQLite e teto de 45s por socket HTTP.

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
