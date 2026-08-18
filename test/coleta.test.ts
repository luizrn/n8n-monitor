import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

// Tempos curtos para o teste; coleta.ts le estes valores na carga do modulo.
process.env.N8N_MONITOR_LIMITE_RESPOSTA_MS ||= '1500'
process.env.N8N_MONITOR_ORCAMENTO_CRON_MS ||= '800'
process.env.N8N_MONITOR_ORCAMENTO_RECENTES_MS ||= '800'
// timeout por chamada acima do prazo de resposta, senao a coleta terminaria antes
// do prazo e os testes de "nao fica presa" nunca exercitariam o corte
process.env.N8N_MONITOR_TIMEOUT_MS ||= '4000'
process.env.N8N_MONITOR_TIMEOUT_CRON_MS ||= '400'

const { coletarCompleto, conferirAgendamentos, recentesDeTodas } = await import('../src/coleta.ts')
const { criarRepo } = await import('../src/tarefas.ts')
const { criarDispatcherWebhook } = await import('../src/webhook.ts')
const { descartarClientes, clienteDe } = await import('../src/instancias.ts')
const { migrar } = await import('../src/config.ts')
const { gatilhosDe } = await import('../src/cron.ts')
type Runtime = import('../src/coleta.ts').Runtime

type OpcoesFalso = {
  fluxos?: number
  pendurarExecucoesDeFluxo?: boolean
  pendurarTudo?: boolean
  erros?: number
}

/* n8n falso. Conta as chamadas para provar que os caches evitam repeticao. */
function n8nFalso(op: OpcoesFalso = {}) {
  const contas = { workflows: 0, execucoes: 0, detalhe: 0, porFluxo: 0 }
  const fluxos = Array.from({ length: op.fluxos ?? 0 }, (_, i) => ({
    id: `wf${i}`,
    name: `Fluxo ${i}`,
    active: true,
    settings: {},
    nodes: [{
      name: 'Schedule',
      type: 'n8n-nodes-base.scheduleTrigger',
      parameters: { rule: { interval: [{ field: 'hours', hoursInterval: 1 }] } },
    }],
  }))
  const agora = Date.now()
  const erros = Array.from({ length: op.erros ?? 0 }, (_, i) => ({
    id: `ex${i}`,
    workflowId: `wf${i % Math.max(1, op.fluxos ?? 1)}`,
    status: 'error',
    mode: 'trigger',
    startedAt: new Date(agora - (i + 1) * 60000).toISOString(),
    stoppedAt: new Date(agora - (i + 1) * 60000 + 1000).toISOString(),
  }))

  const servidor = createServer((req, res) => {
    const u = req.url || ''
    if (op.pendurarTudo) return
    res.setHeader('content-type', 'application/json')
    if (u.startsWith('/api/v1/workflows')) {
      contas.workflows++
      return res.end(JSON.stringify({ data: fluxos }))
    }
    if (u.includes('includeData=true')) {
      contas.detalhe++
      return res.end(JSON.stringify({
        data: { resultData: { lastNodeExecuted: 'HTTP', runData: { HTTP: [{ error: { message: 'boom' } }] } } },
      }))
    }
    if (u.includes('workflowId=')) {
      contas.porFluxo++
      if (op.pendurarExecucoesDeFluxo) return
      return res.end(JSON.stringify({ data: [], nextCursor: null }))
    }
    contas.execucoes++
    res.end(JSON.stringify({ data: erros, nextCursor: null }))
  })
  return { servidor, contas }
}

async function subir(op: OpcoesFalso = {}) {
  const { servidor, contas } = n8nFalso(op)
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok))
  const porta = (servidor.address() as AddressInfo).port
  return { servidor, contas, baseUrl: `http://127.0.0.1:${porta}` }
}

let seq = 0
function runtimeDeTeste(baseUrl: string): Runtime {
  const orgId = `org-teste-${++seq}`
  let tarefas = '{}'
  let webhookEstado = '{}'
  const config = migrar({
    instancias: [{ id: 'principal', nome: 'n8n', baseUrl, apiKey: 'chave', ativo: true }],
  })
  return {
    orgId,
    config,
    reconhecimentos: {},
    repoTarefas: criarRepo({
      ler: async () => tarefas,
      gravar: async (t) => { tarefas = t },
    }),
    webhook: criarDispatcherWebhook({
      ler: async () => webhookEstado,
      gravar: async (t) => { webhookEstado = t },
      obterConfig: () => config.webhook,
    }),
    pronto: Promise.resolve(),
    ultimoUso: 0,
    cacheCompleto: { em: 0, dados: null },
    cacheCron: new Map(),
    cronEmCurso: new Map(),
    cacheUptime: { em: 0, dados: null },
    coletaEmCurso: null,
  } as Runtime
}

function encerrar(servidor: Server, rt: Runtime) {
  descartarClientes(rt.orgId)
  // sem isto, close() espera as conexoes deliberadamente penduradas
  servidor.closeAllConnections()
  return new Promise<void>((ok) => servidor.close(() => ok()))
}

