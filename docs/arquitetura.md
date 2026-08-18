# Arquitetura

> **English version:** [Architecture](architecture.en.md)

Versão **2.0.0**. Guia: [docs/2.0](2.0/README.md). Linha 1.0.0: [docs/1.0](1.0/README.md) · [release](https://github.com/luizrn/n8n-monitor/releases/tag/v1.0.0).

## Visão geral

O projeto é um servidor HTTP em TypeScript (Node.js 22) e páginas HTML sem bundler de frontend. Autenticação usa Better Auth; cada workspace (organization) isola configuração, instâncias n8n, Kuma, tarefas e caches. O processo coleta em segundo plano e entrega um estado normalizado às telas.

```text
n8n APIs ─┐
           ├─ coletores ─ alertas normalizados ─┬─ Monitor / Tarefas
Kuma ──────┤                                   ├─ navegador e som
IANA/RDAP ─┘                                   └─ webhook
```

Intervalos:

| Fonte | Intervalo | Cache |
|---|---:|---|
| Estado n8n — workspace em uso | 15s | snapshot completo por 8s |
| Estado n8n — workspace ocioso | 60s | idem |
| Uptime Kuma | 20s | resposta e seleção de monitores |
| Agendamentos | 5min | por instância, servido do cache enquanto revalida |
| Detalhe de execução com erro | — | permanente por `executionId`, 500 por instância |
| Lista de fluxos | 5min | por instância, compartilhada por nomes e agendamentos |
| RDAP | 24h | por hostname |

Um workspace conta como **em uso** quando alguma requisição autenticada tocou nele nos últimos 5 minutos. Fora disso ele continua sendo coletado, só que no ritmo longo — o suficiente para manter alertas e webhooks vivos sem manter a API do n8n sob carga contínua.

O coletor impede execuções concorrentes em três níveis: uma coleta por workspace, uma varredura de agendamentos por instância e um ciclo de fundo por vez. A interface lê o mesmo snapshot e não multiplica chamadas remotas quando há várias abas abertas.

## Prazos

Nenhuma rota espera a coleta indefinidamente.

| Limite | Valor | Efeito ao estourar |
|---|---:|---|
| Chamada à API do n8n | 25s | erro naquela chamada |
| Chamada durante varredura de agendamentos | 8s | o fluxo fica sem execuções nesta rodada |
| Varredura de agendamentos por instância | 15s | resultado parcial, revalidado em 1min |
| Paginação de execuções (Dashboard e Logs) | 15s | devolve menos páginas, marcadas como truncadas |
| Espera de `GET /api/state` pela coleta | 20s | devolve o snapshot anterior com `parcial: true`, ou `motivo: "coletando"` |
| Requisição do navegador | 25s | `rede.js` aborta e pula o ciclo |
| Socket HTTP | 45s | rede de segurança do servidor |

Todos ajustáveis por ambiente: [variáveis](2.0/variaveis.md#ajuste-de-tempos).

Cada tela mantém no máximo **uma** requisição em voo por endpoint (`public/rede.js`). Sem isso, um `setInterval` sobre um backend lento empilha pedidos até estourar o limite de conexões por origem do navegador, e a página inteira congela — não só a chamada lenta.

A coleta que estoura o prazo **não** é cancelada: ela termina em segundo plano e preenche o cache para a próxima leitura.

## Módulos

| Arquivo | Responsabilidade |
|---|---|
| `src/server.ts` | HTTP, gate de sessão e APIs |
| `src/auth.ts` | Better Auth, organizations e admin |
| `src/db.ts` | SQLite (`node:sqlite`) e tabelas do app |
| `src/persistencia.ts` | config/tarefas/webhook por workspace e import JSON legado |
| `src/coleta.ts` | coletor periódico por workspace |
| `src/instancias.ts` | cliente n8n e caches isolados por `orgId` + instância |
| `src/cron.ts` | interpretação e comparação de agendamentos |
| `src/alertas.ts` | contrato e severidade dos alertas |
| `src/uptime.ts` | parser Prometheus e status Kuma |
| `src/rdap.ts` | descoberta do serviço IANA e expiração de domínio |
| `src/tarefas.ts` | estados, notas, histórico e recuperação |
| `src/webhook.ts` | deduplicação, payload, retry e entrega |
| `public/rede.js` | uma requisição em voo por endpoint, com prazo |
| `public/toasts.js` | toast, Notification API e Web Audio |

## Persistência

O diretório é `N8N_MONITOR_DATA_DIR`, `%LOCALAPPDATA%\n8n-monitor` ou `$HOME/n8n-monitor`. O banco é `n8n-monitor.sqlite`.

Tabelas Better Auth (`user`, `session`, `account`, `organization`, `member`, `invitation`) e tabelas do app com `organization_id`:

| Tabela | Conteúdo |
|---|---|
| `workspace_config` | idioma, tema, instâncias e credenciais, notificações, Kuma e webhook |
| `workspace_reconhecimentos` | magnitude reconhecida por alerta |
| `workspace_tarefas` | tarefas e histórico de transições |
| `workspace_webhook` | assinaturas entregues e último resultado por destino externo |

No primeiro setup, `config.json`, `tarefas.json`, `reconhecimentos.json` e `webhook-estado.json` legado são importados para o workspace inicial. Segredos e o caminho local nunca aparecem em `GET /api/config`: são substituídos por marcadores como `temChave`, `temToken`, `temUrl`, `temBearer`, `temHeaderValor`, `temEvolutionApiKey` e `temDiscordUrl`.

Reconhecimentos e tarefas ausentes só são resolvidos quando sua fonte respondeu com sucesso no ciclo atual. Uma instância n8n inalcançável ou uma coleta Kuma com falha preserva o estado anterior em vez de produzir uma recuperação falsa.

`public/i18n.js` centraliza o catálogo `pt-BR`/`en`, aplica traduções a conteúdo estático e dinâmico e fornece o locale de datas e números. O servidor valida e persiste apenas esses dois códigos de idioma.

Quando não há alertas visíveis, o Monitor usa o estado normalizado para exibir quantas instâncias n8n ativas estão alcançáveis e quantos monitores Kuma selecionados estão conectados. O botão **Detalhes** do bloco N8N navega para `/logs`; o botão equivalente do Kuma abre o inventário de serviços no próprio Monitor.

## Contrato de alerta

```json
{
  "chave": "erro:producao:workflow:no",
  "origem": "n8n",
  "nivel": "ruim",
  "tipo": "erro de execução",
  "titulo": "Sincroniza clientes",
  "resumo": "Sincroniza clientes: 3x erro",
  "detalhe": "nó HTTP Request · 3 ocorrências",
  "mensagem": "HTTP 429",
  "magnitude": 3,
  "instanciaId": "producao",
  "instancia": "Produção",
  "workflowId": "abc",
  "executionId": "123",
  "link": "https://n8n.example/workflow/abc/executions/123"
}
```

`nivel` usa `ruim` ou `atencao`. A assinatura anti-spam combina nível e magnitude.

## Canais externos

`config.webhook.destinos[]` contém destinos com ID estável, nome, ativação, modo e credenciais. O dispatcher mantém uma máquina de estados independente por ID e adapta o mesmo evento a cada destino ativo:

| Modo | Contrato de entrega |
|---|---|
| Webhook HTTP | JSON público abaixo via `POST`, `PUT` ou `PATCH`; Bearer e um header adicional são opcionais |
| WhatsApp / Evolution API | `POST /message/sendText/{instanceName}`, header `apikey` e corpo `{ number, textMessage: { text } }` |
| Discord | execução do webhook com `wait=true`, `content`, nome configurável e menções desativadas |

Todos os destinos ativos são processados em paralelo. Falha, retry, último resultado e deduplicação de um destino não alteram os demais. Todas as requisições usam `Content-Type: application/json` e `User-Agent: n8n-monitor/2.0.0`. O payload técnico completo abaixo é enviado somente no modo Webhook HTTP; WhatsApp e Discord recebem uma representação textual sem credenciais.

```json
{
  "version": 1,
  "eventId": "uuid",
  "event": "opened",
  "occurredAt": "2026-08-11T12:00:00.000Z",
  "source": "n8n-monitor",
  "alert": {
    "key": "erro:producao:workflow:no",
    "severity": "red",
    "category": "n8n",
    "type": "erro de execução",
    "title": "Sincroniza clientes",
    "summary": "Sincroniza clientes: 3x erro",
    "detail": "nó HTTP Request",
    "message": "HTTP 429",
    "magnitude": 3,
    "instance": { "id": "producao", "name": "Produção" },
    "url": "https://n8n.example/workflow/abc/executions/123"
  },
  "resolution": null
}
```

Eventos: `opened`, `worsened`, `resolved` e `test`. Resolução inclui `{ "mode": "automatic" }` ou `manual`. Entrega exige HTTP 2xx, tem timeout de 10s e três tentativas. Falha preserva o estado anterior para nova tentativa apenas no destino afetado. Configurações antigas de canal único são migradas para `destino-1`, incluindo o estado antispam persistido.

## APIs

Rotas públicas: `GET /api/health`, `/api/auth/*`, `/api/setup`, `/api/setup-status`, `/login`, `/setup`, `/aceitar-convite` e assets de tema. O restante exige sessão; HTML sem cookie redireciona para `/login`; APIs respondem `401`.

| Método e rota | Função |
|---|---|
| `GET /api/health` | vida do processo, sem segredos |
| `GET /api/sessao` | usuário, workspaces e workspace ativo |
| `GET/POST /api/config` | configuração pública e atualização parcial |
| `POST /api/teste` | testa instância com valores ainda não salvos |
| `GET /api/state` | snapshot completo e alertas visíveis |
| `GET /api/cron` | avaliação detalhada dos agendamentos |
| `GET /api/uptime` | status Kuma, TLS e domínio |
| `POST /api/uptime/teste` | testa credencial e lista monitores |
| `POST /api/webhook/teste` | envia evento de teste para um destino, identificado por `id` |
| `POST /api/reconhecer` | move para análise ou reconhece resolução |
| `GET/POST /api/tarefas` | lista e altera tarefas |
| `GET /api/dashboard` | agregações com filtro `instancias` |
| `GET /api/logs` | execuções filtradas e paginadas |
| `GET /api/execucao` | diagnóstico redigido por instância |

## Compatibilidade

A configuração legada `baseUrl`/`apiKey` é convertida em uma instância chamada `Principal`. IDs n8n são locais à instância e nunca são usados sem `instanciaId`.

O Kuma não oferece uma API REST autenticada estável para listar monitores. `/metrics` é a fonte principal; `monitor_uptime_ratio` é opcional e o slug público serve como fallback de uptime 24h.
