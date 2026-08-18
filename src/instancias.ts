import { createHash } from 'node:crypto'
import type { Instancia } from './tipos.js'

export const TEMPO_LIMITE_MS = 25000
// varredura de agendamentos percorre dezenas de fluxos: espera menos por chamada
export const TEMPO_LIMITE_CURTO_MS = 8000
const VALIDADE_NOMES_MS = 300000
const VALIDADE_LISTA_MS = 30000
const MAX_DETALHES = 500

export function idDeInstancia(nome: string) {
  const base = String(nome || 'n8n')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return base || 'n8n'
}

export type ExecucaoN8n = {
  id: string
  workflowId: string
  status: string
  mode: string
  startedAt?: string
  stoppedAt?: string
}

export type FluxoN8n = {
  id: string
  name: string
  active?: boolean
  settings?: { timezone?: string }
  nodes?: unknown[]
}

export type DetalheErro = { no: string | null; mensagem: string | null }

export function acharFalha(runData: Record<string, { error?: Record<string, unknown>; executionTime?: number }[] | undefined> | undefined) {
  for (const [no, execs] of Object.entries(runData || {})) {
    for (const ex of execs || []) {
      if (ex?.error) return { no, erro: ex.error, tempo: ex.executionTime }
    }
  }
  return null
}

