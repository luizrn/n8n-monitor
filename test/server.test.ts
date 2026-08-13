import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const raiz = fileURLToPath(new URL('..', import.meta.url))
let proximaPorta = 19000 + (process.pid % 400) * 20

function cookiesDe(res: Response) {
  const lista = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  return lista.map((c) => c.split(';')[0]).join('; ')
}

async function subir(config: Record<string, unknown> = {}) {
  const porta = proximaPorta++
  const dir = await mkdtemp(join(tmpdir(), 'n8n-monitor-'))
  await writeFile(join(dir, 'config.json'), JSON.stringify(config))
  const proc = spawn(process.execPath, [join(raiz, 'node_modules/tsx/dist/cli.mjs'), 'src/server.ts'], {
    cwd: raiz,
    env: {
      ...process.env,
      PORT: String(porta),
      HOST: '127.0.0.1',
      N8N_MONITOR_DATA_DIR: dir,
      BETTER_AUTH_SECRET: 'n8n-monitor-test-secret-min-32-chars',
      BETTER_AUTH_URL: `http://127.0.0.1:${porta}`,
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${porta}/api/health`)
      if (r.ok) {
        const setup = await fetch(`http://127.0.0.1:${porta}/api/setup`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ nome: 'Admin', email: 'admin@test.local', senha: 'senha123', workspace: 'Principal' }),
        })
        const cookie = cookiesDe(setup)
        return {
          dir, porta, proc, cookie,
          get: (path: string, opts: RequestInit = {}) => fetch(`http://127.0.0.1:${porta}${path}`, { headers: cookie ? { cookie } : {}, ...opts }),
          post: (path: string, body: unknown) => fetch(`http://127.0.0.1:${porta}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
            body: JSON.stringify(body),
          }),
          patch: (path: string, body: unknown) => fetch(`http://127.0.0.1:${porta}${path}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
            body: JSON.stringify(body),
          }),
          fechar: async () => {
            proc.kill('SIGTERM')
            await new Promise((ok) => {
              const timer = setTimeout(() => { proc.kill('SIGKILL'); ok(null) }, 2500)
              proc.on('exit', () => { clearTimeout(timer); ok(null) })
            })
            await rm(dir, { recursive: true, force: true }).catch(() => {})
          },
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 80))
  }
  const err = proc.stderr ? await new Promise<string>((ok) => {
    const chunks: Buffer[] = []
    proc.stderr?.on('data', (c) => chunks.push(c))
    setTimeout(() => ok(Buffer.concat(chunks).toString()), 200)
  }) : ''
  throw new Error(`servidor não iniciou ${err}`)
}

test('health responde sem autenticacao e config exige sessao', async (t) => {
  const s = await subir({ baseUrl: 'https://n8n.example.com', apiKey: 'segredo' })
  t.after(() => s.fechar())
  const health = await (await fetch(`http://127.0.0.1:${s.porta}/api/health`)).json() as { ok: boolean; versao: string }
  assert.equal(health.ok, true)
  assert.equal(health.versao, '2.0.0')
  assert.equal((await fetch(`http://127.0.0.1:${s.porta}/api/config`)).status, 401)
  assert.equal((await fetch(`http://127.0.0.1:${s.porta}/`, { redirect: 'manual' })).status, 302)
  assert.equal((await fetch(`http://127.0.0.1:${s.porta}/login`)).status, 200)
})

test('health responde e migra configuracao legada sem expor chave', async (t) => {
  const s = await subir({ baseUrl: 'https://n8n.example.com', apiKey: 'segredo', webhook: { bearer: 'bearer-secreto', headerValor: 'header-secreto', evolutionApiKey: 'evo-secreta', discordUrl: 'https://discord.com/api/webhooks/id/token-secreto' } })
  t.after(() => s.fechar())
  const cfg = await (await s.get('/api/config')).json() as Record<string, unknown> & { instancias: { nome: string; temChave: boolean }[]; webhook: { destinos: Record<string, unknown>[] } }
  assert.equal(cfg.instancias[0].nome, 'Principal')
  assert.equal(cfg.idioma, 'pt-BR')
  assert.equal(cfg.tema, 'escuro')
  assert.equal(cfg.instancias[0].temChave, true)
  const publicado = JSON.stringify(cfg)
  assert.ok(!publicado.includes('segredo'))
  assert.ok(!publicado.includes('token-secreto'))
  assert.equal(cfg.webhook.destinos.length, 1)
  const destino = cfg.webhook.destinos[0]
  assert.equal(destino.id, 'destino-1')
  assert.equal(destino.temBearer, true)
  assert.equal(destino.temHeaderValor, true)
  assert.equal(destino.temEvolutionApiKey, true)
  assert.equal(destino.temDiscordUrl, true)
  assert.equal(destino.temUrl, false)
  assert.equal(cfg.caminhoConfig, undefined)
})

