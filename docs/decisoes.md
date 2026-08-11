# Decisões de projeto

## Confiabilidade antes de volume

Ausência de execução retida não prova que um agendamento falhou. O comparador só julga o período coberto por dados reais e mostra `sem-dados` quando a retenção não permite conclusão.

Uma instância offline também não produz zeros: ela gera alerta vermelho com nome e motivo, enquanto as demais continuam sendo coletadas.

## Identidade inclui instância

Workflow e execução podem repetir IDs em servidores diferentes. Chaves, caches, diagnósticos e links incluem `instanciaId`; fluxos homônimos permanecem separados.

## Anti-spam por mudança

Polling não é evento. Toast, navegador, som e webhook atravessam o mesmo portão:

- chave nova: abre;
- mesma assinatura: silêncio;
- severidade ou magnitude maior: agrava;
- chave ausente: resolve.

O som possui ainda cooldown global de oito segundos. Notificação do sistema é silenciosa porque o áudio é controlado separadamente.

## Em análise move, não esconde

Reconhecimento sem fila faria o problema desaparecer da rotina. **Em análise** remove do Monitor e cria uma tarefa com histórico. Recuperação confirmada move a tarefa para Resolvido; recorrência reaparece no Monitor e só reabre a tarefa após nova ação humana.

## Coleta pertence ao servidor

Webhook precisa funcionar sem navegador. Por isso o processo coleta continuamente e as telas apenas leem o snapshot. Esse desenho também evita que cinco abas multipliquem a carga na API do n8n.

## Segredos nunca voltam ao cliente

Campos de senha vazios significam “manter”. Diagnósticos percorrem objetos e redigem nomes associados a token, senha, cookie, autorização e credencial. O webhook recebe apenas o contrato público do alerta.

## Kuma por interfaces públicas

O projeto permanece sem dependências. A integração usa Prometheus com API key e páginas de status públicas para fallback. Socket.IO interno não é consumido porque é acoplado à implementação e exigiria biblioteca externa.

## Domínio somente com RDAP verificável

O resolvedor usa o bootstrap DNS da IANA e tenta o hostname do monitor até encontrar o domínio registrado. Resultado é armazenado por 24h. Falta de endpoint ou data de expiração é desconhecida, não falha.

## Docker não implica exposição pública

O processo escuta `0.0.0.0` dentro do container para permitir o mapeamento, mas o Compose publica em `127.0.0.1`. O painel não implementa login e deve ficar atrás de VPN ou proxy autenticado.