test('detalhe de execucao com erro e buscado uma vez e reaproveitado do cache', async (t) => {
  const { servidor, contas, baseUrl } = await subir({ fluxos: 1, erros: 3 })
  const rt = runtimeDeTeste(baseUrl)
  t.after(() => encerrar(servidor, rt))

  await coletarCompleto(rt, true)
  const depoisDaPrimeira = contas.detalhe
  assert.ok(depoisDaPrimeira > 0, 'a primeira coleta deve buscar o detalhe')

  await coletarCompleto(rt, true)
  assert.equal(contas.detalhe, depoisDaPrimeira, 'execucao ja terminada nao pode ser rebaixada')
})

test('lista de fluxos nao dispara chamadas simultaneas duplicadas', async (t) => {
  const { servidor, contas, baseUrl } = await subir({ fluxos: 2 })
  const rt = runtimeDeTeste(baseUrl)
  t.after(() => encerrar(servidor, rt))

  const cli = clienteDe(rt.config.instancias[0], rt.orgId)
  await Promise.all(Array.from({ length: 8 }, () => cli.nomesDeFluxos()))
  assert.equal(contas.workflows, 1, 'oito chamadores simultaneos, uma requisicao')
})

test('varredura de agendamentos respeita o orcamento e se marca parcial', async (t) => {
  const { servidor, baseUrl } = await subir({ fluxos: 40, pendurarExecucoesDeFluxo: true })
  const rt = runtimeDeTeste(baseUrl)
  t.after(() => encerrar(servidor, rt))

  const inicio = Date.now()
  const r = await conferirAgendamentos(rt) as { parcial: boolean }
  const ms = Date.now() - inicio

  assert.equal(r.parcial, true, 'corte por tempo precisa aparecer na resposta')
  assert.ok(ms < 20000, `varredura levou ${ms}ms; o orcamento deveria ter cortado antes`)
})

test('agendamentos so olham fluxo publicado com gatilho de tempo habilitado', async (t) => {
  const { servidor, baseUrl } = await subir({ fluxos: 0 })
  const rt = runtimeDeTeste(baseUrl)
  t.after(() => encerrar(servidor, rt))

  // fluxo so de webhook nao produz gatilho de tempo
  assert.equal(gatilhosDe({ nodes: [{ name: 'Hook', type: 'n8n-nodes-base.webhook' }] }).length, 0)

  // webhook + cron produz, pelo cron
  const misto = gatilhosDe({
    nodes: [
      { name: 'Hook', type: 'n8n-nodes-base.webhook' },
      { name: 'Cron', type: 'n8n-nodes-base.scheduleTrigger', parameters: { rule: { interval: [{ field: 'hours' }] } } },
    ],
  })
  assert.equal(misto.length, 1)
  assert.equal(misto[0].desativado, false)

  // gatilho desativado e reconhecido, para a varredura poder descartar
  const desligado = gatilhosDe({
    nodes: [{
      name: 'Cron', type: 'n8n-nodes-base.scheduleTrigger', disabled: true,
      parameters: { rule: { interval: [{ field: 'hours' }] } },
    }],
  })
  assert.equal(desligado[0].desativado, true)

  const r = await conferirAgendamentos(rt) as { linhas: unknown[] }
  assert.deepEqual(r.linhas, [], 'sem fluxo publicado, nada a conferir')
})

test('resposta nao fica presa quando o n8n nao responde', async (t) => {
  const { servidor, baseUrl } = await subir({ pendurarTudo: true })
  const rt = runtimeDeTeste(baseUrl)
  t.after(() => encerrar(servidor, rt))

  const inicio = Date.now()
  const d = await coletarCompleto(rt, true) as { ok?: boolean; motivo?: string }
  const ms = Date.now() - inicio

  assert.ok(ms < 12000, `resposta levou ${ms}ms; o prazo deveria ter cortado antes`)
  assert.equal(d.ok, false)
  assert.equal(d.motivo, 'coletando', 'sem snapshot anterior, avisa que esta coletando')
})

test('leituras simultaneas compartilham a mesma coleta em curso', async (t) => {
  const { servidor, baseUrl } = await subir({ pendurarTudo: true })
  const rt = runtimeDeTeste(baseUrl)
  t.after(() => encerrar(servidor, rt))

  const [a, b] = await Promise.all([coletarCompleto(rt, true), coletarCompleto(rt, true)])
  assert.deepEqual(a, b)
  assert.notEqual(rt.coletaEmCurso, null, 'a coleta segue em segundo plano apos a resposta')
})

test('paginacao de recentes respeita o orcamento em vez de prender a resposta', async (t) => {
  const { servidor, baseUrl } = await subir({ pendurarTudo: true })
  const rt = runtimeDeTeste(baseUrl)
  t.after(() => encerrar(servidor, rt))

  const inicio = Date.now()
  const r = await recentesDeTodas(rt, 60)
  const ms = Date.now() - inicio
  assert.ok(ms < 30000, `recentesDeTodas levou ${ms}ms com 60 paginas pedidas`)
  assert.equal(r.itens.length, 0)
})
