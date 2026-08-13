import { createHash } from 'node:crypto'
import type { Instancia } from './tipos.js'

const TEMPO_LIMITE_MS = 25000
const VALIDADE_NOMES_MS = 300000
const VALIDADE_LISTA_MS = 30000

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

export function criarCliente(inst: Instancia) {
  const raiz = String(inst.baseUrl || '').replace(/\/+$/, '')
  const cacheNomes = new Map<string, string>()
  let nomesEm = 0
  let cacheLista = { em: 0, itens: [] as Record<string, unknown>[], truncado: false, cobriu: false, paginas: 0 }

  async function chamar(caminho: string) {
    if (!inst.apiKey || !raiz) throw new Error('nao configurado')
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), TEMPO_LIMITE_MS)
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

  async function nomesDeFluxos() {
    if (Date.now() - nomesEm < VALIDADE_NOMES_MS && cacheNomes.size) return cacheNomes
    try {
      const r = await chamar('/api/v1/workflows?limit=250') as { data?: { id: string; name: string }[] }
      for (const w of r.data || []) cacheNomes.set(w.id, w.name)
      nomesEm = Date.now()
    } catch {
      /* mantem o cache anterior */
    }
    return cacheNomes
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

  async function paginarExecucoes(query: string, { paginas = 6, ate = null as number | null } = {}) {
    const itens: ExecucaoN8n[] = []
    let cursor: string | null = null
    let alcancou = false
    for (let p = 0; p < paginas; p++) {
      const q = `/api/v1/executions?limit=250&${query}` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '')
      const r = await chamar(q) as { data?: ExecucaoN8n[]; nextCursor?: string | null }
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
    nomesDeFluxos,
    nomeDeFluxo,
    paginarExecucoes,
    listarRecentes,
    get nomes() { return cacheNomes },
    invalidar() {
      cacheNomes.clear(); nomesEm = 0
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
