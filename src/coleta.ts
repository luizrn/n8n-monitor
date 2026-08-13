import { montarAlertas, podeConfirmarRecuperacao } from './alertas.js'
import {
  chaveLimite, instanciasAtivas, instanciaPorId, publica, saneaInstancia,
} from './config.js'
import { gatilhosDe, regraParaCron, descreverRegra, esperadas, comparar } from './cron.js'
import { clienteDe, criarCliente } from './instancias.js'
import { criarResolvedorRdap } from './rdap.js'
import { redigir, redigirTexto } from './seguranca.js'
import { coletarUptime } from './uptime.js'
import type { Config, Reconhecimento } from './tipos.js'
import type { RepoTarefas } from './tarefas.js'
import type { DispatcherWebhook } from './webhook.js'

const JANELA_MS = 3600000
const ehErro = (s: string) => s === 'error' || s === 'crashed'
const ORDEM_VER: Record<string, number> = {
  'nunca-executou': 0, 'com-falhas': 1, 'sem-dados': 2, 'nao-comparavel': 3,
  ok: 4, 'sem-janela': 5, inativo: 6,
}

export type Runtime = {
  orgId: string
  config: Config
  reconhecimentos: Record<string, Reconhecimento>
  repoTarefas: RepoTarefas
  webhook: DispatcherWebhook
  cacheCompleto: { em: number; dados: Record<string, unknown> | null }
  cacheCron: Map<string, { em: number; linhas: Record<string, unknown>[] }>
  cacheUptime: { em: number; dados: Record<string, unknown> | null }
  coletaEmCurso: Promise<Record<string, unknown>> | null
}

const rdap = criarResolvedorRdap()

function limiteTravadaDe(rt: Runtime, instanciaId: string, workflowId: string) {
  return rt.config.limitesTravada[chaveLimite(instanciaId, workflowId)] ?? rt.config.limiteTravadaMin
}

function acharFalha(runData: Record<string, { error?: { message?: string }; executionTime?: number }[] | undefined> | undefined) {
  for (const [no, execs] of Object.entries(runData || {})) {
    for (const ex of execs || []) {
      if (ex?.error) return { no, erro: ex.error, tempo: ex.executionTime }
    }
  }
  return null
}

async function agruparErros(cli: ReturnType<typeof clienteDe>, lista: { workflowId: string; startedAt?: string; id: string; mode?: string }[], todasRecentes: { workflowId: string; status?: string; startedAt?: string; id: string }[] = []) {
  const inst = cli.inst
  const porFluxo = new Map<string, { workflowId: string; execs: typeof lista }>()
  for (const e of lista) {
    const g = porFluxo.get(e.workflowId) || { workflowId: e.workflowId, execs: [] }
    g.execs.push(e)
    porFluxo.set(e.workflowId, g)
  }

  const grupos = [...porFluxo.values()].sort(
    (a, b) => new Date(b.execs[0].startedAt || 0).getTime() - new Date(a.execs[0].startedAt || 0).getTime()
  )

  const MAX_DETALHE = 10
  const saida = []
  for (const [i, g] of grupos.entries()) {
    const novo = g.execs[0]
    let no: string | null = null, mensagem: string | null = null
    if (i < MAX_DETALHE) {
      try {
        const ex = await cli.chamar(`/api/v1/executions/${novo.id}?includeData=true`) as {
          data?: { resultData?: { runData?: Record<string, { error?: { message?: string } }[]>; error?: { message?: string }; lastNodeExecuted?: string } }
        }
        const rd = ex?.data?.resultData
        const f = acharFalha(rd?.runData) || (rd?.error ? { no: rd.lastNodeExecuted, erro: rd.error } : null)
        no = f?.no ?? rd?.lastNodeExecuted ?? null
        mensagem = (f?.erro as { message?: string } | undefined)?.message ?? null
      } catch { /* segue sem detalhe */ }
    }
    const instanteErro = new Date(novo.startedAt || 0).getTime()
    const sucessoDepois = todasRecentes.find(
      (e) => e.workflowId === g.workflowId && e.status === 'success'
        && e.startedAt && new Date(e.startedAt).getTime() > instanteErro
    )

    saida.push({
      instanciaId: inst.id,
      instancia: inst.nome,
      chave: `erro:${inst.id}:${g.workflowId}:${no || ''}`,
      workflowId: g.workflowId,
      fluxo: await cli.nomeDeFluxo(g.workflowId),
      no,
      mensagem,
      resolvidoPor: sucessoDepois ? { id: sucessoDepois.id, quando: sucessoDepois.startedAt } : null,
      total: g.execs.length,
      ids: g.execs.slice(0, 50).map((x) => x.id),
      idExemplo: novo.id,
      ultimo: novo.startedAt,
      primeiro: g.execs[g.execs.length - 1].startedAt,
      modo: novo.mode,
      detalheOmitido: i >= MAX_DETALHE,
    })
  }
  return saida
}

