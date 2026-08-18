import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = resolve(AQUI, '..')

export const DIR_DADOS = process.env.N8N_MONITOR_DATA_DIR
  ? resolve(process.env.N8N_MONITOR_DATA_DIR)
  : join(process.env.LOCALAPPDATA || process.env.HOME || RAIZ, 'n8n-monitor')

export const ARQ_SQLITE = join(DIR_DADOS, 'n8n-monitor.sqlite')
export const ARQ_CONFIG_LEGADO = join(DIR_DADOS, 'config.json')
export const ARQ_RECON_LEGADO = join(DIR_DADOS, 'reconhecimentos.json')
export const ARQ_TAREFAS_LEGADO = join(DIR_DADOS, 'tarefas.json')
export const ARQ_WEBHOOK_LEGADO = join(DIR_DADOS, 'webhook-estado.json')

mkdirSync(DIR_DADOS, { recursive: true })

export const db = new DatabaseSync(ARQ_SQLITE)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')
// backup ou segundo processo tocando o arquivo nao vira erro imediato de banco ocupado
db.exec('PRAGMA busy_timeout = 5000')

db.exec(`
CREATE TABLE IF NOT EXISTS workspace_config (
  organization_id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_tarefas (
  organization_id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_reconhecimentos (
  organization_id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_webhook (
  organization_id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS legado_importado (
  organization_id TEXT PRIMARY KEY,
  em TEXT NOT NULL
);
`)

export function agoraIso() {
  return new Date().toISOString()
}

export function lerJsonWorkspace(tabela: string, organizationId: string) {
  const linha = db.prepare(`SELECT json FROM ${tabela} WHERE organization_id = ?`).get(organizationId) as { json: string } | undefined
  return linha?.json ?? null
}

export function gravarJsonWorkspace(tabela: string, organizationId: string, json: string) {
  db.prepare(`
    INSERT INTO ${tabela} (organization_id, json, atualizado_em)
    VALUES (?, ?, ?)
    ON CONFLICT(organization_id) DO UPDATE SET json = excluded.json, atualizado_em = excluded.atualizado_em
  `).run(organizationId, json, agoraIso())
}

export function listarOrganizationIds() {
  const linhas = db.prepare('SELECT organization_id FROM workspace_config').all() as { organization_id: string }[]
  const ids = new Set(linhas.map((l) => l.organization_id))
  try {
    const orgs = db.prepare('SELECT id FROM organization').all() as { id: string }[]
    for (const o of orgs) ids.add(o.id)
  } catch { /* tabela Better Auth ainda nao existe */ }
  return [...ids]
}

export function legadoJaImportado(organizationId: string) {
  return Boolean(db.prepare('SELECT 1 FROM legado_importado WHERE organization_id = ?').get(organizationId))
}

export function legadoJaImportadoEmAlgum() {
  return Boolean(db.prepare('SELECT 1 FROM legado_importado LIMIT 1').get())
}

export function marcarLegadoImportado(organizationId: string) {
  db.prepare('INSERT OR REPLACE INTO legado_importado (organization_id, em) VALUES (?, ?)').run(organizationId, agoraIso())
}
