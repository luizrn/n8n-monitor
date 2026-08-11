# Operação

## Inicialização

Direta:

```bash
npm start
```

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

## Canais externos

Em **Configurações > Webhook**, escolha um modo:

- **Webhook HTTP:** informe URL e método (`POST`, `PUT` ou `PATCH`). Bearer e um par nome/valor de header são opcionais.
- **WhatsApp (Evolution API):** informe URL base, nome da instância, API key e número com país e DDD. O painel usa o endpoint oficial `/message/sendText/{instanceName}`.
- **Discord:** informe a URL de webhook do canal e, opcionalmente, o nome exibido.

Use **Enviar teste** antes de ativar. O destino deve responder HTTP 2xx em até 10 segundos.

Em falha, confira o último resultado na própria aba, logs do processo, DNS, certificado do destino e regras de proxy/firewall. Campos secretos vazios mantêm o valor salvo. O estado persistido impede reenvio de eventos já aceitos.

## Backup

Faça backup do diretório de dados ou do volume Docker:

```bash
docker run --rm -v n8n-monitor_n8n-monitor-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/n8n-monitor-backup.tgz -C /data .
```

O backup contém segredos. Armazene-o criptografado e com acesso restrito.

## Diagnóstico

```bash
npm run check
npm test
node scripts/diag-exec.mjs ID
node scripts/dump-wf.mjs WORKFLOW_ID
```

Erros frequentes:

| Sintoma | Verificação |
|---|---|
| `HTTP 401/403` | chave, expiração e permissão da API |
| `HTTP 404` | URL base sem caminho extra |
| timeout | DNS, proxy, firewall e alcance a partir do host/container |
| números menores | retenção e limite de paginação indicado na tela |
| webhook repetido | permissões de escrita no diretório de dados |
| Kuma sem uptime | métrica indisponível e slug público ausente |

## Segurança

- Não publique a porta sem autenticação externa.
- Não monte o diretório de dados dentro do repositório.
- Revogue imediatamente qualquer chave que apareça em logs ou issue.
- Revise diagnósticos antes de compartilhar, mesmo com redação automática.
- Atualize regularmente Node, a imagem base e o Uptime Kuma.
