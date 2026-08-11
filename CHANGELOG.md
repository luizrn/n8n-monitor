# Changelog

> **English version:** [Changelog](CHANGELOG.en.md)

Todas as mudanças relevantes serão registradas aqui. O projeto segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e adotará versionamento semântico a partir da primeira tag.

## Unreleased

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

### Alterado

- persistência atômica e privada para todos os arquivos de estado;
- recuperação automática condicionada à confirmação da fonte;
- barras de rolagem alinhadas aos temas claro e escuro;
- Docker Compose endurecido com filesystem somente leitura e privilégios mínimos.

### Segurança

- redação de segredos em URLs, mensagens e stacks de diagnóstico;
- validação HTTP/HTTPS, bloqueio de headers reservados e proteção contra prototype pollution;
- APIs de escrita restritas a JSON, com limite de corpo, verificação de origem e erros sem detalhes internos;
- caminhos locais e URLs secretas de webhook removidos das respostas de configuração.