test('ignora destino legado vazio para iniciar a aba de envio sem exemplo', async (t) => {
  const s = await subir({ webhook: { ativo: false, url: '', metodo: 'POST' } })
  t.after(() => s.fechar())
  const cfg = await (await s.get('/api/config')).json() as { webhook: { destinos: unknown[] } }
  assert.deepEqual(cfg.webhook.destinos, [])
})

test('salva varios destinos e preserva segredos omitidos', async (t) => {
  const s = await subir()
  t.after(() => s.fechar())
  const destinos = [
    { id: 'hook', nome: 'Incidentes', ativo: true, modo: 'webhook', url: 'https://hook', bearer: 'bearer-secreto' },
    { id: 'zap', nome: 'Plantão', ativo: true, modo: 'evolution', evolutionUrl: 'https://evo', evolutionInstancia: 'principal', evolutionApiKey: 'evo-secreta', evolutionNumero: '5565999999999' },
  ]
  let r = await s.post('/api/config', { idioma: 'en', tema: 'claro', webhook: { destinos } })
  assert.equal(r.ok, true)
  r = await s.post('/api/config', { webhook: { destinos: destinos.map((d) => ({ ...d, bearer: '', evolutionApiKey: '' })) } })
  assert.equal(r.ok, true)

  const cfg = await (await s.get('/api/config')).json() as { idioma: string; tema: string; webhook: { destinos: { id: string; temBearer?: boolean; temUrl?: boolean; temEvolutionApiKey?: boolean }[] } }
  assert.equal(cfg.idioma, 'en')
  assert.equal(cfg.tema, 'claro')
  assert.deepEqual(cfg.webhook.destinos.map((d) => d.id), ['hook', 'zap'])
  assert.equal(cfg.webhook.destinos[0].temBearer, true)
  assert.equal(cfg.webhook.destinos[0].temUrl, true)
  assert.equal(cfg.webhook.destinos[1].temEvolutionApiKey, true)
  assert.ok(!JSON.stringify(cfg).includes('bearer-secreto'))
  assert.ok(!JSON.stringify(cfg).includes('evo-secreta'))
  assert.ok(!JSON.stringify(cfg).includes('https://hook'))
})

test('aplica headers de seguranca e rejeita POST simples ou invalido', async (t) => {
  const s = await subir()
  t.after(() => s.fechar())
  const get = await s.get('/api/config')
  assert.equal(get.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(get.headers.get('x-frame-options'), 'DENY')
  assert.match(get.headers.get('content-security-policy') || '', /frame-ancestors 'none'/)
  assert.equal((await fetch(`http://127.0.0.1:${s.porta}/api/config`, { method: 'POST', headers: { 'content-type': 'text/plain', cookie: s.cookie }, body: '{}' })).status, 415)
  assert.equal((await fetch(`http://127.0.0.1:${s.porta}/api/config`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: s.cookie }, body: '{' })).status, 400)
})

test('rejeita URLs inseguras sem alterar a configuracao', async (t) => {
  const s = await subir()
  t.after(() => s.fechar())
  const antes = ((await (await s.get('/api/config')).json()) as { instancias: unknown }).instancias
  const r = await s.post('/api/config', { instancias: [{ nome: 'Insegura', baseUrl: 'javascript:alert(1)', apiKey: 'x' }] })
  assert.equal(r.status, 400)
  assert.deepEqual(((await (await s.get('/api/config')).json()) as { instancias: unknown }).instancias, antes)
})

