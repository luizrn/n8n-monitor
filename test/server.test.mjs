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
  const s = await subir({ baseUrl: 'https://n8n.example.com', apiKey: 'segredo' })
  t.after(async () => { s.proc.kill('SIGTERM'); await rm(s.dir, { recursive: true, force: true }) })
  assert.equal((await (await fetch(`http://127.0.0.1:${s.porta}/api/health`)).json()).ok, true)
  const cfg = await (await fetch(`http://127.0.0.1:${s.porta}/api/config`)).json()
  assert.equal(cfg.instancias[0].nome, 'Principal')
  assert.equal(cfg.instancias[0].temChave, true)
  assert.ok(!JSON.stringify(cfg).includes('segredo'))
})