async function estadoDaInstancia(rt: Runtime, inst: Config['instancias'][number], agora: number) {
  const cli = clienteDe(inst, rt.orgId)
  const desde = agora - JANELA_MS

  const [pgRecentes, pgErros, pgRodando] = await Promise.all([
    cli.paginarExecucoes('', { paginas: 6, ate: desde }),
    cli.paginarExecucoes('status=error', { paginas: 3, ate: desde }),
    cli.paginarExecucoes('status=running', { paginas: 1 }),
  ])

  await cli.nomesDeFluxos()

  const comNome = async (e: { id: string; workflowId: string; status: string; mode: string; startedAt?: string; stoppedAt?: string }) => ({
    id: e.id,
    instanciaId: inst.id,
    instancia: inst.nome,
    fluxo: await cli.nomeDeFluxo(e.workflowId),
    workflowId: e.workflowId,
    status: e.status,
    modo: e.mode,
    inicio: e.startedAt,
    fim: e.stoppedAt,
    minutos: e.startedAt ? (agora - new Date(e.startedAt).getTime()) / 60000 : null,
  })

  const errosJanela = pgErros.itens.filter(
    (e) => e.startedAt && agora - new Date(e.startedAt).getTime() <= JANELA_MS
  )
  const todosGrupos = await agruparErros(
    cli,
    errosJanela.length ? errosJanela : pgErros.itens.slice(0, 60),
    pgRecentes.itens
  )
  const listaRodando = await Promise.all(pgRodando.itens.slice(0, 30).map(comNome))

  const umaHora = pgRecentes.itens.filter(
    (e) => e.startedAt && agora - new Date(e.startedAt).getTime() <= 3600000
  )

  const porFluxo = new Map<string, Record<string, unknown>>()
  for (const e of umaHora) {
    const k = e.workflowId
    const v = porFluxo.get(k) || {
      workflowId: k, instanciaId: inst.id, instancia: inst.nome,
      fluxo: cli.nomes.get(k) || k, total: 0, erros: 0,
    }
    v.total = Number(v.total) + 1
    if (ehErro(e.status)) v.erros = Number(v.erros) + 1
    porFluxo.set(k, v)
  }

  return {
    inst,
    recentes: pgRecentes.itens,
    truncado: !pgRecentes.cobriu,
    grupos: todosGrupos,
    rodando: listaRodando,
    umaHora,
    porFluxo: [...porFluxo.values()],
  }
}

