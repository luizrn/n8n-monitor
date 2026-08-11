# n8n-monitor

> **English version:** [Read the project README in English.](README.en.md)

[![MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node 20+](https://img.shields.io/badge/node-20%2B-339933.svg)](https://nodejs.org/)

<img width="1621" height="760" alt="Monitor unificado para n8n e Uptime Kuma" src="https://github.com/user-attachments/assets/c7f639e0-6f10-44f6-8da6-00cf63a49c07" />

**Monitor unificado para n8n + Uptime Kuma.**

O projeto reúne em uma única interface a saúde das automações e a disponibilidade dos serviços. No n8n, detecta erros, execuções travadas e agendamentos perdidos em múltiplas instâncias. No Uptime Kuma, acompanha monitores online e offline, manutenção, tempo de resposta, uptime, certificados TLS e expiração de domínios. Os incidentes das duas fontes aparecem no mesmo Monitor e podem ser tratados em uma fila de Tarefas.

Node.js puro, sem dependências npm, framework ou etapa de build.

## Funcionalidades

| | Recurso | Como funciona |
|---|---|---|
| 🚨 | Alertas agrupados | Agrupa falhas repetidas por instância, workflow e nó, preservando magnitude e diagnóstico. |
| ⏱️ | Execuções travadas | Cronômetro ao vivo e alerta amarelo após 30 minutos. |
| 📅 | Auditoria de agendamentos | Compara Schedule Trigger, Cron e Interval com as execuções realmente retidas pelo n8n. |
| 🏷️ | Múltiplas instâncias | Configuração, cache, links, tags e filtros isolados por instância n8n, com resumo das conexões ativas. |
| ✅ | Resolução automática | Remove o alerta quando uma execução posterior comprova recuperação. |
| 📋 | Tarefas | Move alertas para Lista ou Kanban com seis estados, notas e histórico. |
| 📊 | Dashboard | Volume, falhas, taxa de erro, mediana e p95 para períodos de até sete dias. |
| 🔎 | Logs | Busca e filtros por status, modo, período e instância, com diagnóstico redigido e acesso pelo botão Detalhes do bloco N8N. |
| 🔔 | Notificação do navegador | Avisa mudanças amarelas e vermelhas quando o Monitor está aberto em segundo plano. |
| 🔊 | Som | Toca apenas em alerta vermelho, com volume, teste e cooldown anti-spam. |
| 🪝 | Canais externos | Envia abertura, agravamento e resolução simultaneamente para múltiplos Webhooks HTTP, WhatsApp/Evolution API e Discord. |
| 🟢 | Uptime Kuma | Exibe status, resposta, uptime, manutenção, pausa e monitores selecionáveis. |
| 🔐 | TLS | Avisa certificado próximo do vencimento, expirado ou inválido. |
| 🌐 | Domínios | Consulta expiração por RDAP e ignora TLDs sem fonte confiável. |
| 🐳 | Docker | Imagem não-root, health check, volume persistente, filesystem somente leitura e Compose preso ao loopback. |
| 🧪 | Testes automatizados | `node:test`, smoke test do servidor e verificações de sintaxe executadas localmente. |
| 🌍 | Interface bilíngue | Português (Brasil) e inglês em Monitor, Configurações, Tarefas, Dashboard, Logs, modais e notificações. |
| 🌓 | Temas | Tema escuro padrão e tema claro suave, persistidos e aplicados em todas as telas. |

## Início rápido

### Node.js

```bash
git clone https://github.com/luizrn/n8n-monitor.git
cd n8n-monitor
npm start
```

Abra `http://127.0.0.1:8787`, entre em **Configurações**, adicione suas instâncias n8n e conecte o Uptime Kuma pela URL e API key.

### Docker Compose

```bash
docker compose up -d --build
docker compose ps
```

O Compose publica somente `127.0.0.1:8787` e mantém configuração, tarefas e estado no volume `n8n-monitor-data`.

```bash
docker compose logs -f monitor
docker compose down                 # preserva o volume
docker compose down --volumes       # remove também os dados persistidos
```

Não exponha o painel diretamente à internet: ele é uma ferramenta administrativa sem autenticação própria. Use VPN ou proxy autenticado quando precisar de acesso remoto.

## Configuração

As cinco abas ficam no Monitor:

- **Geral:** idioma da interface e tema claro ou escuro, persistidos para todas as telas.
- **Instâncias n8n:** nome, URL, API key, ativação e teste individual.
- **Notificações:** duração do toast de 0 a 600 segundos, navegador, som e volume.
- **Uptime Kuma:** URL, API key, slug público opcional, antecedência e seleção de monitores.
- **Envio de alertas:** lista de destinos Webhook HTTP, WhatsApp/Evolution API e Discord, cada um com nome, ativação, credenciais, teste e último resultado próprios. Vários destinos podem operar simultaneamente. O modo HTTP aceita `POST`, `PUT` ou `PATCH`, Bearer e um header adicional opcional.

A aba **Envio de alertas** começa vazia e só cria um formulário ao clicar em **Adicionar destino**. O atalho **Documentação** abre os guias públicos do projeto no GitHub.

Campos secretos sempre chegam vazios ao navegador. Deixá-los vazios ao salvar preserva o valor atual.

Variáveis disponíveis:

| Variável | Padrão | Uso |
|---|---|---|
| `HOST` | `127.0.0.1` | Interface de rede do servidor. |
| `PORT` | `8787` | Porta HTTP. |
| `N8N_MONITOR_DATA_DIR` | diretório do usuário | Local dos arquivos persistidos. |
| `N8N_BASE_URL` | `http://localhost:5678` | Semeia a primeira instância. |
| `N8N_API_KEY` | vazio | Semeia a chave da primeira instância. |

Dados ficam em `%LOCALAPPDATA%\n8n-monitor` no Windows, `$HOME/n8n-monitor` em outros sistemas ou no diretório definido pela variável. Arquivos sensíveis usam permissão `0600`.

## Rotas

| Rota | Tela |
|---|---|
| `/` | Monitor e Configurações |
| `/tarefas` | Lista e Kanban de pendências |
| `/dashboard` | Métricas históricas |
| `/logs` | Busca de execuções |
| `/api/health` | Health check sem dados sensíveis |

## Semântica dos alertas

Cada problema possui uma chave estável. Toast, notificação do navegador e som são emitidos uma única vez enquanto essa chave estiver ativa, mesmo que a magnitude aumente ou a página seja recarregada. Quando a fonte responde e confirma que o problema desapareceu, a chave é liberada e uma recorrência futura pode avisar novamente; indisponibilidade da fonte não produz recuperação falsa. **Em análise** move o item para Tarefas e o remove do Monitor; **Resolvido** reconhece a magnitude atual.

Cada destino externo mantém uma máquina de estados própria e recebe `opened`, `worsened` e `resolved`. Consulte [docs/arquitetura.md](docs/arquitetura.md) para o schema.

## Desenvolvimento

```bash
npm test
npm run check
npm start
```

Veja [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) e [CHANGELOG.md](CHANGELOG.md).

## Documentação

- [Arquitetura](docs/arquitetura.md): componentes, dados, APIs e payloads.
- [Decisões](docs/decisoes.md): critérios de confiabilidade e anti-spam.
- [Operação](docs/operacao.md): instalação, segurança e troubleshooting.

## Licença

[MIT](LICENSE) © 2026 Luiz Fernando Riva Nekel.
