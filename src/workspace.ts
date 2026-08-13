import { listarOrganizationIds } from './db.js'
import { instanciasAtivas } from './config.js'
import {
  carregarConfigOrg, carregarReconhecimentosOrg, gravarTarefasOrg, gravarWebhookOrg,
  lerTarefasOrg, lerWebhookOrg, salvarConfigOrg, salvarReconhecimentosOrg, semearInstanciaAmbiente,
} from './persistencia.js'
import { criarRepo } from './tarefas.js'
import { criarDispatcherWebhook } from './webhook.js'
import { coletarCompleto, invalidarEstadoCompleto, type Runtime } from './coleta.js'
import { descartarClientes } from './instancias.js'
import type { Config, Reconhecimento } from './tipos.js'

const runtimes = new Map<string, Runtime>()

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
    obterConfig: () => runtimeDe(orgId).config.webhook,
  })
  return {
    orgId,
    config,
    reconhecimentos,
    repoTarefas,
    webhook,
    cacheCompleto: { em: 0, dados: null },
    cacheCron: new Map(),
    cacheUptime: { em: 0, dados: null },
    coletaEmCurso: null,
  }
}

export function runtimeDe(orgId: string): Runtime {
  let rt = runtimes.get(orgId)
  if (!rt) {
    rt = criarRuntime(orgId)
    runtimes.set(orgId, rt)
    void rt.repoTarefas.carregar()
    void rt.webhook.carregar()
  }
  return rt
}

export async function prepararRuntime(orgId: string) {
  const rt = runtimeDe(orgId)
  await rt.repoTarefas.carregar()
  await rt.webhook.carregar()
  rt.config = await semearInstanciaAmbiente(rt.config)
  salvarConfigOrg(orgId, rt.config)
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

export async function coletarWorkspaces() {
  const ids = listarOrganizationIds()
  await Promise.all(ids.map(async (id) => {
    const rt = runtimeDe(id)
    await rt.repoTarefas.carregar().catch(() => {})
    await rt.webhook.carregar().catch(() => {})
    if (rt.config.ativo && (instanciasAtivas(rt.config).length || rt.config.uptimeKuma.ativo)) {
      await coletarCompleto(rt, true).catch((e) => console.error(`coleta ${id}:`, (e as Error).message || e))
    }
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
