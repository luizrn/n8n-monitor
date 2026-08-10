# Decisões de projeto

Cada item aqui existe porque a alternativa foi tentada e falhou. Estão registrados para que ninguém "simplifique" de volta.

## Nunca inferir falha da ausência de dado

**A regra:** um agendamento só é julgado no intervalo em que existe execução retida como prova. Sem execução no período, o veredito é `sem-dados`, nunca "não executou".

**Por quê:** a primeira versão comparava as ocorrências previstas contra as execuções encontradas nas últimas 24 horas e acusou **9 agendamentos com falha**, incluindo "72 previstas, 6 cumpridas". Era falso. Seis execuções a cada 20 minutos são exatamente 2 horas — o que o banco ainda guardava. O código estava contando como perdido tudo que a retenção havia apagado.

Depois da correção: zero falsos positivos, e cinco agendamentos confirmados em dia com atraso de 17 a 50 segundos.

Um monitor que inventa falha é pior que nenhum monitor: manda o time caçar problema que não existe e ensina a ignorar o alerta. A coluna **verificado** existe justamente para deixar explícito o quanto foi possível conferir.

## A chave nunca chega ao navegador

Todo acesso ao n8n passa pelo servidor local. O endpoint de config responde `temChave: true|false`, jamais o valor.

Isso não é só higiene: é o que permite ter **um único ponto** de redação de segredos. Os workflows deste tipo de instância costumam ter tokens em texto puro nos parâmetros dos nós HTTP, e o botão "copiar diagnóstico" existe para o conteúdo ser colado num chat. Sem redação centralizada, a ferramenta feita para ajudar a depurar vazaria credencial a cada uso.

## Erro agrupado por causa, não por ocorrência

Um fluxo em loop pode falhar centenas de vezes pelo mesmo motivo em minutos. Listar ocorrência por ocorrência esconde os outros problemas atrás de uma parede de linhas idênticas.

O agrupamento é por fluxo + nó + mensagem, com contador e janela de tempo. O detalhe é buscado só para o exemplar mais recente de cada grupo: buscar por ocorrência custaria uma requisição por linha para descobrir sempre a mesma coisa.

## Paginar em vez de confiar no `limit`

A API do n8n limita a 250 resultados por página. A primeira versão pedia 250 e reportava o número como total da hora — exibindo "250 execuções" quando o real era maior. O painel mentia para baixo exatamente quando o volume explodia, que é quando o número importa.

Agora segue o `nextCursor` até cobrir a janela, e quando ainda há páginas mostra `≥` no lugar do número exato. Um teto de leitura declarado é honesto; um teto silencioso não.

## Não é um dashboard

A hierarquia é invertida de propósito: o veredito ocupa o topo em corpo grande, cada problema é um cartão, e tudo que está bem cabe numa linha. Gráfico, tabela de agendamentos e volume por fluxo ficam dobrados.

Sem problema algum, a tela fica praticamente vazia com o topo verde. A informação que interessa a quem olha um monitor é binária — tem algo errado ou não — e ela precisa ser legível a metros de distância.

## O ponto de status é mais vivo que o texto

O ponto de `ATENÇÃO` usa um amarelo saturado; o texto usa um âmbar mais escuro. Não é inconsistência: forma não precisa passar em contraste de leitura, texto precisa. Amarelo puro em texto sobre fundo claro é ilegível.

O estado nunca é comunicado só por cor — sempre há o nome do status ao lado, e a animação respeita `prefers-reduced-motion`.

## Contar a mesma coisa nos dois lugares

A linha de saúde conta erros a partir dos **mesmos grupos** que geram os cartões, não da janela de uma hora. Antes disso, o topo dizia "1 coisa precisa de atenção" enquanto a linha logo abaixo dizia "0 erros na última hora" — porque o cartão vinha do fallback para erros mais antigos.

Estavam ambos certos e o conjunto estava errado. Um painel que se contradiz perde a credibilidade inteira, não só o número divergente.

## Toast alerta mudança, não estado

O painel consulta a API a cada 10 segundos. Um toast por resultado de consulta significaria seis alertas por minuto para um único fluxo quebrado — e um alerta que aparece sozinho seis vezes por minuto é um alerta que se aprende a ignorar.

Por isso o toast tem chave estável e só se manifesta quando algo **muda**:

| situação | o que acontece |
|---|---|
| chave inédita | abre |
| mesma chave, mesma magnitude | silêncio |
| mesma chave, magnitude maior | contador `×N`, tempo reiniciado, pulso |

Silêncio passa a significar "estável" e movimento passa a significar "piorou". É a mesma lógica do agrupamento de erros, aplicada ao tempo em vez de à lista.

A supressão na primeira carga vem do mesmo raciocínio: abrir a página com cinco problemas já visíveis nos cartões e receber cinco toasts é ruído, não informação.

E o mouse sobre o toast congela a contagem. Um alerta que foge antes de ser lido não alertou nada.

## Sem dependências

Node 18+ tem `fetch`. Um avaliador de cron cabe em 150 linhas. Um painel cabe num HTML. Não há build, não há `node_modules`, não há alerta de vulnerabilidade em transitiva de biblioteca de gráfico — para uma ferramenta que existe para ser confiável quando o resto está quebrado, isso é o requisito principal.