async function montarEstado(rt: Runtime) {
  const agora = Date.now()
  const ativas = instanciasAtivas(rt.config)

  const resultados = await Promise.all(ativas.map(async (inst) => {
    try {
      return { ok: true as const, dados: await estadoDaInstancia(rt, inst, agora) }
    } catch (e) {
      return { ok: false as const, inst, motivo: String((e as Error).message || e) }
    }
  }))

  const vivos = resultados.filter((r) => r.ok).map((r) => r.dados)
  const caidas = resultados.filter((r) => !r.ok)

  const todosGrupos = vivos.flatMap((v) => v.grupos)
  const gruposErro = todosGrupos.filter((g) => !g.resolvidoPor)
  const gruposResolvidos = todosGrupos.filter((g) => g.resolvidoPor)

  const rodando = vivos.flatMap((v) => v.rodando)
    .map((e) => ({ ...e, limiteMin: limiteTravadaDe(rt, e.instanciaId, e.workflowId) }))
    .sort((a, b) => (b.minutos ?? 0) - (a.minutos ?? 0))
  const umaHora = vivos.flatMap((v) => v.umaHora)
  const recentes = vivos.flatMap((v) => v.recentes)

  const baldes = new Map<string, { minuto: string; ok: number; erro: number }>()
  for (let i = 59; i >= 0; i--) {
    const t = new Date(agora - i * 60000)
    t.setSeconds(0, 0)
    baldes.set(t.toISOString(), { minuto: t.toISOString(), ok: 0, erro: 0 })
  }
  for (const e of recentes) {
    if (!e.startedAt) continue
    const t = new Date(e.startedAt)
    t.setSeconds(0, 0)
    const b = baldes.get(t.toISOString())
    if (!b) continue
    b[ehErro(e.status) ? 'erro' : 'ok']++
  }

  return {
    ok: true,
    momento: new Date(agora).toISOString(),
    instancias: [
      ...vivos.map((v) => ({ ...publica(v.inst), alcancavel: true })),
      ...caidas.map((c) => ({ ...publica(c.inst), alcancavel: false, motivo: c.motivo })),
    ],
    inalcancaveis: caidas.map((c) => ({ id: c.inst.id, nome: c.inst.nome, motivo: c.motivo })),
    tiles: {
      errosHora: umaHora.filter((e) => ehErro(e.status)).length,
      execucoesHora: umaHora.length,
      rodando: rodando.length,
      travadas: rodando.filter((e) => (e.minutos ?? 0) >= e.limiteMin).length,
      porMinuto: umaHora.length / 60,
      truncado: vivos.some((v) => v.truncado),
    },
    serie: [...baldes.values()],
    erros: gruposErro,
    resolvidos: gruposResolvidos,
    reconhecimentos: rt.reconhecimentos,
    tarefasAtivas: rt.repoTarefas.chavesAtivas(),
    tarefasContagem: rt.repoTarefas.contagem(),
    rodando,
    porFluxo: vivos.flatMap((v) => v.porFluxo).sort((a, b) => Number(b.total) - Number(a.total)).slice(0, 12),
    limiteTravadaMin: rt.config.limiteTravadaMin,
  }
}

