import { lerJsonWorkspace, listarOrganizationIds } from './db.js'
import { instanciasAtivas } from './config.js'
import {
  carregarConfigOrg, carregarReconhecimentosOrg, gravarTarefasOrg, gravarWebhookOrg,
  lerTarefasOrg, lerWebhookOrg, salvarConfigOrg, salvarReconhecimentosOrg,
} from './persistencia.js'
import { criarRepo } from './tarefas.js'
import { criarDispatcherWebhook } from './webhook.js'
import { coletarCompleto, invalidarEstadoCompleto, type Runtime } from './coleta.js'
import { descartarClientes } from './instancias.js'
import type { Config, Reconhecimento } from './tipos.js'

const runtimes = new Map<string, Runtime>()

// workspace visto por alguem ha pouco tempo e coletado no ritmo curto; o resto so mantem
// os alertas vivos no ritmo longo, em vez de martelar a API do n8n de todo mundo a cada 10s.
const INTERVALO_ATIVO_MS = 15000
const INTERVALO_OCIOSO_MS = 60000
const JANELA_ATIVIDADE_MS = 300000

export function criarRuntime(orgId: string): Runtime {
  let config = carregarConfigOrg(orgId)
  config = { ...config }
  const reconhecimentos = carregarReconhecimentosOrg(orgId)
  const repoTarefas = criarRepo({
    ler: async () => lerTarefasOrg(orgId),
    gravar: async (t) => gravarTarefasOrg(orgId, t),
  })
  const webhook = criarDispatcherWebhook({
    ler: async () => lerWebhookOrg(orgId),
    gravar: async (texto) => gravarWebhookOrg(orgId, texto),
    obterConfig: () => runtimeDe(orgId, false).config.webhook,
  })
  return {
    orgId,
    config,
    reconhecimentos,
    repoTarefas,
    webhook,
    pronto: Promise.resolve(),
    ultimoUso: 0,
    cacheCompleto: { em: 0, dados: null },
    cacheCron: new Map(),
    cronEmCurso: new Map(),
    cacheUptime: { em: 0, dados: null },
    coletaEmCurso: null,
  }
}

export function runtimeDe(orgId: string, marcarUso = true): Runtime {
  let rt = runtimes.get(orgId)
  if (!rt) {
    rt = criarRuntime(orgId)
    runtimes.set(orgId, rt)
    // carga unica; a memoria e a fonte da verdade daqui em diante. Reler a cada ciclo
    // desperdicava leitura e podia descartar uma escrita feita entre a mutacao e o salvar().
    rt.pronto = Promise.all([rt.repoTarefas.carregar(), rt.webhook.carregar()]).then(() => {}, () => {})
  }
  if (marcarUso) rt.ultimoUso = Date.now()
  return rt
}

export async function prepararRuntime(orgId: string) {
  const rt = runtimeDe(orgId)
  await rt.pronto
  if (!lerJsonWorkspace('workspace_config', orgId)) salvarConfigOrg(orgId, rt.config)
  return rt
}

export function persistirConfig(rt: Runtime) {
  salvarConfigOrg(rt.orgId, rt.config)
  descartarClientes(rt.orgId)
  rt.cacheCron.clear()
  rt.cacheUptime = { em: 0, dados: null }
  invalidarEstadoCompleto(rt)
}

export function persistirReconhecimentos(rt: Runtime) {
  salvarReconhecimentosOrg(rt.orgId, rt.reconhecimentos)
}

export function substituirConfig(rt: Runtime, config: Config) {
  rt.config = config
  persistirConfig(rt)
}

export function substituirReconhecimentos(rt: Runtime, reconhecimentos: Record<string, Reconhecimento>) {
  rt.reconhecimentos = reconhecimentos
  persistirReconhecimentos(rt)
}

let ciclo: Promise<void> | null = null

// o setInterval dispara mesmo com o ciclo anterior em andamento; sem esta guarda,
// uma rodada lenta fazia varias rodadas se empilharem sobre as mesmas instancias.
export function coletarWorkspaces() {
  if (ciclo) return ciclo
  ciclo = rodarCiclo().finally(() => { ciclo = null })
  return ciclo
}

async function rodarCiclo() {
  const ids = listarOrganizationIds()
  await Promise.all(ids.map(async (id) => {
    const rt = runtimeDe(id, false)
    await rt.pronto
    if (!rt.config.ativo) return
    if (!instanciasAtivas(rt.config).length && !rt.config.uptimeKuma.ativo) return
    const ativo = Date.now() - rt.ultimoUso < JANELA_ATIVIDADE_MS
    const intervalo = ativo ? INTERVALO_ATIVO_MS : INTERVALO_OCIOSO_MS
    if (rt.cacheCompleto.em && Date.now() - rt.cacheCompleto.em < intervalo) return
    await coletarCompleto(rt, true).catch((e) => console.error(`coleta ${id}:`, (e as Error).message || e))
  }))
}

export function momentoColeta() {
  let maisRecente: string | null = null
  for (const rt of runtimes.values()) {
    const momento = rt.cacheCompleto.dados?.momento
    if (typeof momento === 'string' && (!maisRecente || momento > maisRecente)) maisRecente = momento
  }
  return maisRecente
}

export { invalidarEstadoCompleto }