export function criarCliente(inst: Instancia) {
  const raiz = String(inst.baseUrl || '').replace(/\/+$/, '')
  const cacheNomes = new Map<string, string>()
  let cacheFluxos: FluxoN8n[] = []
  let fluxosEm = 0
  let fluxosEmCurso: Promise<FluxoN8n[]> | null = null
  // execucao terminada nao muda mais: o detalhe do erro pode ser guardado para sempre
  const cacheDetalhes = new Map<string, DetalheErro>()
  let cacheLista = { em: 0, itens: [] as Record<string, unknown>[], truncado: false, cobriu: false, paginas: 0 }

  async function chamar(caminho: string, { tempoLimiteMs = TEMPO_LIMITE_MS } = {}) {
    if (!inst.apiKey || !raiz) throw new Error('nao configurado')
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), tempoLimiteMs)
    try {
      const r = await fetch(raiz + caminho, {
        headers: { 'X-N8N-API-KEY': inst.apiKey, accept: 'application/json' },
        signal: ctrl.signal,
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return await r.json() as Record<string, unknown>
    } finally {
      clearTimeout(t)
    }
  }

  // fonte unica da lista de fluxos: nomes e varredura de agendamentos compartilham a mesma busca.
  // sem a trava de chamada em curso, N chamadores simultaneos disparavam N vezes a mesma requisicao.
  async function listarFluxos() {
    if (fluxosEm && Date.now() - fluxosEm < VALIDADE_NOMES_MS) return cacheFluxos
    if (fluxosEmCurso) return fluxosEmCurso
    fluxosEmCurso = (async () => {
      const r = await chamar('/api/v1/workflows?limit=250') as { data?: FluxoN8n[] }
      cacheFluxos = r.data || []
      for (const w of cacheFluxos) cacheNomes.set(w.id, w.name)
      fluxosEm = Date.now()
      return cacheFluxos
    })()
    try {
      return await fluxosEmCurso
    } finally {
      fluxosEmCurso = null
    }
  }

  async function nomesDeFluxos() {
    try {
      await listarFluxos()
    } catch {
      /* mantem o cache anterior */
    }
    return cacheNomes
  }

  async function detalheDeErro(id: string): Promise<DetalheErro> {
    const guardado = cacheDetalhes.get(id)
    if (guardado) return guardado
    try {
      const ex = await chamar(`/api/v1/executions/${encodeURIComponent(id)}?includeData=true`) as {
        data?: { resultData?: { runData?: Record<string, { error?: Record<string, unknown> }[]>; error?: Record<string, unknown>; lastNodeExecuted?: string } }
      }
      const rd = ex?.data?.resultData
      const f = acharFalha(rd?.runData) || (rd?.error ? { no: rd.lastNodeExecuted, erro: rd.error } : null)
      const detalhe: DetalheErro = {
        no: f?.no ?? rd?.lastNodeExecuted ?? null,
        mensagem: (f?.erro as { message?: string } | undefined)?.message ?? null,
      }
      if (cacheDetalhes.size >= MAX_DETALHES) {
        const maisAntigo = cacheDetalhes.keys().next().value
        if (maisAntigo !== undefined) cacheDetalhes.delete(maisAntigo)
      }
      cacheDetalhes.set(id, detalhe)
      return detalhe
    } catch {
      /* falha nao entra no cache: tenta de novo no proximo ciclo */
      return { no: null, mensagem: null }
    }
  }

  async function nomeDeFluxo(id: string) {
    const m = await nomesDeFluxos()
    if (m.has(id)) return m.get(id) as string
    try {
      const w = await chamar(`/api/v1/workflows/${id}`) as { name?: string }
      if (w?.name) { cacheNomes.set(id, w.name); return w.name }
    } catch { /* ignora */ }
    return id
  }

  async function paginarExecucoes(query: string, { paginas = 6, ate = null as number | null, tempoLimiteMs = TEMPO_LIMITE_MS } = {}) {
    const itens: ExecucaoN8n[] = []
    let cursor: string | null = null
    let alcancou = false
    for (let p = 0; p < paginas; p++) {
      const q = `/api/v1/executions?limit=250&${query}` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '')
      const r = await chamar(q, { tempoLimiteMs }) as { data?: ExecucaoN8n[]; nextCursor?: string | null }
      const lote = r.data || []
      itens.push(...lote)
      cursor = r.nextCursor || null
      if (!cursor || !lote.length) { alcancou = true; break }
      if (ate) {
        const maisVelho = lote[lote.length - 1]?.startedAt
        if (maisVelho && new Date(maisVelho).getTime() < ate) { alcancou = true; break }
      }
    }
    return { itens, truncado: Boolean(cursor), cobriu: ate ? alcancou : !cursor }
  }

  async function listarRecentes(paginas = 10) {
    const valido = Date.now() - cacheLista.em < VALIDADE_LISTA_MS && cacheLista.itens.length
    if (valido && cacheLista.paginas >= paginas) return cacheLista
    const { itens, truncado, cobriu } = await paginarExecucoes('', { paginas })
    await nomesDeFluxos()
    const enriquecidos = itens.map((e) => ({
      id: e.id,
      workflowId: e.workflowId,
      fluxo: cacheNomes.get(e.workflowId) || e.workflowId,
      status: e.status,
      modo: e.mode,
      inicio: e.startedAt,
      fim: e.stoppedAt,
      duracaoMs: e.startedAt && e.stoppedAt
        ? new Date(e.stoppedAt).getTime() - new Date(e.startedAt).getTime()
        : null,
      instanciaId: inst.id,
      instancia: inst.nome,
    }))
    cacheLista = { em: Date.now(), itens: enriquecidos, truncado, cobriu, paginas }
    return cacheLista
  }

  return {
    inst,
    baseUrl: raiz,
    chamar,
    listarFluxos,
    nomesDeFluxos,
    nomeDeFluxo,
    detalheDeErro,
    paginarExecucoes,
    listarRecentes,
    get nomes() { return cacheNomes },
    invalidar() {
      cacheNomes.clear(); cacheFluxos = []; fluxosEm = 0
      cacheDetalhes.clear()
      cacheLista = { em: 0, itens: [], truncado: false, cobriu: false, paginas: 0 }
    },
  }
}

export type ClienteN8n = ReturnType<typeof criarCliente>

const registro = new Map<string, { chave: string; cliente: ClienteN8n }>()

function assinatura(inst: Instancia) {
  const segredo = createHash('sha256').update(String(inst.apiKey || '')).digest('hex')
  return `${inst.id}|${inst.baseUrl}|${segredo}`
}

export function clienteDe(inst: Instancia, orgId = '') {
  const id = `${orgId}:${inst.id}`
  const chave = assinatura(inst)
  const atual = registro.get(id)
  if (atual && atual.chave === chave) return atual.cliente
  const cliente = criarCliente(inst)
  registro.set(id, { chave, cliente })
  return cliente
}

export function descartarClientes(orgId?: string) {
  if (!orgId) {
    registro.clear()
    return
  }
  for (const chave of [...registro.keys()]) {
    if (chave.startsWith(`${orgId}:`)) registro.delete(chave)
  }
}
