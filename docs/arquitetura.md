# Arquitetura

```
navegador (127.0.0.1:8787)
   │  polling 10s  ─────────►  GET  /api/state       agregado do painel
   │  polling 5min ─────────►  GET  /api/cron        configurado × executou
   │  sob demanda  ─────────►  GET  /api/execucao    diagnóstico redigido
   │                          GET/POST /api/config   sem nunca devolver a chave
   ▼
server.mjs  ── X-N8N-API-KEY ──►  API REST do n8n  /api/v1/{workflows,executions}
   │
   └── %LOCALAPPDATA%\n8n-monitor\config.json   (chave, modo 0600)
```

O navegador **nunca** fala com o n8n. Toda chamada passa pelo servidor local, que é o único lugar onde a chave existe. Isso não é preciosismo: é o que permite abrir o painel sem embutir credencial em página, e o que torna a redação de segredos possível num ponto só.

## Arquivos

| | |
|---|---|
| `server.mjs` | HTTP, config, agregação, redação de segredos, conferência de agendamentos |
| `cron.mjs` | avaliador de cron e comparação previsto × executado |
| `public/index.html` | a interface inteira: HTML, CSS e JS num arquivo, sem build |
| `scripts/watch-n8n.ps1` | monitor de linha única para consumo por agente ou log |
| `scripts/diag-exec.mjs` | peso e tempo por nó de uma execução |
| `scripts/dump-wf.mjs` | nós, conexões e código de um workflow |

## Endpoints

### `GET /api/state`

O agregado que alimenta a tela. Chama três consultas em paralelo (todas, erros, em execução), paginando pelo `nextCursor` até cobrir a janela de uma hora.

```jsonc
{
  "ok": true,
  "momento": "2026-08-10T14:34:09.000Z",
  "baseUrl": "https://…",
  "tiles": {
    "errosHora": 0,
    "execucoesHora": 187,
    "rodando": 3,
    "travadas": 1,
    "porMinuto": 3.1,
    "truncado": true      // bateu no teto de leitura: o número real é maior
  },
  "serie": [ { "minuto": "…", "ok": 4, "erro": 0 } ],   // 60 baldes
  "erros": [ /* grupos, ver abaixo */ ],
  "rodando": [ { "id", "fluxo", "workflowId", "inicio", "minutos" } ],
  "porFluxo": [ { "fluxo", "total", "erros" } ],
  "limiteTravadaMin": 30
}
```

Quando não há erro na janela de uma hora, `erros` recai nos últimos erros retidos, mesmo fora dela — é melhor mostrar o último erro conhecido do que uma tela vazia. Por isso a linha de saúde conta a partir dos grupos, não da janela: contar coisas diferentes nos dois lugares fazia o painel se contradizer.

### Agrupamento de erros

```jsonc
{
  "workflowId": "abc", "fluxo": "Sincroniza CX",
  "no": "HTTP Request",                  // nó que falhou
  "mensagem": "The service is receiving too many requests from you",
  "total": 200,                          // ocorrências
  "ids": ["981204", "981203", "…"],      // até 50
  "idExemplo": "981204",                 // de quem o detalhe foi buscado
  "primeiro": "…", "ultimo": "…",
  "detalheOmitido": false
}
```

O detalhe (nó e mensagem) é buscado **só para o exemplar mais recente de cada grupo**, no máximo 10 grupos. Buscar por execução seria uma chamada por ocorrência: 200 erros iguais viravam 200 requisições para descobrir a mesma coisa.

### `GET /api/cron`

Resultado em cache por 2 minutos; `?recarregar=1` força. Ver [decisoes.md](decisoes.md) para a semântica dos vereditos.

```jsonc
{
  "ok": true, "janelaHoras": 24, "toleranciaMin": 5, "fusoPadrao": "America/Cuiaba",
  "linhas": [{
    "fluxo": "…", "workflowId": "…", "no": "Schedule Trigger",
    "regra": "a cada 20 min", "fuso": "America/Cuiaba",
    "ativo": true, "desativado": false,
    "veredito": "ok",              // ok | com-falhas | nunca-executou | sem-dados
                                   // | nao-comparavel | sem-janela | inativo
    "janelaVerificadaHoras": 1.8,  // quanto deu para conferir de fato
    "esperado": 6, "cumpridas": 6, "perdidas": [], "totalPerdidas": 0,
    "extras": 0, "atrasoMedioSeg": 23,
    "ultimoPrevisto": "…", "ultimaExec": "…"
  }]
}
```

### `GET /api/execucao?id=<n>`

Devolve `{ ok, fluxo, diagnostico }`. O `diagnostico` é markdown pronto para colar: fluxo, execução, nó que falhou, mensagem, `httpCode`, parâmetros do nó, contexto da requisição, nós executados e stack — **com credenciais redigidas**.

### `GET|POST /api/config`

`GET` responde `{ baseUrl, temChave, ativo, caminhoConfig }`. Nunca a chave.

`POST` aceita `{ baseUrl?, apiKey?, ativo? }`. **`apiKey` vazio mantém a atual** — é o que permite salvar a URL sem redigitar a chave.

### `POST /api/teste`

Faz uma chamada real ao n8n e responde `{ ok }` ou `{ ok: false, erro }`.

## Avaliador de cron

`cron.mjs` não usa biblioteca. Em vez de calcular a próxima ocorrência, varre a janela **minuto a minuto** e testa cada minuto contra a expressão:

```js
for (let t = inicio; t <= fim; t += 60000)
  if (casaCron(campos, partesNoFuso(new Date(t), tz))) ocorrencias.push(new Date(t))
```

1440 iterações por dia é barato, e a conversão de fuso pelo `Intl.DateTimeFormat` resolve horário de verão sem aritmética de offset — que é onde implementações caseiras normalmente erram.

As opções do Schedule Trigger são traduzidas para cron, para haver um avaliador só:

| opção do nó | cron equivalente |
|---|---|
| `minutes`, intervalo N | `*/N * * * *` |
| `hours`, intervalo N, minuto M | `M */N * * *` |
| `days`, hora H, minuto M | `M H * * *` |
| `weeks`, dias D…, H:M | `M H * * D,…` |
| `months`, dia D, H:M | `M H D * *` |
| `cronExpression` | como está (6 campos → descarta os segundos) |
| `seconds` | não comparável (granularidade fina demais) |

Item de `rule.interval` sem `field` usa `days`, que é o padrão do nó — detalhe que, quando ignorado, classificava a maioria dos agendamentos como "não comparável".
