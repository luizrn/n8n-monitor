# n8n-monitor

Painel de alerta para instâncias n8n. Não é um dashboard de análise: a ideia é bater o olho e saber se tem algo errado.

Responde três perguntas que o n8n não responde bem sozinho:

1. **Alguma coisa falhou agora?** — erros agrupados por causa, com diagnóstico pronto para colar.
2. **Alguma execução ficou presa?** — cronômetro vivo, alerta acima de 30 minutos.
3. **Os agendamentos rodaram como configurado?** — ocorrências previstas pelo Schedule Trigger cruzadas com as execuções reais.

Zero dependências. Node puro, um arquivo HTML.

---

## Como subir

```bash
git clone <url-deste-repo> && cd n8n-monitor
node server.mjs
```

Abre em `http://127.0.0.1:8787`. Escuta **apenas** em `127.0.0.1`.

Na primeira vez, clique em **Configuração** e informe a URL da sua instância e a chave da API (Settings → n8n API no n8n). Ou defina antes de subir:

```bash
# variável de ambiente do usuário (Windows)
setx N8N_BASE_URL "https://n8n.suaempresa.com"
setx N8N_API_KEY  "<sua-chave>"
```

O servidor semeia a chave a partir dessas variáveis na primeira execução. Em Windows ele também lê a variável direto do registro do usuário, porque `setx` não afeta processos já em execução.

## Onde a chave fica

**Nunca no navegador e nunca no repositório.** Ela é gravada em:

```
%LOCALAPPDATA%\n8n-monitor\config.json      (Windows)
$HOME/n8n-monitor/config.json               (outros)
```

com permissão `0600`. O endpoint `GET /api/config` responde apenas `temChave: true|false` — o valor nunca sai do servidor. O campo na tela de configuração vem sempre vazio; deixar vazio mantém a chave atual.

O diagnóstico que o botão **Copiar** gera passa por uma **redação automática de credenciais**: qualquer chave contendo `token`, `apikey`, `secret`, `senha`, `password`, `authorization`, `cookie`, `bearer` ou `credential` sai como `[REDIGIDO]`, e o mesmo vale para o par `{name: "token", value: "..."}` que o n8n usa em parâmetros de nós HTTP. Sem isso, colar o diagnóstico num chat vazaria os tokens que estão em texto puro dentro dos workflows.

## Três páginas

| rota | para quê |
|---|---|
| `/` | **Monitor** — bater o olho e saber se tem algo errado agora |
| `/dashboard` | **Dashboard** — volume, taxa de erro e duração ao longo do tempo |
| `/logs` | **Logs** — buscar uma execução específica |

Cada uma cabe numa tela, sem rolagem de página. Compartilham `public/base.css`; nenhuma tem build, framework ou dependência.

### Monitor

**Status no topo** — cor e nome, pulsando:

| | |
|---|---|
| 🟢 `TUDO OK` | nada errado |
| 🟡 `ATENÇÃO` | execução travada, agendamento perdendo ocorrências |
| 🔴 `ERRO` | erro de execução, agendamento que não rodou |
| 🔴 `N8N OFFLINE` | painel no ar, instância inalcançável |
| ⚫ `PAUSADO` | coleta suspensa |

**Cartões de problema** — um por causa, não um por ocorrência. Um fluxo que falhou 200 vezes pelo mesmo motivo é **uma** linha com `×200` e a janela de tempo. Cada cartão traz o nó que falhou, a mensagem, um botão que copia o diagnóstico completo e o link para o n8n.

**Linha de saúde** — tudo que está bem cabe em uma linha.

**À direita**: números da última hora, execuções por minuto, o que está rodando com cronômetro vivo e o resumo dos agendamentos. A tabela completa abre em modal, para não custar altura.

### Dashboard

Períodos de 1h a 7d. Traz execuções, erros, taxa de erro, fluxos ativos e duração mediana e p95; o gráfico de volume ao longo do tempo; e três recortes — **maior volume**, **mais falhas** e **mais lentos (p95)**.

Quando a retenção não cobre o período pedido, um aviso diz quantas horas o banco realmente guarda. Pedir 7 dias não cria histórico que já foi podado, e o painel prefere avisar a desenhar um gráfico enganoso.

O botão **Copiar resumo** gera um relatório em markdown do período inteiro.

### Logs

Busca instantânea por nome do fluxo ou número da execução — o servidor filtra sobre um cache curto, então não há chamada remota a cada tecla. Filtros de status, modo e período aparecem como botões **com o contador do que cada clique vai produzir**.

Clicar numa linha abre o diagnóstico completo daquela execução, com credenciais redigidas e pronto para copiar. `/` foca a busca, `Esc` limpa.

## Agendamentos: configurado × executou

Lê a configuração de cada `Schedule Trigger` (também os nós legados `Cron` e `Interval`), calcula as ocorrências previstas **no fuso do próprio workflow** e cruza com as execuções reais, com tolerância de atraso configurável.

O avaliador de cron é próprio, sem biblioteca: aceita 5 e 6 campos, listas, faixas, passos e o comportamento OU entre dia-do-mês e dia-da-semana. Ele varre a janela minuto a minuto e converte fuso pelo `Intl`, então horário de verão sai correto de graça.

**Uma ressalva que importa:** cada linha só é julgada no intervalo em que existe execução retida como prova. Se o n8n já podou o histórico, o veredito é `sem execução retida`, nunca "falhou". Leia [docs/decisoes.md](docs/decisoes.md#nunca-inferir-falha-da-ausência-de-dado) para o porquê — essa regra nasceu de um erro real.

## Monitor em background

Além do painel, há um script que emite uma linha por evento — feito para ser consumido por um agente ou redirecionado para um log:

```powershell
pwsh -File scripts/watch-n8n.ps1
```

```
ERRO 981204 | Sincroniza CX | 2026-08-10T14:02:11Z | https://.../executions/981204
TRAVADA 980390 | Base de clientes CX | rodando ha 149 min | https://.../executions/980390
```

## Utilitários de diagnóstico

```bash
node scripts/diag-exec.mjs <id-da-execucao>    # peso e tempo por nó, sem imprimir os dados
node scripts/dump-wf.mjs <id-do-workflow> [nó...]  # nós, conexões e o código dos nós escolhidos
```

O `diag-exec` existe para achar o nó culpado numa execução grande sem afogar o terminal: ele soma bytes e tempo **por nó**. O nó com tempo desproporcional ao número de itens é o problema. Foi assim que encontramos uma execução de 64 MB gastando 4,5 s por item.

## Documentação

- [docs/arquitetura.md](docs/arquitetura.md) — como funciona, endpoints, formato dos dados
- [docs/decisoes.md](docs/decisoes.md) — por que é assim, e os erros que moldaram o desenho
- [docs/operacao.md](docs/operacao.md) — retenção, concorrência e os ajustes de instância que o painel assume

## Requisitos

- Node 18+ (usa `fetch` nativo)
- Uma chave de API do n8n com permissão de leitura de workflows e execuções
- PowerShell 7+ apenas para `scripts/watch-n8n.ps1` e para a leitura da chave no registro do Windows
