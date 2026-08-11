import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

async function subir(config = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'n8n-monitor-'))
  await writeFile(join(dir, 'config.json'), JSON.stringify(config))
  const porta = 19000 + Math.floor(Math.random() * 1000)
  const proc = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(porta), N8N_MONITOR_DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] })
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${porta}/api/health`); if (r.ok) return { dir, porta, proc } } catch {}
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('servidor não iniciou')
}

test('health responde e migra configuracao legada sem expor chave', async (t) => {
  const s = await subir({ baseUrl: 'https://n8n.example.com', apiKey: 'segredo', webhook: { bearer: 'bearer-secreto', headerValor: 'header-secreto', evolutionApiKey: 'evo-secreta', discordUrl: 'https://discord.com/api/webhooks/id/token-secreto' } })
  t.after(async () => { s.proc.kill('SIGTERM'); await rm(s.dir, { recursive: true, force: true }) })
  assert.equal((await (await fetch(`http://127.0.0.1:${s.porta}/api/health`)).json()).ok, true)
  const cfg = await (await fetch(`http://127.0.0.1:${s.porta}/api/config`)).json()
  assert.equal(cfg.instancias[0].nome, 'Principal')
  assert.equal(cfg.idioma, 'pt-BR')
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
  t.after(async () => { s.proc.kill('SIGTERM'); await rm(s.dir, { recursive: true, force: true }) })
  const cfg = await (await fetch(`http://127.0.0.1:${s.porta}/api/config`)).json()
  assert.deepEqual(cfg.webhook.destinos, [])
})

test('salva varios destinos e preserva segredos omitidos', async (t) => {
  const s = await subir()
  t.after(async () => { s.proc.kill('SIGTERM'); await rm(s.dir, { recursive: true, force: true }) })
  const endpoint = `http://127.0.0.1:${s.porta}/api/config`
  const destinos = [
    { id: 'hook', nome: 'Incidentes', ativo: true, modo: 'webhook', url: 'https://hook', bearer: 'bearer-secreto' },
    { id: 'zap', nome: 'Plantão', ativo: true, modo: 'evolution', evolutionUrl: 'https://evo', evolutionInstancia: 'principal', evolutionApiKey: 'evo-secreta', evolutionNumero: '5565999999999' },
  ]
  let r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idioma: 'en', webhook: { destinos } }) })
  assert.equal(r.ok, true)
  r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ webhook: { destinos: destinos.map((d) => ({ ...d, bearer: '', evolutionApiKey: '' })) } }) })
  assert.equal(r.ok, true)

  const cfg = await (await fetch(endpoint)).json()
  assert.equal(cfg.idioma, 'en')
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
  t.after(async () => { s.proc.kill('SIGTERM'); await rm(s.dir, { recursive: true, force: true }) })
  const endpoint = `http://127.0.0.1:${s.porta}/api/config`
  const get = await fetch(endpoint)
  assert.equal(get.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(get.headers.get('x-frame-options'), 'DENY')
  assert.match(get.headers.get('content-security-policy'), /frame-ancestors 'none'/)
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415)
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status, 400)
})

test('rejeita URLs inseguras sem alterar a configuracao', async (t) => {
  const s = await subir()
  t.after(async () => { s.proc.kill('SIGTERM'); await rm(s.dir, { recursive: true, force: true }) })
  const endpoint = `http://127.0.0.1:${s.porta}/api/config`
  const antes = (await (await fetch(endpoint)).json()).instancias
  const r = await fetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instancias: [{ nome: 'Insegura', baseUrl: 'javascript:alert(1)', apiKey: 'x' }] }),
  })
  assert.equal(r.status, 400)
  assert.deepEqual((await (await fetch(endpoint)).json()).instancias, antes)
})
