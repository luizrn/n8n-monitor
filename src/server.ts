import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node'
import { auth, migrarAuth } from './auth.js'
import { ARQ_SQLITE, DIR_DADOS, db } from './db.js'
import {
  configPublica, destinoConfigurado, idsUnicos, instanciasAtivas, instanciaPorId,
  numeroLimitado, publica, saneaDestino, saneaInstancia, saneaLimitesTravada,
} from './config.js'
import {
  clienteDe, coletarCompleto, conferirAgendamentos, criarCliente, invalidarEstadoCompleto,
  montarDiagnostico, percentil, recentesDeTodas, rdap, uptimeAtual,
} from './coleta.js'
import { coletarUptime } from './uptime.js'
import { ESTADOS as ESTADOS_TAREFA, normalizarEstado } from './tarefas.js'
import { chaveDeRegistroValida, registroSeguro, urlHttpValida } from './seguranca.js'
import { coletarWorkspaces, momentoColeta, persistirConfig, persistirReconhecimentos,
  prepararRuntime, runtimeDe,
} from './workspace.js'
import { importarLegadoSeHouver } from './persistencia.js'
import {
  convitePorId, executarSetup, listarMembros, listarWorkspacesDoUsuario, marcarSenhaTrocada,
  papelNaOrg, podeGerenciar, precisaSetup, precisaTrocarSenha, sessaoDe, slugDe,
} from './contas.js'
import { copiarCookies, ErroHttp, json, lerCorpo, redirecionar } from './http.js'
import { VERSAO } from './versao.js'
import { randomUUID } from 'node:crypto'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = resolve(AQUI, '..')
const PORTA = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '127.0.0.1'
const authHandler = toNodeHandler(auth)

const PAGINAS_PUBLICAS = new Set(['/login', '/setup', '/aceitar-convite', '/trocar-senha'])
const ARQUIVOS_PUBLICOS = new Set(['theme.js', 'i18n.js', 'toasts.js', 'sessao.js', 'base.css'])
const PAGINAS: Record<string, string> = {
  '/': 'index.html',
  '/dashboard': 'dashboard.html',
  '/logs': 'logs.html',
  '/tarefas': 'tarefas.html',
  '/login': 'login.html',
  '/setup': 'setup.html',
  '/aceitar-convite': 'aceitar-convite.html',
  '/trocar-senha': 'trocar-senha.html',
}
const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
}

const ehHtml = (pathname: string) => pathname in PAGINAS || pathname === '/'
const ehPublico = (pathname: string) => {
  if (pathname === '/api/health' || pathname === '/favicon.ico') return true
  if (pathname === '/api/setup' || pathname === '/api/setup-status') return true
  if (pathname.startsWith('/api/auth')) return true
  if (pathname === '/api/convite/aceitar' || pathname === '/api/convite/info') return true
  if (PAGINAS_PUBLICAS.has(pathname)) return true
  const arquivo = pathname.replace(/^\/+/, '')
  return ARQUIVOS_PUBLICOS.has(arquivo)
}

async function servirEstatico(res: ServerResponse, pathname: string) {
  const alvo = PAGINAS[pathname] || pathname.replace(/^\/+/, '')
  const raizPublic = join(RAIZ, 'public')
  const caminho = resolve(raizPublic, alvo)
  if (!(caminho.startsWith(raizPublic + sep) || caminho === raizPublic)) return false
  try {
    const conteudo = await readFile(caminho)
    const ext = caminho.slice(caminho.lastIndexOf('.'))
    res.writeHead(200, {
      'content-type': TIPOS[ext] || 'application/octet-stream',
      'cache-control': 'no-store',
    })
    res.end(conteudo)
    return true
  } catch {
    return false
  }
}

