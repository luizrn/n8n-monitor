# Operação

Ajustes de instância que afetam diretamente o que o painel consegue mostrar.

## Retenção: o que limita a conferência de agendamentos

O painel só julga um agendamento no intervalo em que existe execução retida. Logo, **a retenção define até onde ele enxerga**.

| variável | default | efeito |
|---|---|---|
| `EXECUTIONS_DATA_PRUNE` | `true` | liga a poda contínua |
| `EXECUTIONS_DATA_MAX_AGE` | `336` (14 dias) | idade máxima, em horas |
| `EXECUTIONS_DATA_PRUNE_MAX_COUNT` | `10000` | máximo de execuções no banco; `0` = sem limite |
| `EXECUTIONS_DATA_HARD_DELETE_BUFFER` | `1` | horas até o hard delete |

Como dimensionar: divida o teto de contagem pelo seu volume por hora. A 250 execuções/hora, 15.000 dão ~60 horas de histórico — suficiente para conferir jobs de hora em hora e diários, insuficiente para semanais.

**Não suba o teto às cegas.** O que estoura o banco é o tamanho da execução, não a quantidade. Uma execução com laço longo e muito dado pode passar de 60 MB sozinha; guardar 10.000 dessas é centenas de gigabytes. A ordem certa é: primeiro achar e corrigir os fluxos que produzem execuções gigantes (veja abaixo), depois subir a retenção.

Em fluxos de alto volume e baixo valor diagnóstico, `saveDataSuccessExecution: none` por workflow mantém os erros e descarta os sucessos.

## Execuções gigantes e execuções que nunca terminam

Uma execução parada em `running` por horas, sem erro, geralmente não travou — está rastejando. Duas causas, que se somam:

**`$('outroNo').item` dentro de laço.** Resolve o item pareado caminhando o grafo de execução para trás, então o custo cresce junto com o run data acumulado. Num caso real chegou a **4,5 segundos por item** — 22 minutos de CPU num único nó Code. Resolver `$('outroNo').all()` uma vez, fora do laço, elimina o custo.

**`saveExecutionProgress: true`.** Grava o estado inteiro da execução no banco depois de **cada nó**. Com um blob grande e um laço longo, é amplificação de escrita quadrática.

Para achar o culpado sem afogar o terminal:

```bash
node scripts/diag-exec.mjs <id-da-execucao>
```

Ele soma bytes e tempo por nó. O nó com tempo desproporcional ao número de itens é o problema.

> Cuidado ao aumentar o lote de um `splitInBatches` como "otimização". Se o corpo do laço casa dados por item do loop, ou usa um `Wait` como controle de vazão, mudar o lote altera comportamento — não só desempenho.

## Concorrência e banco

| variável | default | observação |
|---|---|---|
| `N8N_CONCURRENCY_PRODUCTION_LIMIT` | desabilitado (`-1`) | limita execuções de produção **em paralelo** |
| `--concurrency` no worker | `10` | jobs simultâneos por worker, em modo fila |
| `DB_POSTGRESDB_POOL_SIZE` | `2` | conexões Postgres em paralelo |

Duas coisas que costumam ser mal entendidas:

**O limite de concorrência não impede o enfileiramento.** A documentação é explícita: as execuções acima do limite ficam na fila e são processadas em FIFO. Contra um fluxo em loop, que gera mais eventos do que consome, ele reduz a velocidade do dano mas não o impede — e um backlog que sobrevive mais tempo que a retenção produz jobs órfãos (`Worker failed to find data for execution N`). Contra loop, o que resolve é corrigir o loop.

**O pool do Postgres tem default 2.** Vinte execuções concorrentes contra duas conexões produz `Driver not Connected` e `Connection terminated` em fluxos que não têm defeito nenhum. Deixe o pool pelo menos do tamanho da concorrência de cada worker, e confira que o `max_connections` do Postgres cobre `workers × pool + main + webhooks`.

## Erros que não são do fluxo

Ao investigar um alerta, descarte primeiro estas causas de infraestrutura:

- **`Worker failed to find data for execution N (job M)`** — job órfão no Redis: a execução foi podada mas o job continuou na fila. Não executa nada e não toca em API externa; é ruído até drenar. Os IDs nesses alertas são bem mais antigos que os atuais, e é assim que se reconhece.
- **429 em vários fluxos ao mesmo tempo** — quase sempre um único fluxo consumindo a cota de um token compartilhado. Olhe o volume por fluxo antes de mexer nos que estão apenas apanhando.
- **`This execution failed to be processed too many times`** — o n8n desistiu de reprocessar. Costuma acompanhar execução gigante ou reinício da instância.

## Variáveis de ambiente exigem reinício

Nenhuma das variáveis acima vale sem reiniciar o n8n. O reinício também mata execuções em andamento, que passam a `crashed` — o que é desejável quando a execução estava presa, e vale antecipar quando não estava.
