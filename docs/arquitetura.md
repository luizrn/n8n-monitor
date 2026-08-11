# Arquitetura

## Visão geral

O projeto é um servidor HTTP em Node.js e quatro páginas HTML sem build. O processo mantém clientes e caches separados por instância n8n, coleta os dados em segundo plano e entrega um estado normalizado às telas.

```text
n8n APIs ─┐
           ├─ coletores ─ alertas normalizados ─┬─ Monitor / Tarefas
Kuma ──────┤                                   ├─ navegador e som
IANA/RDAP ─┘                                   └─ webhook
```

Intervalos:

| Fonte | Intervalo | Cache |
|---|---:|---|
| Estado n8n | 10s | snapshot completo por 8s |
| Uptime Kuma | 20s | resposta e seleção de monitores |
| Agendamentos | 5min | por instância |
| RDAP | 24h | por hostname |

O coletor impede execuções concorrentes. A interface lê o mesmo snapshot e não multiplica chamadas remotas quando há várias abas abertas.

## Módulos

| Arquivo | Responsabilidade |
|---|---|
| `server.mjs` | configuração, HTTP, coleta, caches e diagnóstico |
| `instancias.mjs` | cliente n8n e caches isolados por instância |
| `cron.mjs` | interpretação e comparação de agendamentos |
| `alertas.mjs` | contrato e severidade dos alertas |
| `uptime.mjs` | parser Prometheus e status Kuma |
| `rdap.mjs` | descoberta do serviço IANA e expiração de domínio |
| `tarefas.mjs` | estados, notas, histórico e recuperação |
| `webhook.mjs` | deduplicação, payload, retry e entrega |
| `public/toasts.js` | toast, Notification API e Web Audio |

## Persistência

O diretório é `N8N_MONITOR_DATA_DIR`, `%LOCALAPPDATA%\n8n-monitor` ou `$HOME/n8n-monitor`.

| Arquivo | Conteúdo |
|---|---|
| `config.json` | instâncias e credenciais, notificações, Kuma e webhook |
| `reconhecimentos.json` | magnitude reconhecida por alerta |
| `tarefas.json` | tarefas e histórico de transições |
| `webhook-estado.json` | assinaturas entregues e último resultado por destino externo |

Segredos nunca aparecem em `GET /api/config`: são substituídos por marcadores como `temChave`, `temToken`, `temBearer`, `temHeaderValor`, `temEvolutionApiKey` e `temDiscordUrl`.

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

Todos os destinos ativos são processados em paralelo. Falha, retry, último resultado e deduplicação de um destino não alteram os demais. Todas as requisições usam `Content-Type: application/json` e `User-Agent: n8n-monitor/1.0`. O payload técnico completo abaixo é enviado somente no modo Webhook HTTP; WhatsApp e Discord recebem uma representação textual sem credenciais.

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

| Método e rota | Função |
|---|---|
| `GET /api/health` | vida do processo, sem segredos |
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