const servidor = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('x-frame-options', 'DENY')
  res.setHeader('referrer-policy', 'no-referrer')
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")

  try {
    if (url.pathname === '/api/health' && req.method === 'GET') {
      return json(res, 200, { ok: true, versao: VERSAO, uptimeSeg: Math.round(process.uptime()), coletaEm: momentoColeta() })
    }
    if (url.pathname === '/favicon.ico' && req.method === 'GET') {
      res.writeHead(204, { 'cache-control': 'public, max-age=86400' })
      return res.end()
    }
    if (url.pathname.startsWith('/api/auth')) {
      return authHandler(req, res)
    }
    if (url.pathname === '/api/setup-status' && req.method === 'GET') {
      return json(res, 200, { ok: true, precisaSetup: precisaSetup() })
    }
    if (url.pathname === '/api/setup' && req.method === 'POST') {
      const corpo = await lerCorpo(req)
      const criado = await executarSetup({
        nome: String(corpo.nome || ''),
        email: String(corpo.email || ''),
        senha: String(corpo.senha || ''),
        workspace: String(corpo.workspace || 'Principal'),
      })
      const resposta = await auth.api.signInEmail({
        body: { email: criado.email, password: criado.senha },
        asResponse: true,
      })
      copiarCookies(resposta.headers, res)
      await auth.api.setActiveOrganization({
        body: { organizationId: criado.organizationId },
        headers: fromNodeHeaders({ ...req.headers, cookie: resposta.headers.get('set-cookie') || req.headers.cookie }),
      }).catch(() => {})
      return json(res, 200, { ok: true, organizationId: criado.organizationId })
    }
    if (url.pathname === '/api/convite/info' && req.method === 'GET') {
      const convite = convitePorId(String(url.searchParams.get('id') || ''))
      if (!convite || convite.status !== 'pending') return json(res, 404, { ok: false, erro: 'convite inválido' })
      if (new Date(convite.expiresAt).getTime() < Date.now()) return json(res, 410, { ok: false, erro: 'convite expirado' })
      const org = (await import('./db.js')).db.prepare('SELECT name FROM organization WHERE id = ?').get(convite.organizationId) as { name: string } | undefined
      return json(res, 200, { ok: true, email: convite.email, workspace: org?.name || '', role: convite.role })
    }
    if (url.pathname === '/api/convite/aceitar' && req.method === 'POST') {
      const corpo = await lerCorpo(req)
      const convite = convitePorId(String(corpo.id || ''))
      if (!convite || convite.status !== 'pending') throw new ErroHttp(404, 'convite inválido')
      if (new Date(convite.expiresAt).getTime() < Date.now()) throw new ErroHttp(410, 'convite expirado')
      const ctx = await auth.$context
      let userId: string
      const existente = ctx.internalAdapter.findUserByEmail
        ? await ctx.internalAdapter.findUserByEmail(convite.email)
        : null
      if (existente?.user?.id) {
        userId = existente.user.id
      } else {
        const senha = String(corpo.senha || '')
        const nome = String(corpo.nome || convite.email).trim().slice(0, 120)
        if (senha.length < 6) throw new ErroHttp(400, 'senha deve ter pelo menos 6 caracteres')
        const user = await ctx.internalAdapter.createUser({
          email: convite.email,
          name: nome,
          emailVerified: true,
          role: 'user',
          mustChangePassword: false,
        })
        const hash = await ctx.password.hash(senha)
        await ctx.internalAdapter.createAccount({
          userId: user.id, providerId: 'credential', accountId: user.id, password: hash,
        })
        userId = user.id
      }
      const agora = new Date().toISOString()
      dbMemberInsert(convite.organizationId, userId, convite.role, agora)
      ;(await import('./db.js')).db.prepare("UPDATE invitation SET status = 'accepted' WHERE id = ?").run(convite.id)
      await prepararRuntime(convite.organizationId)
      const senhaLogin = String(corpo.senha || '')
      if (senhaLogin) {
        const resposta = await auth.api.signInEmail({
          body: { email: convite.email, password: senhaLogin },
          asResponse: true,
        })
        copiarCookies(resposta.headers, res)
      }
      return json(res, 200, { ok: true, organizationId: convite.organizationId })
    }

    if (PAGINAS_PUBLICAS.has(url.pathname) && req.method === 'GET') {
      if (url.pathname === '/setup' && !precisaSetup()) return redirecionar(res, '/login')
      if (url.pathname === '/login' && precisaSetup()) return redirecionar(res, '/setup')
      if (await servirEstatico(res, url.pathname)) return
    }
    const arquivo = url.pathname.replace(/^\/+/, '')
    if (ARQUIVOS_PUBLICOS.has(arquivo) && ['GET', 'HEAD'].includes(req.method || '')) {
      if (await servirEstatico(res, url.pathname)) return
    }

    if (!ehPublico(url.pathname)) {
      const session = await sessaoDe(req.headers)
      if (!session) {
        if (ehHtml(url.pathname) && req.method === 'GET') return redirecionar(res, precisaSetup() ? '/setup' : '/login')
        return json(res, 401, { ok: false, erro: 'não autenticado' })
      }
      if (precisaTrocarSenha(session.user) && url.pathname !== '/trocar-senha' && url.pathname !== '/api/conta/senha' && url.pathname !== '/api/sessao') {
        if (ehHtml(url.pathname)) return redirecionar(res, '/trocar-senha')
        return json(res, 403, { ok: false, motivo: 'trocar-senha' })
      }

      const orgId = session.session.activeOrganizationId as string | undefined
      const headers = fromNodeHeaders(req.headers)

      if (url.pathname === '/api/sessao' && req.method === 'GET') {
        const workspaces = listarWorkspacesDoUsuario(session.user.id)
        return json(res, 200, {
          ok: true,
          usuario: { id: session.user.id, nome: session.user.name, email: session.user.email, admin: session.user.role === 'admin' },
          workspaces,
          ativo: orgId || null,
          papel: orgId ? papelNaOrg(session.user.id, orgId) : null,
          mustChangePassword: precisaTrocarSenha(session.user),
          precisaSetup: false,
          versao: VERSAO,
        })
      }

      if (url.pathname === '/api/conta/senha' && req.method === 'POST') {
        const corpo = await lerCorpo(req)
        await auth.api.changePassword({
          body: { currentPassword: String(corpo.atual || ''), newPassword: String(corpo.nova || '') },
          headers,
        })
        marcarSenhaTrocada(session.user.id)
        return json(res, 200, { ok: true })
      }

      if (url.pathname === '/api/workspace' && req.method === 'POST') {
        const corpo = await lerCorpo(req)
        const nome = String(corpo.nome || '').trim().slice(0, 120)
        if (!nome) throw new ErroHttp(400, 'nome é obrigatório')
        const criado = await auth.api.createOrganization({
          body: { name: nome, slug: `${slugDe(nome)}-${randomUUID().slice(0, 6)}` },
          headers,
        })
        const novoId = (criado as { id?: string })?.id
        if (novoId) {
          await importarLegadoSeHouver(novoId)
          await prepararRuntime(novoId)
          await auth.api.setActiveOrganization({ body: { organizationId: novoId }, headers })
        }
        return json(res, 200, { ok: true, workspace: criado })
      }

      if (url.pathname === '/api/workspace/ativar' && req.method === 'POST') {
        const corpo = await lerCorpo(req)
        const id = String(corpo.id || '')
        if (!papelNaOrg(session.user.id, id)) throw new ErroHttp(403, 'sem acesso a este workspace')
        await auth.api.setActiveOrganization({ body: { organizationId: id }, headers })
        await prepararRuntime(id)
        return json(res, 200, { ok: true })
      }

      if (!orgId) {
        if (ehHtml(url.pathname) && req.method === 'GET') {
          if (await servirEstatico(res, url.pathname)) return
        }
        if (url.pathname.startsWith('/api/')) return json(res, 403, { ok: false, motivo: 'sem-workspace' })
      }

      const rt = orgId ? runtimeDe(orgId) : null
      const papel = orgId ? papelNaOrg(session.user.id, orgId) : null

      if (url.pathname === '/api/usuarios' && req.method === 'GET') {
        if (!orgId) throw new ErroHttp(403, 'sem workspace')
        if (!podeGerenciar(papel)) throw new ErroHttp(403, 'sem permissão')
        return json(res, 200, {
          ok: true,
          itens: listarMembros(orgId).map((m) => ({
            id: m.id, nome: m.name, email: m.email, papel: m.role,
            mustChangePassword: Boolean(m.mustChangePassword),
          })),
        })
      }

      if (url.pathname === '/api/usuarios' && req.method === 'POST') {
        if (!orgId || !podeGerenciar(papel)) throw new ErroHttp(403, 'sem permissão')
        const corpo = await lerCorpo(req)
        const criado = await auth.api.createUser({
          body: {
            email: String(corpo.email || '').trim().toLowerCase(),
            password: String(corpo.senha || ''),
            name: String(corpo.nome || '').trim(),
            role: 'user',
            data: { mustChangePassword: corpo.mustChangePassword !== false },
          },
          headers,
        })
        const userId = (criado as { user?: { id: string } }).user?.id
        if (userId) dbMemberInsert(orgId, userId, String(corpo.papel || 'member'), new Date().toISOString())
        return json(res, 200, { ok: true, usuario: criado })
      }

      if (url.pathname === '/api/convite' && req.method === 'POST') {
        if (!orgId || !podeGerenciar(papel)) throw new ErroHttp(403, 'sem permissão')
        const corpo = await lerCorpo(req)
        const convite = await auth.api.createInvitation({
          body: {
            email: String(corpo.email || '').trim().toLowerCase(),
            role: (['owner', 'admin', 'member'].includes(String(corpo.papel)) ? String(corpo.papel) : 'member') as 'admin' | 'member',
            organizationId: orgId,
          },
          headers,
        })
        const id = (convite as { id?: string })?.id
        return json(res, 200, { ok: true, convite, link: id ? `/aceitar-convite?id=${encodeURIComponent(id)}` : null })
      }

      if (!rt || !orgId) {
        if (['GET', 'HEAD'].includes(req.method || '') && await servirEstatico(res, url.pathname)) return
        throw new ErroHttp(403, 'sem workspace')
      }

      if (url.pathname === '/api/fluxos' && req.method === 'GET') {
        const ativas = instanciasAtivas(rt.config)
        const lotes = await Promise.all(ativas.map(async (inst) => {
          try {
            const nomes = await clienteDe(inst, rt.orgId).nomesDeFluxos()
            return [...nomes.entries()].map(([id, nome]) => ({
              instanciaId: inst.id, instancia: inst.nome, id, nome,
            }))
          } catch { return [] }
        }))
        return json(res, 200, {
          ok: true,
          itens: lotes.flat().sort((a, b) => a.instancia.localeCompare(b.instancia) || a.nome.localeCompare(b.nome)),
        })
      }

      if (url.pathname === '/api/config' && req.method === 'GET') {
        return json(res, 200, configPublica(rt.config, rt.webhook))
      }

      if (url.pathname === '/api/config' && req.method === 'POST') {
        const corpo = await lerCorpo(req)
        if (Array.isArray(corpo.instancias)) {
          const antigas = new Map(rt.config.instancias.map((i) => [i.id, i]))
          const novas = (corpo.instancias as Record<string, unknown>[]).slice(0, 100).map((cru, i) => {
            const s = saneaInstancia(cru, i)
            if (!s.apiKey) s.apiKey = antigas.get(s.id)?.apiKey || ''
            if (s.baseUrl && !urlHttpValida(s.baseUrl)) throw new ErroHttp(400, `URL inválida na instância ${s.nome}`)
            return s
          })
          const vistos = new Set<string>()
          for (const inst of novas) {
            let id = inst.id, n = 2
            while (vistos.has(id)) id = `${inst.id}-${n++}`
            inst.id = id
            vistos.add(id)
          }
          rt.config.instancias = novas
        }
        if (typeof corpo.ativo === 'boolean') rt.config.ativo = corpo.ativo
        if (['pt-BR', 'en'].includes(String(corpo.idioma))) rt.config.idioma = corpo.idioma as 'pt-BR' | 'en'
        if (['escuro', 'claro'].includes(String(corpo.tema))) rt.config.tema = corpo.tema as 'escuro' | 'claro'
        if (corpo.limiteTravadaMin !== undefined) {
          rt.config.limiteTravadaMin = numeroLimitado(corpo.limiteTravadaMin, 1, 1440, rt.config.limiteTravadaMin)
        }
        if (corpo.limitesTravada && typeof corpo.limitesTravada === 'object') {
          rt.config.limitesTravada = saneaLimitesTravada(corpo.limitesTravada)
        }
        if (corpo.notificacoes && typeof corpo.notificacoes === 'object') {
          const n = corpo.notificacoes as Record<string, unknown>
          rt.config.notificacoes = {
            toastSeg: numeroLimitado(n.toastSeg, 0, 600, rt.config.notificacoes.toastSeg),
            navegador: Boolean(n.navegador),
            som: Boolean(n.som),
            volume: numeroLimitado(n.volume, 0, 1, rt.config.notificacoes.volume),
          }
        }
        if (corpo.uptimeKuma && typeof corpo.uptimeKuma === 'object') {
          const u = corpo.uptimeKuma as Record<string, unknown>
          const atual = rt.config.uptimeKuma
          const novaUptime = {
            ativo: typeof u.ativo === 'boolean' ? u.ativo : atual.ativo,
            baseUrl: typeof u.baseUrl === 'string' ? u.baseUrl.trim().replace(/\/+$/, '') : atual.baseUrl,
            token: typeof u.token === 'string' && u.token.trim() ? u.token.trim() : atual.token,
            slug: typeof u.slug === 'string' ? u.slug.trim() : atual.slug,
            monitores: u.monitores && typeof u.monitores === 'object' ? registroSeguro(u.monitores) as Record<string, boolean> : atual.monitores,
            avisarCertDias: numeroLimitado(u.avisarCertDias, 1, 365, atual.avisarCertDias),
          }
          if (novaUptime.baseUrl && !urlHttpValida(novaUptime.baseUrl)) throw new ErroHttp(400, 'URL inválida do Uptime Kuma')
          rt.config.uptimeKuma = novaUptime
          rt.cacheUptime = { em: 0, dados: null }
        }
        if (corpo.webhook && typeof corpo.webhook === 'object') {
          const w = corpo.webhook as Record<string, unknown>
          if (Array.isArray(w.destinos)) {
            const antigos = new Map(rt.config.webhook.destinos.map((d) => [d.id, d]))
            const destinos = idsUnicos((w.destinos as Record<string, unknown>[]).slice(0, 50).map((cru, i) => {
              const anterior = (antigos.get(String(cru?.id || '').trim()) || {}) as Record<string, unknown>
              return saneaDestino({
                ...anterior, ...cru,
                url: String(cru?.url || '').trim() || anterior.url,
                bearer: String(cru?.bearer || '').trim() || anterior.bearer,
                headerValor: String(cru?.headerValor || '').trim() || anterior.headerValor,
                evolutionApiKey: String(cru?.evolutionApiKey || '').trim() || anterior.evolutionApiKey,
                discordUrl: String(cru?.discordUrl || '').trim() || anterior.discordUrl,
              }, i)
            }).filter(destinoConfigurado))
            for (const destino of destinos) {
              const urls = [destino.url, destino.evolutionUrl, destino.discordUrl].filter(Boolean)
              if (urls.some((valor) => !urlHttpValida(valor))) throw new ErroHttp(400, `URL inválida no destino ${destino.nome}`)
            }
            rt.config.webhook = { destinos }
          }
        }
        persistirConfig(rt)
        return json(res, 200, { salvo: true, instancias: rt.config.instancias.map(publica) })
      }

      if (url.pathname === '/api/teste' && req.method === 'POST') {
        const corpo = await lerCorpo(req)
        const salva = corpo.id ? instanciaPorId(rt.config, String(corpo.id)) : null
        const alvo = (corpo.baseUrl || corpo.apiKey)
          ? saneaInstancia({ ...salva, ...corpo, apiKey: corpo.apiKey || salva?.apiKey || '' }, 0)
          : (salva || instanciasAtivas(rt.config)[0])
        if (!alvo) return json(res, 200, { ok: false, erro: 'instância não encontrada' })
        try {
          await criarCliente(alvo).chamar('/api/v1/workflows?limit=1')
          return json(res, 200, { ok: true, nome: alvo.nome })
        } catch (e) {
          return json(res, 200, { ok: false, nome: alvo.nome, erro: String((e as Error).message || e) })
        }
      }

      if (url.pathname === '/api/uptime' && req.method === 'GET') {
        try {
          return json(res, 200, await uptimeAtual(rt, Boolean(url.searchParams.get('recarregar'))))
        } catch (e) {
          return json(res, 200, { ok: false, motivo: 'erro', detalhe: String((e as Error).message || e) })
        }
      }

      if (url.pathname === '/api/uptime/teste' && req.method === 'POST') {
        const c = await lerCorpo(req)
        const cfg = {
          baseUrl: String(c.baseUrl || rt.config.uptimeKuma.baseUrl || '').trim().replace(/\/+$/, ''),
          token: String(c.token || '').trim() || rt.config.uptimeKuma.token,
          slug: String(c.slug ?? rt.config.uptimeKuma.slug ?? '').trim(),
          monitores: rt.config.uptimeKuma.monitores,
          avisarCertDias: rt.config.uptimeKuma.avisarCertDias,
        }
        try {
          const d = await coletarUptime(cfg) as Record<string, unknown> & { ok?: boolean; monitores?: { ativo?: boolean; host?: string | null; url?: string | null }[] }
          if (d.ok) d.dominios = await rdap.enriquecer(d.monitores || [])
          return json(res, 200, d)
        } catch (e) {
          return json(res, 200, { ok: false, motivo: 'erro', detalhe: String((e as Error).message || e) })
        }
      }

      if (url.pathname === '/api/webhook/teste' && req.method === 'POST') {
        const c = await lerCorpo(req)
        const anterior = rt.config.webhook.destinos.find((d) => d.id === c.id) || {}
        const cfg = saneaDestino({
          ...anterior, ...c,
          url: String(c.url || '').trim() || (anterior as { url?: string }).url,
          bearer: String(c.bearer || '').trim() || (anterior as { bearer?: string }).bearer,
          headerValor: String(c.headerValor || '').trim() || (anterior as { headerValor?: string }).headerValor,
          evolutionApiKey: String(c.evolutionApiKey || '').trim() || (anterior as { evolutionApiKey?: string }).evolutionApiKey,
          discordUrl: String(c.discordUrl || '').trim() || (anterior as { discordUrl?: string }).discordUrl,
        }, 0)
        return json(res, 200, await rt.webhook.testar(cfg))
      }

      if (url.pathname === '/api/state' && req.method === 'GET') {
        if (!rt.config.ativo) return json(res, 200, { ok: false, motivo: 'pausado' })
        if (!instanciasAtivas(rt.config).length && !rt.config.uptimeKuma.ativo) return json(res, 200, { ok: false, motivo: 'sem-chave' })
        try {
          return json(res, 200, await coletarCompleto(rt, Boolean(url.searchParams.get('recarregar'))))
        } catch (e) {
          return json(res, 200, { ok: false, motivo: 'erro-api', detalhe: String((e as Error).message || e) })
        }
      }

      if (url.pathname === '/api/reconhecer' && req.method === 'POST') {
        const c = await lerCorpo(req)
        if (!chaveDeRegistroValida(c.chave)) return json(res, 400, { ok: false, erro: 'chave inválida' })
        if (!c.estado) {
          delete rt.reconhecimentos[String(c.chave)]
          await rt.repoTarefas.remover(String(c.chave))
        } else if (c.estado === 'analise') {
          rt.reconhecimentos[String(c.chave)] = {
            estado: 'analise', magnitude: numeroLimitado(c.magnitude, 1, 1e9, 1),
            instanciaId: (c.alerta as { instanciaId?: string } | undefined)?.instanciaId || null,
            origem: (c.alerta as { origem?: string } | undefined)?.origem || null,
            em: new Date().toISOString(),
          }
          await rt.repoTarefas.abrir({ ...((c.alerta as object) || {}), chave: c.chave, magnitude: c.magnitude })
        } else {
          rt.reconhecimentos[String(c.chave)] = {
            estado: 'resolvido', magnitude: numeroLimitado(c.magnitude, 1, 1e9, 1),
            instanciaId: (c.alerta as { instanciaId?: string } | undefined)?.instanciaId || null,
            origem: (c.alerta as { origem?: string } | undefined)?.origem || null,
            em: new Date().toISOString(),
          }
          rt.webhook.resolver((c.alerta as Record<string, unknown>) || { chave: c.chave }, 'manual').catch(() => {})
        }
        persistirReconhecimentos(rt)
        invalidarEstadoCompleto(rt)
        return json(res, 200, {
          ok: true, reconhecimentos: rt.reconhecimentos,
          tarefasAtivas: rt.repoTarefas.chavesAtivas(),
          tarefasContagem: rt.repoTarefas.contagem(),
        })
      }

      if (url.pathname === '/api/tarefas' && req.method === 'GET') {
        return json(res, 200, {
          ok: true,
          estados: ESTADOS_TAREFA,
          itens: rt.repoTarefas.lista(),
          contagem: rt.repoTarefas.contagem(),
          instancias: rt.config.instancias.map(publica),
        })
      }

      if (url.pathname === '/api/tarefas' && req.method === 'POST') {
        const c = await lerCorpo(req)
        if (!chaveDeRegistroValida(c.chave)) return json(res, 400, { ok: false, erro: 'chave inválida' })
        if (c.acao === 'remover') {
          await rt.repoTarefas.remover(String(c.chave))
          delete rt.reconhecimentos[String(c.chave)]
          persistirReconhecimentos(rt)
        } else {
          const t = await rt.repoTarefas.mover(String(c.chave), normalizarEstado(c.estado), c.nota as string | undefined)
          if (!t) return json(res, 404, { ok: false, erro: 'tarefa não encontrada' })
          rt.reconhecimentos[String(c.chave)] = {
            estado: t.estado === 'resolvido' ? 'resolvido' : 'analise',
            magnitude: Number(t.magnitude || 1),
            instanciaId: t.instanciaId || null, origem: t.origem || null,
            em: new Date().toISOString(),
          }
          persistirReconhecimentos(rt)
          if (t.estado === 'resolvido') rt.webhook.resolver(t as unknown as Record<string, unknown>, 'manual').catch(() => {})
        }
        invalidarEstadoCompleto(rt)
        return json(res, 200, { ok: true, itens: rt.repoTarefas.lista(), contagem: rt.repoTarefas.contagem() })
      }

      if (url.pathname === '/api/logs' && req.method === 'GET') {
        if (!instanciasAtivas(rt.config).length) return json(res, 200, { ok: false, motivo: 'sem-chave' })
        const { itens, truncado, falhas } = await recentesDeTodas(rt)
        const q = (url.searchParams.get('q') || '').trim().toLowerCase()
        const status = (url.searchParams.get('status') || '').split(',').filter(Boolean)
        const modo = (url.searchParams.get('modo') || '').split(',').filter(Boolean)
        const insts = (url.searchParams.get('instancias') || '').split(',').filter(Boolean)
        const horas = numeroLimitado(url.searchParams.get('horas'), 0, 168, 0)
        const pagina = Math.floor(numeroLimitado(url.searchParams.get('pagina'), 0, 1e6, 0))
        const porPagina = Math.floor(numeroLimitado(url.searchParams.get('limite'), 10, 500, 100))
        const corte = horas ? Date.now() - horas * 3600000 : null
        const filtrados = itens.filter((e) => {
          if (status.length && !status.includes(String(e.status))) return false
          if (modo.length && !modo.includes(String(e.modo))) return false
          if (insts.length && !insts.includes(String(e.instanciaId))) return false
          if (corte && (!e.inicio || new Date(String(e.inicio)).getTime() < corte)) return false
          if (!q) return true
          return String(e.fluxo).toLowerCase().includes(q) || String(e.id).includes(q)
        })
        const porStatus: Record<string, number> = {}, porModo: Record<string, number> = {}, porInstancia: Record<string, number> = {}
        for (const e of filtrados) {
          porStatus[String(e.status)] = (porStatus[String(e.status)] || 0) + 1
          porModo[String(e.modo)] = (porModo[String(e.modo)] || 0) + 1
          porInstancia[String(e.instanciaId)] = (porInstancia[String(e.instanciaId)] || 0) + 1
        }
        return json(res, 200, {
          ok: true, total: filtrados.length, universo: itens.length, truncado, falhas,
          pagina, porPagina, porStatus, porModo, porInstancia,
          instancias: rt.config.instancias.map(publica),
          itens: filtrados.slice(pagina * porPagina, (pagina + 1) * porPagina),
        })
      }

      if (url.pathname === '/api/dashboard' && req.method === 'GET') {
        if (!instanciasAtivas(rt.config).length) return json(res, 200, { ok: false, motivo: 'sem-chave' })
        const horas = numeroLimitado(url.searchParams.get('horas'), 1, 168, 24)
        const paginas = horas <= 2 ? 10 : horas <= 12 ? 30 : 60
        const { itens, truncado } = await recentesDeTodas(rt, paginas)
        const insts = (url.searchParams.get('instancias') || '').split(',').filter(Boolean)
        const agora = Date.now()
        const corte = agora - horas * 3600000
        const janela = itens.filter((e) => e.inicio && new Date(String(e.inicio)).getTime() >= corte)
          .filter((e) => !insts.length || insts.includes(String(e.instanciaId)))
        const passoMin = horas <= 2 ? 1 : horas <= 12 ? 10 : 60
        const passoMs = passoMin * 60000
        const baldes = new Map<number, { t: string; ok: number; erro: number }>()
        for (let t = Math.floor(corte / passoMs) * passoMs; t <= agora; t += passoMs) {
          baldes.set(t, { t: new Date(t).toISOString(), ok: 0, erro: 0 })
        }
        const ehErro = (s: unknown) => s === 'error' || s === 'crashed'
        for (const e of janela) {
          const t = Math.floor(new Date(String(e.inicio)).getTime() / passoMs) * passoMs
          const b = baldes.get(t)
          if (b) b[ehErro(e.status) ? 'erro' : 'ok']++
        }
        const porFluxo = new Map<string, { workflowId: unknown; fluxo: unknown; instanciaId: unknown; instancia: unknown; total: number; erros: number; duracoes: number[] }>()
        for (const e of janela) {
          const k = `${e.instanciaId}|${e.workflowId}`
          const v = porFluxo.get(k) || {
            workflowId: e.workflowId, fluxo: e.fluxo, instanciaId: e.instanciaId, instancia: e.instancia,
            total: 0, erros: 0, duracoes: [],
          }
          v.total++
          if (ehErro(e.status)) v.erros++
          if (e.duracaoMs != null) v.duracoes.push(Number(e.duracaoMs))
          porFluxo.set(k, v)
        }
        const fluxos = [...porFluxo.values()].map((f) => ({
          workflowId: f.workflowId, fluxo: f.fluxo, instanciaId: f.instanciaId, instancia: f.instancia,
          total: f.total, erros: f.erros, taxaErro: f.total ? f.erros / f.total : 0,
          medianaMs: percentil(f.duracoes, 50), p95Ms: percentil(f.duracoes, 95),
        }))
        const porStatus: Record<string, number> = {}, porModo: Record<string, number> = {}, porInstancia: Record<string, number> = {}
        for (const e of janela) {
          porStatus[String(e.status)] = (porStatus[String(e.status)] || 0) + 1
          porModo[String(e.modo)] = (porModo[String(e.modo)] || 0) + 1
          porInstancia[String(e.instanciaId)] = (porInstancia[String(e.instanciaId)] || 0) + 1
        }
        const duracoes = janela.map((e) => e.duracaoMs).filter((d): d is number => d != null).map(Number)
        const erros = janela.filter((e) => ehErro(e.status)).length
        const maisAntiga = janela.length ? janela[janela.length - 1].inicio : null
        return json(res, 200, {
          ok: true, horas, passoMin, truncado,
          coberturaHoras: maisAntiga ? Number(((agora - new Date(String(maisAntiga)).getTime()) / 3600000).toFixed(1)) : 0,
          kpis: {
            total: janela.length, erros, taxaErro: janela.length ? erros / janela.length : 0,
            fluxosAtivos: porFluxo.size, medianaMs: percentil(duracoes, 50), p95Ms: percentil(duracoes, 95),
          },
          serie: [...baldes.values()], porStatus, porModo, porInstancia,
          instancias: rt.config.instancias.map(publica),
          volume: fluxos.slice().sort((a, b) => b.total - a.total).slice(0, 12),
          falhas: fluxos.filter((f) => f.erros).sort((a, b) => b.erros - a.erros).slice(0, 12),
          lentos: fluxos.filter((f) => f.p95Ms != null).sort((a, b) => Number(b.p95Ms) - Number(a.p95Ms)).slice(0, 12),
        })
      }

      if (url.pathname === '/api/cron' && req.method === 'GET') {
        if (!instanciasAtivas(rt.config).length) return json(res, 200, { ok: false, motivo: 'sem-chave' })
        try {
          if (url.searchParams.get('recarregar')) rt.cacheCron.clear()
          return json(res, 200, await conferirAgendamentos(rt))
        } catch (e) {
          return json(res, 200, { ok: false, motivo: 'erro-api', detalhe: String((e as Error).message || e) })
        }
      }

      if (url.pathname === '/api/execucao' && req.method === 'GET') {
        const id = url.searchParams.get('id')
        if (!id) return json(res, 400, { ok: false, erro: 'falta id' })
        const inst = instanciaPorId(rt.config, url.searchParams.get('instancia')) || instanciasAtivas(rt.config)[0]
        if (!inst) return json(res, 200, { ok: false, erro: 'nenhuma instância ativa' })
        try {
          const cli = clienteDe(inst, rt.orgId)
          const exec = await cli.chamar(`/api/v1/executions/${encodeURIComponent(id)}?includeData=true`)
          const fluxo = await cli.nomeDeFluxo(String(exec.workflowId))
          return json(res, 200, {
            ok: true, fluxo, instancia: inst.nome,
            diagnostico: montarDiagnostico(exec, fluxo, exec, inst),
          })
        } catch (e) {
          return json(res, 200, { ok: false, erro: String((e as Error).message || e) })
        }
      }
    }

    if (!['GET', 'HEAD'].includes(req.method || '')) {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' })
      return res.end('método não permitido')
    }
    if (await servirEstatico(res, url.pathname)) return
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('nao encontrado')
  } catch (e) {
    const err = e as { status?: number; message?: string }
    if (!err?.status || err.status >= 500) console.error('http:', e)
    json(res, err?.status || 500, { ok: false, erro: err?.status ? err.message : 'erro interno' })
  }
})

