import { randomUUID } from 'node:crypto'
import { fromNodeHeaders } from 'better-auth/node'
import type { IncomingHttpHeaders } from 'node:http'
import { auth } from './auth.js'
import { db } from './db.js'
import { importarLegadoSeHouver } from './persistencia.js'
import { prepararRuntime } from './workspace.js'

export function slugDe(nome: string) {
  const base = String(nome || 'workspace')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  return base || 'workspace'
}

export function precisaSetup() {
  try {
    const linha = db.prepare('SELECT COUNT(*) AS n FROM user').get() as { n: number } | undefined
    return !linha || linha.n === 0
  } catch {
    return true
  }
}

export async function sessaoDe(headers: IncomingHttpHeaders) {
  return auth.api.getSession({ headers: fromNodeHeaders(headers) })
}

export function papelNaOrg(userId: string, organizationId: string) {
  try {
    const linha = db.prepare('SELECT role FROM member WHERE userId = ? AND organizationId = ?').get(userId, organizationId) as { role: string } | undefined
    return linha?.role || null
  } catch {
    return null
  }
}

export function podeGerenciar(papel: string | null) {
  if (!papel) return false
  return papel.split(',').some((p) => ['owner', 'admin'].includes(p.trim()))
}

export async function executarSetup(opts: { nome: string; email: string; senha: string; workspace: string }) {
  const email = opts.email.trim().toLowerCase()
  const nome = opts.nome.trim().slice(0, 120)
  const workspace = (opts.workspace.trim() || 'Principal').slice(0, 120)
  if (!nome || !email || !opts.senha) throw new Error('nome, e-mail e senha são obrigatórios')
  if (opts.senha.length < 6) throw new Error('senha deve ter pelo menos 6 caracteres')
  if (!precisaSetup()) throw new Error('setup já foi concluído')

  const ctx = await auth.$context
  const user = await ctx.internalAdapter.createUser({
    email,
    name: nome,
    emailVerified: true,
    role: 'admin',
    mustChangePassword: false,
  })
  const hash = await ctx.password.hash(opts.senha)
  await ctx.internalAdapter.createAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: hash,
  })

  let slug = slugDe(workspace)
  const existe = db.prepare('SELECT id FROM organization WHERE slug = ?').get(slug)
  if (existe) slug = `${slug}-${randomUUID().slice(0, 8)}`
  const agora = new Date()
  const orgId = randomUUID()
  db.prepare(`
    INSERT INTO organization (id, name, slug, createdAt, metadata)
    VALUES (?, ?, ?, ?, ?)
  `).run(orgId, workspace, slug, agora.toISOString(), null)
  db.prepare(`
    INSERT INTO member (id, organizationId, userId, role, createdAt)
    VALUES (?, ?, ?, ?, ?)
  `).run(randomUUID(), orgId, user.id, 'owner', agora.toISOString())

  await importarLegadoSeHouver(orgId)
  await prepararRuntime(orgId)
  return { user, organizationId: orgId, email, senha: opts.senha }
}

export function listarWorkspacesDoUsuario(userId: string) {
  try {
    return db.prepare(`
      SELECT o.id, o.name, o.slug, m.role
      FROM member m
      JOIN organization o ON o.id = m.organizationId
      WHERE m.userId = ?
      ORDER BY o.createdAt ASC
    `).all(userId) as { id: string; name: string; slug: string; role: string }[]
  } catch {
    return []
  }
}

export function listarMembros(organizationId: string) {
  return db.prepare(`
    SELECT u.id, u.name, u.email, u.mustChangePassword, m.role, m.createdAt
    FROM member m
    JOIN user u ON u.id = m.userId
    WHERE m.organizationId = ?
    ORDER BY m.createdAt ASC
  `).all(organizationId) as {
    id: string; name: string; email: string; mustChangePassword: number | boolean
    role: string; createdAt: string
  }[]
}

export function convitePorId(id: string) {
  return db.prepare('SELECT * FROM invitation WHERE id = ?').get(id) as {
    id: string; email: string; role: string; status: string
    organizationId: string; inviterId: string; expiresAt: string
  } | undefined
}

export function marcarSenhaTrocada(userId: string) {
  try {
    db.prepare('UPDATE user SET mustChangePassword = 0 WHERE id = ?').run(userId)
  } catch {
    db.prepare('UPDATE user SET mustChangePassword = false WHERE id = ?').run(userId)
  }
}

export function precisaTrocarSenha(user: { mustChangePassword?: boolean | number | null }) {
  return user.mustChangePassword === true || user.mustChangePassword === 1
}