async function cronDaInstancia(rt: Runtime, inst: Config['instancias'][number]) {
  const guardado = rt.cacheCron.get(inst.id)
  if (guardado && Date.now() - guardado.em < 300000) return guardado.linhas

  const cli = clienteDe(inst, rt.orgId)
  const wfs = await cli.chamar('/api/v1/workflows?limit=250') as { data?: { id: string; name: string; active?: boolean; settings?: { timezone?: string }; nodes?: unknown[] }[] }
  const fim = Date.now()
  const inicio = fim - rt.config.horasCron * 3600000

  const alvos = []
  for (const wf of wfs.data || []) {
    const gats = gatilhosDe(wf as { nodes?: { name?: string; type?: string; disabled?: boolean; parameters?: Record<string, unknown> }[] })
    if (gats.length) alvos.push({ wf, gats })
  }

  const linhas: Record<string, unknown>[] = []
  for (const { wf, gats } of alvos.slice(0, 40)) {
    const tz = wf.settings?.timezone && wf.settings.timezone !== 'DEFAULT'
      ? wf.settings.timezone : rt.config.fuso

    let execs: { id: string; startedAt?: string; mode?: string }[] = []
    try {
      const pg = await cli.paginarExecucoes(`workflowId=${encodeURIComponent(wf.id)}`, { paginas: 3, ate: inicio })
      execs = pg.itens
        .filter((e) => e.startedAt && new Date(e.startedAt).getTime() >= inicio)
        .filter((e) => e.mode === 'trigger' || e.mode === 'scheduled')
        .sort((a, b) => new Date(a.startedAt || 0).getTime() - new Date(b.startedAt || 0).getTime())
    } catch { /* segue sem execucoes */ }

    const base = {
      instanciaId: inst.id, instancia: inst.nome,
      fluxo: wf.name, workflowId: wf.id,
      ativo: Boolean(wf.active), fuso: tz,
    }

    for (const g of gats) {
      const campos = regraParaCron(g.item)
      const desc = descreverRegra(g.item)
      const comum = { ...base, no: g.no, regra: desc, desativado: g.desativado }

      if (!campos) {
        linhas.push({
          ...comum,
          veredito: 'nao-comparavel',
          detalhe: g.item?.field === 'seconds'
            ? 'intervalo em segundos: granularidade fina demais para conferir'
            : 'regra não reconhecida pelo avaliador',
          esperado: null, cumpridas: null, perdidas: [], atrasoMedioSeg: null,
          ultimaExec: execs.at(-1)?.startedAt ?? null,
        })
        continue
      }

      const inativo = !wf.active || g.desativado
      const horizonte = execs.length
        ? Math.max(inicio, new Date(execs[0].startedAt || 0).getTime())
        : null

      if (!inativo && horizonte === null) {
        linhas.push({
          ...comum,
          veredito: 'sem-dados',
          detalhe: 'nenhuma execução retida na janela — a retenção do banco não permite afirmar se rodou',
          esperado: null, cumpridas: null, perdidas: [], totalPerdidas: 0, extras: 0,
          atrasoMedioSeg: null, janelaVerificadaHoras: 0,
          ultimoPrevisto: esperadas(campos, tz, inicio, fim).at(-1)?.toISOString() ?? null,
          ultimaExec: null,
        })
        continue
      }

      const de = inativo ? inicio : horizonte as number
      const ocor = esperadas(campos, tz, de, fim)
      const cobraveis = ocor.filter((o) => fim - o.getTime() > rt.config.toleranciaMin * 60000)
      const cmp = comparar(cobraveis, execs as { id: string; startedAt: string }[], rt.config.toleranciaMin)

      let veredito = 'ok'
      if (inativo) veredito = 'inativo'
      else if (cobraveis.length === 0) veredito = 'sem-janela'
      else if (cmp.cumpridas.length === 0) veredito = 'nunca-executou'
      else if (cmp.perdidas.length) veredito = 'com-falhas'

      const atrasos = cmp.cumpridas.map((c) => c.atrasoSeg)
      linhas.push({
        ...comum,
        veredito,
        janelaVerificadaHoras: inativo ? null : Number(((fim - de) / 3600000).toFixed(1)),
        esperado: cobraveis.length,
        cumpridas: cmp.cumpridas.length,
        perdidas: cmp.perdidas.slice(-12),
        totalPerdidas: cmp.perdidas.length,
        extras: cmp.extras.length,
        atrasoMedioSeg: atrasos.length ? Math.round(atrasos.reduce((a, b) => a + b, 0) / atrasos.length) : null,
        ultimoPrevisto: cobraveis.at(-1)?.toISOString() ?? null,
        ultimaExec: execs.at(-1)?.startedAt ?? null,
      })
    }
  }

  rt.cacheCron.set(inst.id, { em: Date.now(), linhas })
  return linhas
}

export async function conferirAgendamentos(rt: Runtime) {
  const ativas = instanciasAtivas(rt.config)
  const lotes = await Promise.all(ativas.map(async (inst) => {
    try { return await cronDaInstancia(rt, inst) } catch { return [] }
  }))
  const linhas = lotes.flat().sort(
    (a, b) => (ORDEM_VER[String(a.veredito)] ?? 9) - (ORDEM_VER[String(b.veredito)] ?? 9)
      || (Number(b.totalPerdidas) || 0) - (Number(a.totalPerdidas) || 0)
  )
  return {
    ok: true,
    janelaHoras: rt.config.horasCron,
    toleranciaMin: rt.config.toleranciaMin,
    fusoPadrao: rt.config.fuso,
    linhas,
  }
}

