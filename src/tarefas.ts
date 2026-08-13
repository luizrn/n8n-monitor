import { chaveDeRegistroValida, registroSeguro, urlHttpValida } from './seguranca.js'

export const ESTADOS = ['analise', 'aguardando', 'corrigindo', 'corrigido', 'producao', 'resolvido'] as const
export type EstadoTarefa = (typeof ESTADOS)[number]

export const ROTULOS: Record<EstadoTarefa, string> = {
  analise: 'Em análise',
  aguardando: 'Aguardando',
  corrigindo: 'Corrigindo',
  corrigido: 'Corrigido',
  producao: 'Em produção',
  resolvido: 'Resolvido',
}

const PESO = Object.fromEntries(ESTADOS.map((e, i) => [e, i])) as Record<string, number>

export type HistoricoTarefa = { de?: string; para: string; em: string; motivo?: string }

export type Tarefa = {
  chave: string
  instanciaId?: string | null
  instancia?: string | null
  tipo?: string
  origem?: string | null
  nivel?: string
  fluxo?: string | null
  workflowId?: string | null
  no?: string | null
  mensagem?: string | null
  link?: string | null
  magnitude?: number
  ocorrencias?: number
  estado: string
  nota?: string
  criadoEm?: string
  vistoEm?: string
  atualizadoEm: string
  historico?: HistoricoTarefa[]
  resolvidoAutomaticamente?: boolean
}

export function normalizarEstado(v: unknown): EstadoTarefa {
  return ESTADOS.includes(v as EstadoTarefa) ? v as EstadoTarefa : 'analise'
}

export function criarRepo({ ler, gravar }: { ler: () => Promise<string>; gravar: (t: string) => Promise<void> }) {
  let tarefas = registroSeguro<Tarefa>()

  async function carregar() {
    try {
      const cru = JSON.parse(await ler())
      tarefas = registroSeguro<Tarefa>(cru)
      for (const tarefa of Object.values(tarefas)) {
        if (tarefa?.link && !urlHttpValida(tarefa.link)) tarefa.link = null
      }
    } catch {
      tarefas = registroSeguro<Tarefa>()
    }
  }

  async function salvar() {
    await gravar(JSON.stringify(tarefas, null, 2))
  }

  async function abrir(dados: Record<string, unknown>) {
    const agora = new Date().toISOString()
    const chave = String(dados.chave || '').trim()
    if (!chaveDeRegistroValida(chave)) throw new Error('chave inválida')
    if (dados.link && !urlHttpValida(dados.link)) dados = { ...dados, link: null }

    const antiga = tarefas[chave]
    if (antiga) {
      antiga.magnitude = Math.max(Number(antiga.magnitude || 1), Number(dados.magnitude || 1))
      antiga.ocorrencias = (antiga.ocorrencias || 1) + 1
      antiga.vistoEm = agora
      for (const c of ['fluxo', 'no', 'mensagem', 'link', 'tipo', 'nivel', 'origem', 'instancia', 'instanciaId', 'workflowId'] as const) {
        if (dados[c] != null && dados[c] !== '') (antiga as Record<string, unknown>)[c] = dados[c]
      }
      if (antiga.estado === 'resolvido') {
        antiga.historico = [...(antiga.historico || []), {
          de: 'resolvido', para: 'analise', em: agora, motivo: 'recorrencia',
        }].slice(-40)
        antiga.estado = 'analise'
        antiga.criadoEm = agora
      }
      antiga.atualizadoEm = agora
      await salvar()
      return antiga
    }

    tarefas[chave] = {
      chave,
      instanciaId: (dados.instanciaId as string) || null,
      instancia: (dados.instancia as string) || null,
      tipo: (dados.tipo as string) || 'alerta',
      origem: (dados.origem as string) || null,
      nivel: (dados.nivel as string) || 'atencao',
      fluxo: (dados.fluxo as string) || (dados.titulo as string) || null,
      workflowId: (dados.workflowId as string) || null,
      no: (dados.no as string) || null,
      mensagem: (dados.mensagem as string) || null,
      link: (dados.link as string) || null,
      magnitude: Number(dados.magnitude || 1),
      ocorrencias: 1,
      estado: 'analise',
      nota: '',
      criadoEm: agora,
      vistoEm: agora,
      atualizadoEm: agora,
      historico: [{ para: 'analise', em: agora }],
    }
    await salvar()
    return tarefas[chave]
  }

  async function mover(chave: string, estado: string, nota?: string) {
    const t = tarefas[chave]
    if (!t) return null
    const novo = normalizarEstado(estado)
    const agora = new Date().toISOString()
    if (novo !== t.estado) {
      t.historico = [...(t.historico || []), { de: t.estado, para: novo, em: agora }].slice(-40)
      t.estado = novo
    }
    if (typeof nota === 'string') t.nota = nota.slice(0, 2000)
    t.atualizadoEm = agora
    await salvar()
    return t
  }

  async function remover(chave: string) {
    if (!tarefas[chave]) return false
    delete tarefas[chave]
    await salvar()
    return true
  }

  function lista() {
    return Object.values(tarefas).sort(
      (a, b) => (PESO[a.estado] ?? 9) - (PESO[b.estado] ?? 9)
        || new Date(b.atualizadoEm).getTime() - new Date(a.atualizadoEm).getTime()
    )
  }

  function contagem() {
    const c = Object.fromEntries(ESTADOS.map((e) => [e, 0])) as Record<string, number>
    for (const t of Object.values(tarefas)) c[t.estado] = (c[t.estado] || 0) + 1
    return c
  }

  function chavesAtivas() {
    return Object.values(tarefas)
      .filter((t) => t.estado !== 'resolvido')
      .map((t) => t.chave)
  }

  function pegar(chave: string) { return tarefas[chave] || null }

  async function resolverAusentes(chavesPresentes: Iterable<string>, podeResolver: (t: Tarefa) => boolean = () => true) {
    const presentes = new Set(chavesPresentes || [])
    const agora = new Date().toISOString()
    let mudou = false
    for (const t of Object.values(tarefas)) {
      if (t.estado === 'resolvido' || presentes.has(t.chave) || !podeResolver(t)) continue
      t.historico = [...(t.historico || []), {
        de: t.estado, para: 'resolvido', em: agora, motivo: 'recuperacao-automatica',
      }].slice(-40)
      t.estado = 'resolvido'
      t.atualizadoEm = agora
      t.resolvidoAutomaticamente = true
      mudou = true
    }
    if (mudou) await salvar()
    return mudou
  }

  return { carregar, salvar, abrir, mover, remover, lista, contagem, chavesAtivas, pegar, resolverAusentes }
}

export type RepoTarefas = ReturnType<typeof criarRepo>
