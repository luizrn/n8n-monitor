# Operação

> **English version:** [Operations](operations.en.md)

Guia da versão **2.0.0:** [docs/2.0](2.0/README.md). Linha **1.0.0:** [docs/1.0](1.0/README.md) · [release](https://github.com/luizrn/n8n-monitor/releases/tag/v1.0.0).

## Inicialização

Direta:

```bash
npm install
npm run build
npm start
```

No primeiro acesso, abra `/setup` e crie o administrador e o workspace inicial. Em produção, defina `BETTER_AUTH_SECRET` (32+ caracteres) e `BETTER_AUTH_URL`.

Docker:

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:8787/api/health
```

O health check confirma o processo, não testa todas as integrações. O status detalhado aparece no Monitor.

## Configurando o n8n

Crie uma API key em **Settings > n8n API**. Para cada instância, informe nome, URL sem `/api/v1` e chave. O teste consulta um workflow e não salva antes de responder.

Desativar uma instância interrompe a coleta sem apagar sua configuração. Remover a instância mantém tarefas históricas com o nome gravado.

Retenção curta limita Dashboard e auditoria de cron. Ajuste a retenção do n8n conforme o período que deseja observar; o monitor informa a cobertura real.

Sem problemas ativos, o painel mostra **Tudo em ordem** com o resumo das conexões: instâncias n8n ativas e alcançáveis e monitores do Uptime Kuma. Use **Detalhes** no bloco N8N para abrir `/logs` com as execuções coletadas.

## Agendamentos

O bloco **Agendamentos** confere se cada gatilho de tempo rodou quando deveria, dentro da janela configurada.

Entram na conferência apenas os fluxos que podem falhar de verdade:

- fluxo **publicado e ativo** no n8n;
- com nó de gatilho de tempo (`Schedule Trigger`, `Cron` ou `Interval`) **habilitado**.

Ficam de fora fluxo desativado, nó de gatilho desativado e fluxo disparado só por webhook — não há horário previsto para cobrar. Um fluxo com webhook **e** cron entra, avaliado pelo gatilho de tempo.

| Veredito | Significa |
|---|---|
| `ok` | todas as ocorrências previstas foram cumpridas |
| `com-falhas` | rodou, mas perdeu ocorrências na janela |
| `nunca-executou` | havia ocorrências previstas e nenhuma execução casou |
| `sem-dados` | nenhuma execução retida na janela: a retenção não permite concluir |
| `sem-janela` | ainda não há ocorrência vencida além da tolerância |
| `nao-comparavel` | regra que o avaliador não sabe conferir (por exemplo, intervalo em segundos) |

A varredura cobre até 40 fluxos por instância e tem orçamento de 15 segundos. Estourado o orçamento, o resultado sai parcial e é revalidado em 1 minuto em vez dos 5 normais. O painel nunca espera a varredura: enquanto ela roda, ele mostra o resultado anterior.

## Coleta e desempenho

Cada workspace é coletado por conta própria e nenhum espera pelo outro: um n8n lento em um workspace não atrasa a troca nem a leitura dos demais.

- workspace em uso (alguém abriu nos últimos 5 minutos): coleta a cada 15s;
- workspace ocioso: a cada 60s, o suficiente para manter alertas e canais externos.

`GET /api/state` espera no máximo 20 segundos pela coleta. Passado esse prazo ele devolve o snapshot anterior, e a coleta termina em segundo plano. Na primeira leitura de um workspace, quando ainda não existe snapshot, o topo mostra **coletando** até a primeira coleta concluir — normalmente no próximo ciclo.

## Uptime Kuma

Crie uma API key com acesso a `/metrics` e informe a URL base. Ao abrir Configurações, o painel usa a credencial salva para carregar a lista automaticamente; cada item indica **No Monitor** ou **Fora do Monitor** conforme sua seleção. Monitores novos chegam selecionados por padrão. Use **Testar e listar monitores** para retestar após alterar URL, chave ou slug. O slug de página pública é opcional e só serve como fallback de uptime 24h.

Estados:

- DOWN: vermelho;
- PENDING/desconhecido: amarelo;
- MAINTENANCE e pausado: informativos;
- TLS/domínio dentro do limite: amarelo;
- TLS/domínio expirado ou inválido: vermelho.

Falha RDAP não derruba Kuma. TLD sem serviço oficial ou sem data publicada aparece sem prazo.

## Notificações

A permissão do navegador é pedida ao ativar a opção. Se ela foi negada permanentemente, libere o site nas configurações do navegador. A Notification API exige contexto seguro, mas `localhost` é aceito pelos navegadores modernos.

Áudio precisa de gesto do usuário; use **Testar** depois de abrir Configurações. O som toca somente para vermelho e respeita cooldown.

## Idioma

Em **Configurações > Geral**, selecione **Português (Brasil)** ou **English**. O valor é persistido no SQLite do workspace, devolvido por `GET /api/config` e aplicado a Monitor, Configurações, Tarefas, Dashboard, Logs, modais, toasts e notificações do sistema. Datas e números usam o locale correspondente. A preferência também é espelhada no `localStorage` para evitar troca visual durante a navegação.

## Tema

Em **Configurações > Geral**, escolha **Escuro** ou **Claro**. Escuro é o padrão e preserva a identidade visual original; Claro usa uma superfície cinza fria de baixo contraste luminoso. O valor é persistido no SQLite do workspace e espelhado em `localStorage`, sendo aplicado por `public/theme.js` antes do CSS para manter o tema entre Monitor, Tarefas, Dashboard e Logs.

## Canais externos

Em **Configurações > Envio de alertas**, adicione um ou mais destinos. Cada item possui nome, modo, switch, credenciais, botão de teste e último resultado independentes. Destinos ativos recebem o mesmo ciclo de eventos simultaneamente; um destino desativado deixa de receber sem afetar os demais. Ao reativá-lo, alertas ainda abertos são enviados uma vez.

Sem destinos salvos, a aba permanece vazia e mostra somente **Adicionar destino**; nenhuma configuração de exemplo é criada automaticamente. O atalho **Documentação** nas Configurações abre a pasta pública `docs/` no GitHub.

- **Webhook HTTP:** informe URL e método (`POST`, `PUT` ou `PATCH`). Bearer e um par nome/valor de header são opcionais.
- **WhatsApp (Evolution API):** informe URL base, nome da instância, API key e número com país e DDD. O painel usa o endpoint oficial `/message/sendText/{instanceName}`.
- **Discord:** informe a URL de webhook do canal e, opcionalmente, o nome exibido.

Use **Enviar teste** em cada item antes de ativá-lo. O destino deve responder HTTP 2xx em até 10 segundos. Remover um item apaga sua configuração no próximo salvamento; deixar um campo secreto vazio preserva o valor daquele destino.

Em falha, confira o resultado do item, logs do processo, DNS, certificado do destino e regras de proxy/firewall. Cada destino mantém deduplicação própria: a falha de um canal não faz outro repetir eventos já aceitos.

## Backup

Use `npm run backup`, que grava uma cópia consistente com `VACUUM INTO` sem parar o painel:

```bash
npm run backup                             # grava no diretório de dados, com carimbo de data
npm run backup -- /caminho/copia.sqlite
```

No Docker:

```bash
docker compose exec monitor node dist/backup.js /data/copia.sqlite
docker compose cp monitor:/data/copia.sqlite ./copia.sqlite
```

**Nao** use `tar` no diretório de dados com o processo rodando. O SQLite opera em modo WAL: o arquivo principal, o `-wal` e o `-shm` seriam copiados em instantes diferentes, e o resultado pode sair rasgado — o que só se descobre na hora de restaurar. Com o processo **parado**, o `tar` é seguro:

```bash
docker compose stop monitor
docker run --rm -v n8n-monitor_n8n-monitor-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/n8n-monitor-backup.tgz -C /data .
docker compose start monitor
```

Restaurar é copiar o arquivo de volta para `n8n-monitor.sqlite` com o painel parado.

O backup contém segredos. Armazene-o criptografado e com acesso restrito.

## Diagnóstico

```bash
npm run check
npm test
npm run diag -- ID
npm run dump -- WORKFLOW_ID
```

No Windows, os scripts usam `N8N_API_KEY` do ambiente ou do registro do usuário. Em Linux/macOS, exporte `N8N_API_KEY` e, quando necessário, `N8N_BASE_URL`. A saída aplica a mesma redação automática de segredos do painel.

Erros frequentes:

| Sintoma | Verificação |
|---|---|
| `HTTP 401/403` | chave, expiração e permissão da API |
| `HTTP 404` | URL base sem caminho extra |
| timeout | DNS, proxy, firewall e alcance a partir do host/container |
| números menores | retenção e limite de paginação indicado na tela |
| topo preso em **coletando** | primeira coleta do workspace em andamento; se persistir, veja alcance e latência do n8n |
| **Agendamentos** com menos linhas que o esperado | fluxo despublicado no n8n, nó de gatilho desativado ou fluxo só de webhook |
| webhook repetido | permissões de escrita no diretório de dados |
| Kuma sem uptime | métrica indisponível e slug público ausente |

## Login e workspaces

O painel bloqueia Monitor, Tarefas, Dashboard, Logs e as APIs sem sessão. `GET /api/health` permanece público para o health check do Coolify.

Cadastro público está desligado. O primeiro usuário nasce em `/setup`. Depois, em **Configurações > Workspace**, um admin cria workspaces, cadastra usuários (com opção de exigir troca de senha no primeiro login) ou gera um link de convite copiável.

## Segurança

- O painel exige login; ainda assim, prefira VPN ou proxy para acesso remoto.
- As rotas de escrita aceitam somente `Content-Type: application/json`, limitam o corpo a 1 MB e recusam origens de navegador diferentes do host do painel.
- URLs configuradas aceitam apenas HTTP/HTTPS e não podem conter usuário ou senha embutidos. Headers reservados não podem ser sobrescritos por destinos HTTP.
- Configuração, tarefas, reconhecimentos e deduplicação ficam no SQLite por workspace. A API não expõe o caminho do host.
- Uma tarefa ou reconhecimento só é limpo quando a fonte respondeu e confirmou que o alerta desapareceu. Indisponibilidade do n8n ou Kuma não conta como recuperação.
- URLs de webhook HTTP e Discord, tokens e chaves nunca retornam em `GET /api/config`; campo secreto vazio preserva o valor salvo.
- Não monte o diretório de dados dentro do repositório.
- Revogue imediatamente qualquer chave que apareça em logs ou issue.
- Revise diagnósticos antes de compartilhar, mesmo com redação automática.
- Atualize regularmente Node, a imagem base e o Uptime Kuma.

O `compose.yaml` remove capabilities Linux, bloqueia elevação de privilégio e usa filesystem somente leitura, exceto pelo volume `/data` e o `tmpfs` de `/tmp`.