export async function uptimeAtual(rt: Runtime, forcar = false) {
  const cfg = rt.config.uptimeKuma
  if (!cfg?.ativo) return { ok: false, motivo: 'desligado' }
  if (!forcar && Date.now() - rt.cacheUptime.em < 20000 && rt.cacheUptime.dados) return rt.cacheUptime.dados
  const d = await coletarUptime(cfg) as Record<string, unknown> & { ok?: boolean; monitores?: { ativo?: boolean; host?: string | null; url?: string | null }[] }
  if (d.ok) d.dominios = await rdap.enriquecer(d.monitores || [])
  rt.cacheUptime = { em: Date.now(), dados: d }
  return d
}

export async function coletarCompleto(rt: Runtime, forcar = false) {
  if (!forcar && rt.cacheCompleto.dados && Date.now() - rt.cacheCompleto.em < 8000) return rt.cacheCompleto.dados
  if (rt.coletaEmCurso) return rt.coletaEmCurso
  rt.coletaEmCurso = (async () => {
    const [estado, cron, uptime] = await Promise.all([
      montarEstado(rt),
      conferirAgendamentos(rt).catch((e) => ({ ok: false, motivo: 'erro', detalhe: String((e as Error).message || e), linhas: [] })),
      uptimeAtual(rt, forcar).catch((e) => ({ ok: false, motivo: 'erro', detalhe: String((e as Error).message || e) })),
    ])
    const alertasAtivos = montarAlertas(estado as Parameters<typeof montarAlertas>[0], cron, uptime)
    const chaves = new Set(alertasAtivos.map((a) => String(a.chave)))
    const podeResolver = (item: { chave?: string; origem?: string | null; instanciaId?: string | null }) =>
      podeConfirmarRecuperacao({ chave: item.chave, origem: item.origem || undefined, instanciaId: item.instanciaId || undefined }, estado, uptime)

    let limpou = false
    for (const chave of Object.keys(rt.reconhecimentos)) {
      const reconhecimento = { chave, ...rt.reconhecimentos[chave] }
      const tarefa = rt.repoTarefas.pegar(chave)
      if (!chaves.has(chave) && podeResolver({ ...tarefa, ...reconhecimento })) {
        delete rt.reconhecimentos[chave]
        limpou = true
      }
    }
    if (limpou) {
      const { salvarReconhecimentosOrg } = await import('./persistencia.js')
      salvarReconhecimentosOrg(rt.orgId, rt.reconhecimentos)
    }
    await rt.repoTarefas.resolverAusentes(chaves, (t) => podeResolver(t))

    const alertas = alertasAtivos.filter((a) => {
      const r = rt.reconhecimentos[String(a.chave)]
      return !r || Number(a.magnitude || 1) > Number(r.magnitude || 1)
    })
    const dados = {
      ...estado, cron, uptime, alertas, alertasAtivos: alertasAtivos.length,
      reconhecimentos: rt.reconhecimentos, tarefasAtivas: rt.repoTarefas.chavesAtivas(),
      tarefasContagem: rt.repoTarefas.contagem(),
    }
    rt.cacheCompleto = { em: Date.now(), dados }
    rt.webhook.processar(alertasAtivos as Record<string, unknown>[], podeResolver).catch((e) => console.error('webhook:', (e as Error).message || e))
    return dados
  })()
  try { return await rt.coletaEmCurso } finally { rt.coletaEmCurso = null }
}

export function invalidarEstadoCompleto(rt: Runtime) {
  rt.cacheCompleto = { em: 0, dados: null }
}

export function percentil(valores: number[], p: number) {
  if (!valores.length) return null
  const v = valores.slice().sort((a, b) => a - b)
  return v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))]
}