function dbMemberInsert(organizationId: string, userId: string, role: string, createdAt: string) {
  const existe = db.prepare('SELECT id FROM member WHERE organizationId = ? AND userId = ?').get(organizationId, userId)
  if (existe) return
  db.prepare('INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES (?, ?, ?, ?, ?)').run(
    randomUUID(), organizationId, userId, role || 'member', createdAt,
  )
}

servidor.requestTimeout = 30000
servidor.headersTimeout = 15000
servidor.keepAliveTimeout = 5000
servidor.maxRequestsPerSocket = 1000

const timerColeta = setInterval(() => {
  coletarWorkspaces().catch((e) => console.error('coleta:', (e as Error).message || e))
}, 10000)
timerColeta.unref()

await migrarAuth()

servidor.listen(PORTA, HOST, () => {
  console.log(`painel n8n em http://${HOST}:${PORTA}`)
  console.log(`sqlite: ${ARQ_SQLITE}`)
  console.log(`dados: ${DIR_DADOS}`)
})

let encerrando = false
function encerrar(sinal: string) {
  if (encerrando) return
  encerrando = true
  clearInterval(timerColeta)
  console.log(`encerrando (${sinal})`)
  servidor.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 10000).unref()
}
process.on('SIGTERM', () => encerrar('SIGTERM'))
process.on('SIGINT', () => encerrar('SIGINT'))
