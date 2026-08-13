# Decisões de projeto

> **English version:** [Design decisions](decisions.en.md)

## Confiabilidade antes de volume

Ausência de execução retida não prova que um agendamento falhou. O comparador só julga o período coberto por dados reais e mostra `sem-dados` quando a retenção não permite conclusão.

Uma instância offline também não produz zeros: ela gera alerta vermelho com nome e motivo, enquanto as demais continuam sendo coletadas.

## Identidade inclui instância

Workflow e execução podem repetir IDs em servidores diferentes. Chaves, caches, diagnósticos e links incluem `instanciaId`; fluxos homônimos permanecem separados.

## Anti-spam por ciclo do problema

Polling não é evento. Toast, navegador e som usam a chave estável do problema, persistida em `localStorage`:

- chave nova: avisa uma vez;
- mesma chave ativa: silêncio, inclusive com magnitude maior;
- chave ausente: libera a deduplicação;
- chave que retorna após desaparecer: avisa novamente.

Fechar um toast ou recarregar a página não remove a deduplicação. O som possui ainda cooldown global de oito segundos. Notificação do sistema é silenciosa porque o áudio é controlado separadamente.

Cada destino externo usa estado persistente próprio no servidor e conserva eventos de agravamento por severidade ou magnitude. Isso permite enviar simultaneamente para Webhook, WhatsApp e Discord sem que falha ou deduplicação de um canal interfira nos demais.

## Em análise move, não esconde

Reconhecimento sem fila faria o problema desaparecer da rotina. **Em análise** remove do Monitor e cria uma tarefa com histórico. Recuperação confirmada move a tarefa para Resolvido; recorrência reaparece no Monitor e só reabre a tarefa após nova ação humana.

## Coleta pertence ao servidor

Webhook precisa funcionar sem navegador. Por isso o processo coleta continuamente e as telas apenas leem o snapshot. Esse desenho também evita que cinco abas multipliquem a carga na API do n8n.

## Segredos nunca voltam ao cliente

Campos de senha vazios significam “manter”. Diagnósticos percorrem objetos e redigem nomes associados a token, senha, cookie, autorização e credencial. O webhook recebe apenas o contrato público do alerta.

## Kuma por interfaces públicas

A integração Kuma usa Prometheus com API key e páginas de status públicas para fallback. Socket.IO interno não é consumido porque é acoplado à implementação e exigiria outra biblioteca. A dependência de runtime intencional é o Better Auth.

## Domínio somente com RDAP verificável

O resolvedor usa o bootstrap DNS da IANA e tenta o hostname do monitor até encontrar o domínio registrado. Resultado é armazenado por 24h. Falta de endpoint ou data de expiração é desconhecida, não falha.

## Login e isolamento por workspace

Cada tela administrativa exige sessão. Better Auth cobre e-mail/senha, organizations como workspaces e o plugin admin para cadastro interno. Signup público fica desligado; o primeiro usuário nasce em `/setup`. Configuração, tarefas e o coletor são chaveados por `organization_id`.

## Docker não implica exposição pública

O processo escuta `0.0.0.0` dentro do container para permitir o mapeamento, mas o Compose publica em `127.0.0.1`. O painel exige login (Better Auth, workspaces isolados); ainda assim, prefira VPN ou proxy quando o acesso for remoto.

## Limite de execução travada é por fluxo, não único

Existe um limite padrão (30 min) e exceções por fluxo, guardadas como `"<instanciaId>|<workflowId>" -> minutos`. O servidor resolve o limite de cada execução e devolve `limiteMin` junto dela; painel, toasts e destinos de envio julgam todos pelo mesmo número.

**Por quê:** o `Base CX - Contrato BI` leva ~42 minutos em toda execução — 41,4 a 42,4 min em sete rodadas seguidas — e termina em sucesso. Com um limite único de 30 minutos ele acusava travamento a cada rodada. Reconhecer no botão não resolvia: a chave do alerta inclui o id da execução, então cada nova rodada criava um alerta novo.

Um alerta que aparece todo dia no mesmo lugar sem nada de errado é pior que nenhum alerta — ensina o time a ignorar o painel inteiro, inclusive quando ele estiver certo. É a mesma razão pela qual agrupamos erros por causa e pela qual o toast só se manifesta quando algo muda.

A chave junta instância e fluxo porque os ids de workflow do n8n são locais à instância: sem o prefixo, uma exceção criada para um fluxo silenciaria um homônimo de id igual na outra instância.

## Salvar mal é melhor que não salvar

A gravação de configuração escreve num arquivo temporário e renomeia, para que nunca exista um arquivo meio escrito. Quando o `rename` falha, cai para escrita direta.

**Por quê:** em alguns ambientes Windows — pasta redirecionada, sincronização em nuvem, antivírus — o `rename` falha com `EXDEV` mesmo com origem e destino no mesmo diretório. O efeito era traiçoeiro: a resposta da tela vinha da memória e parecia salva, enquanto o disco continuava com o valor antigo. A configuração só se revelava perdida no próximo restart.

Escrita direta tem uma janela em que uma queda deixaria o arquivo incompleto. É um risco menor que perder a configuração silenciosamente.