export async function recentesDeTodas(rt: Runtime, paginas = 10) {
  const ativas = instanciasAtivas(rt.config)
  const lotes = await Promise.all(ativas.map(async (inst) => {
    try { return await clienteDe(inst, rt.orgId).listarRecentes(paginas) } catch { return null }
  }))
  const itens = lotes.filter(Boolean).flatMap((l) => l!.itens)
    .sort((a, b) => new Date(String(b.inicio || 0)).getTime() - new Date(String(a.inicio || 0)).getTime())
  return {
    itens,
    truncado: lotes.filter(Boolean).some((l) => !l!.cobriu),
    falhas: ativas.filter((_, i) => !lotes[i]).map((i) => i.nome),
  }
}

export function montarDiagnostico(meta: Record<string, unknown>, fluxo: string, exec: Record<string, unknown>, inst: Config['instancias'][number]) {
  const rd = (exec?.data as { resultData?: { runData?: Record<string, { error?: Record<string, unknown>; executionTime?: number }[]>; error?: Record<string, unknown>; lastNodeExecuted?: string } } | undefined)?.resultData
  const falha = acharFalha(rd?.runData) || (rd?.error ? { no: rd.lastNodeExecuted, erro: rd.error } : null)
  const e = (falha?.erro || {}) as Record<string, unknown>
  const L = []
  L.push('## Erro no n8n')
  L.push('')
  L.push(`- instancia: ${inst.nome} (\`${inst.id}\`)`)
  L.push(`- fluxo: ${fluxo} (\`${meta.workflowId}\`)`)
  L.push(`- execucao: \`${meta.id}\`  status: ${meta.status}  modo: ${meta.mode}`)
  L.push(`- inicio: ${meta.startedAt}  fim: ${meta.stoppedAt ?? '(nao terminou)'}`)
  L.push(`- no que falhou: **${falha?.no ?? rd?.lastNodeExecuted ?? '(desconhecido)'}**`)
  L.push(`- url: ${inst.baseUrl}/workflow/${meta.workflowId}/executions/${meta.id}`)
  L.push('')
  if (e.message || e.description || e.httpCode) {
    L.push('### Mensagem')
    if (e.message) L.push(`\`\`\`\n${redigirTexto(e.message)}\n\`\`\``)
    if (e.description) L.push(`descricao: ${redigirTexto(e.description)}`)
    if (e.httpCode) L.push(`httpCode: ${e.httpCode}`)
    if (e.name) L.push(`tipo: ${e.name}`)
    if (Array.isArray(e.messages) && e.messages.length) L.push(`dicas: ${redigirTexto(e.messages.join(' | '))}`)
    L.push('')
  }
  if (e.node) {
    L.push('### Nó (parâmetros, credenciais redigidas)')
    L.push('```json')
    const no = e.node as Record<string, unknown>
    L.push(JSON.stringify(redigir({
      name: no.name, type: no.type, typeVersion: no.typeVersion,
      retryOnFail: no.retryOnFail, maxTries: no.maxTries,
      onError: no.onError, parameters: no.parameters,
    }), null, 2))
    L.push('```')
    L.push('')
  }
  if (e.context) {
    L.push('### Contexto da requisição (redigido)')
    L.push('```json')
    L.push(JSON.stringify(redigir(e.context), null, 2))
    L.push('```')
    L.push('')
  }
  const nos = Object.keys(rd?.runData || {})
  if (nos.length) {
    L.push(`### Nós executados (${nos.length})`)
    L.push(nos.map((n) => `- ${n}`).join('\n'))
    L.push('')
  }
  if (e.stack) {
    L.push('### Stack')
    L.push('```')
    L.push(redigirTexto(e.stack).split('\n').slice(0, 12).join('\n'))
    L.push('```')
  }
  L.push('')
  L.push('_Credenciais redigidas automaticamente pelo painel._')
  return L.join('\n')
}

export { instanciaPorId, saneaInstancia, criarCliente, clienteDe, rdap }
