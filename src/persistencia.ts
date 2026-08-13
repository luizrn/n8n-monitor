import { readFile } from 'node:fs/promises'
import {
  ARQ_CONFIG_LEGADO, ARQ_RECON_LEGADO, ARQ_TAREFAS_LEGADO, ARQ_WEBHOOK_LEGADO,
  gravarJsonWorkspace, legadoJaImportado, legadoJaImportadoEmAlgum, lerJsonWorkspace, marcarLegadoImportado,
} from './db.js'
import { migrar } from './config.js'
import { registroSeguro } from './seguranca.js'
import type { Config, Reconhecimento } from './tipos.js'

async function lerArquivo(caminho: string) {
  try {
    return await readFile(caminho, 'utf8')
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException)?.code === 'ENOENT') return null
    throw erro
  }
}

export function carregarConfigOrg(organizationId: string): Config {
  const json = lerJsonWorkspace('workspace_config', organizationId)
  if (!json) return migrar({})
  try {
    return migrar(JSON.parse(json) as Record<string, unknown>)
  } catch {
    return migrar({})
  }
}

export function salvarConfigOrg(organizationId: string, config: Config) {
  gravarJsonWorkspace('workspace_config', organizationId, JSON.stringify(config, null, 2))
}

export function carregarReconhecimentosOrg(organizationId: string) {
  const json = lerJsonWorkspace('workspace_reconhecimentos', organizationId)
  if (!json) return registroSeguro<Reconhecimento>()
  try {
    return registroSeguro<Reconhecimento>(JSON.parse(json))
  } catch {
    return registroSeguro<Reconhecimento>()
  }
}

export function salvarReconhecimentosOrg(organizationId: string, reconhecimentos: Record<string, Reconhecimento>) {
  gravarJsonWorkspace('workspace_reconhecimentos', organizationId, JSON.stringify(reconhecimentos, null, 2))
}

export function lerTarefasOrg(organizationId: string) {
  return lerJsonWorkspace('workspace_tarefas', organizationId) || '{}'
}

export function gravarTarefasOrg(organizationId: string, json: string) {
  gravarJsonWorkspace('workspace_tarefas', organizationId, json)
}

export function lerWebhookOrg(organizationId: string) {
  return lerJsonWorkspace('workspace_webhook', organizationId) || '{}'
}

export function gravarWebhookOrg(organizationId: string, json: string) {
  gravarJsonWorkspace('workspace_webhook', organizationId, json)
}

export async function importarLegadoSeHouver(organizationId: string) {
  if (legadoJaImportado(organizationId)) return false
  if (legadoJaImportadoEmAlgum()) {
    if (!lerJsonWorkspace('workspace_config', organizationId)) salvarConfigOrg(organizationId, migrar({}))
    return false
  }
  const jaTem = Boolean(lerJsonWorkspace('workspace_config', organizationId))
  const configTxt = await lerArquivo(ARQ_CONFIG_LEGADO)
  if (!configTxt && !jaTem) {
    salvarConfigOrg(organizationId, await semearInstanciaAmbiente(migrar({})))
    marcarLegadoImportado(organizationId)
    return false
  }
  if (jaTem) {
    marcarLegadoImportado(organizationId)
    return false
  }
  if (configTxt) {
    try {
      salvarConfigOrg(organizationId, await semearInstanciaAmbiente(migrar(JSON.parse(configTxt) as Record<string, unknown>)))
    } catch {
      salvarConfigOrg(organizationId, migrar({}))
    }
  } else {
    salvarConfigOrg(organizationId, migrar({}))
  }
  const recon = await lerArquivo(ARQ_RECON_LEGADO)
  if (recon) gravarJsonWorkspace('workspace_reconhecimentos', organizationId, recon)
  const tarefas = await lerArquivo(ARQ_TAREFAS_LEGADO)
  if (tarefas) gravarJsonWorkspace('workspace_tarefas', organizationId, tarefas)
  const webhook = await lerArquivo(ARQ_WEBHOOK_LEGADO)
  if (webhook) gravarJsonWorkspace('workspace_webhook', organizationId, webhook)
  marcarLegadoImportado(organizationId)
  return true
}

export async function semearInstanciaAmbiente(config: Config) {
  if (config.instancias.length) return config
  const chave = process.env.N8N_API_KEY || ''
  if (!chave) return config
  config.instancias = [{
    id: 'principal',
    nome: 'Principal',
    baseUrl: (process.env.N8N_BASE_URL || 'http://localhost:5678').replace(/\/+$/, ''),
    apiKey: chave,
    ativo: true,
  }]
  return config
}