test('isola configuracao entre workspaces', async (t) => {
  const s = await subir({
    idioma: 'pt-BR',
    instancias: [{ nome: 'Legado', baseUrl: 'https://n8n.example.com', apiKey: 'chave-legado' }],
    uptimeKuma: { ativo: true, baseUrl: 'https://kuma.example.com', token: 'token-legado', slug: 'status' },
  })
  t.after(() => s.fechar())
  const inicial = await (await s.get('/api/sessao')).json() as { ativo: string }
  const primeiro = inicial.ativo
  assert.ok(primeiro)
  const cfg1 = await (await s.get('/api/config')).json() as {
    idioma: string
    instancias: { temChave: boolean }[]
    uptimeKuma: { ativo: boolean; temToken: boolean; baseUrl: string }
  }
  assert.equal(cfg1.idioma, 'pt-BR')
  assert.equal(cfg1.instancias.length, 1)
  assert.equal(cfg1.instancias[0].temChave, true)
  assert.equal(cfg1.uptimeKuma.ativo, true)
  assert.equal(cfg1.uptimeKuma.temToken, true)

  const criado = await s.post('/api/workspace', { nome: 'Outro' })
  assert.equal(criado.ok, true)
  const corpo = await criado.json() as { workspace?: { id?: string } }
  const sessaoNova = await (await s.get('/api/sessao')).json() as { ativo: string }
  const segundo = corpo.workspace?.id || sessaoNova.ativo
  assert.ok(segundo)
  assert.notEqual(segundo, primeiro)

  const cfg2 = await (await s.get('/api/config')).json() as {
    instancias: unknown[]
    uptimeKuma: { ativo: boolean; temToken: boolean; baseUrl: string; slug: string }
    webhook: { destinos: unknown[] }
  }
  assert.deepEqual(cfg2.instancias, [])
  assert.equal(cfg2.uptimeKuma.ativo, false)
  assert.equal(cfg2.uptimeKuma.temToken, false)
  assert.equal(cfg2.uptimeKuma.baseUrl, '')
  assert.equal(cfg2.uptimeKuma.slug, '')
  assert.deepEqual(cfg2.webhook?.destinos || [], [])

  const salvo = await s.post('/api/config', { idioma: 'en' })
  assert.equal(salvo.ok, true)
  assert.equal(((await (await s.get('/api/config')).json()) as { idioma: string }).idioma, 'en')

  const voltar = await s.post('/api/workspace/ativar', { id: primeiro })
  assert.equal(voltar.ok, true)
  const deNovo = await (await s.get('/api/config')).json() as {
    idioma: string
    instancias: { temChave: boolean }[]
    uptimeKuma: { temToken: boolean }
  }
  assert.equal(deNovo.idioma, 'pt-BR')
  assert.equal(deNovo.instancias.length, 1)
  assert.equal(deNovo.uptimeKuma.temToken, true)

  const ir = await s.post('/api/workspace/ativar', { id: segundo })
  assert.equal(ir.ok, true)
  assert.equal(((await (await s.get('/api/config')).json()) as { idioma: string }).idioma, 'en')
  assert.deepEqual(((await (await s.get('/api/config')).json()) as { instancias: unknown[] }).instancias, [])
})

test('setup-status e segundo setup, login e cadastro interno', async (t) => {
  const s = await subir()
  t.after(() => s.fechar())
  const status = await (await fetch(`http://127.0.0.1:${s.porta}/api/setup-status`)).json() as { precisaSetup: boolean }
  assert.equal(status.precisaSetup, false)
  const deNovo = await fetch(`http://127.0.0.1:${s.porta}/api/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nome: 'X', email: 'x@test.local', senha: 'senha123', workspace: 'X' }),
  })
  assert.ok(deNovo.status >= 400)

  const login = await fetch(`http://127.0.0.1:${s.porta}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@test.local', password: 'senha123' }),
  })
  assert.equal(login.ok, true)
  assert.ok(cookiesDe(login).length > 0)

  const signup = await fetch(`http://127.0.0.1:${s.porta}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'publico@test.local', password: 'senha123', name: 'Publico' }),
  })
  assert.ok(!signup.ok)

  const user = await s.post('/api/usuarios', {
    nome: 'Operador', email: 'op@test.local', senha: 'senha123', papel: 'member', mustChangePassword: true,
  })
  assert.equal(user.ok, true)
  const membros = await (await s.get('/api/usuarios')).json() as { itens: { email: string; mustChangePassword: boolean }[] }
  assert.ok(membros.itens.some((m) => m.email === 'op@test.local' && m.mustChangePassword))
})

test('convite gera link publico copiavel', async (t) => {
  const s = await subir()
  t.after(() => s.fechar())
  const r = await s.post('/api/convite', { email: 'convite@test.local', papel: 'member' })
  assert.equal(r.ok, true)
  const corpo = await r.json() as { link?: string }
  assert.ok(corpo.link && corpo.link.includes('/aceitar-convite?id='))
  const id = new URL(corpo.link, 'http://local').searchParams.get('id')
  const info = await fetch(`http://127.0.0.1:${s.porta}/api/convite/info?id=${encodeURIComponent(id || '')}`)
  assert.equal(info.ok, true)
  const dados = await info.json() as { email: string }
  assert.equal(dados.email, 'convite@test.local')
})

test('renomeia o workspace ativo e recusa sem sessao', async (t) => {
  const s = await subir()
  t.after(() => s.fechar())
  assert.equal((await fetch(`http://127.0.0.1:${s.porta}/api/workspace`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nome: 'X' }),
  })).status, 401)
  const vazio = await s.patch('/api/workspace', { nome: '  ' })
  assert.equal(vazio.status, 400)
  const r = await s.patch('/api/workspace', { nome: 'Stackbase' })
  assert.equal(r.ok, true)
  const corpo = await r.json() as { nome: string }
  assert.equal(corpo.nome, 'Stackbase')
  const sessao = await (await s.get('/api/sessao')).json() as { workspaces: { name: string; id: string }[]; ativo: string }
  const atual = sessao.workspaces.find((w) => w.id === sessao.ativo)
  assert.equal(atual?.name, 'Stackbase')
})
