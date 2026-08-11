import test from 'node:test'
import assert from 'node:assert/strict'
import { criarDispatcherWebhook, payloadDe, prepararEnvio } from '../webhook.mjs'

test('envia abertura, ignora estabilidade, envia piora e resolucao', async () => {
  let disco = '{}'; const eventos = []
  const fetchFn = async (_url, op) => { eventos.push(JSON.parse(op.body)); return { ok: true, status: 204 } }
  const d = criarDispatcherWebhook({ ler: async () => disco, gravar: async (x) => { disco = x }, obterConfig: () => ({ destinos: [{ id: 'hook', ativo: true, modo: 'webhook', url: 'https://hook' }] }), fetchFn })
  await d.carregar()
  const a = { chave: 'x', nivel: 'ruim', origem: 'n8n', tipo: 'erro', titulo: 'Fluxo', resumo: 'falhou', magnitude: 1 }
  await d.processar([a]); await d.processar([a]); await d.processar([{ ...a, magnitude: 2 }]); await d.processar([])
  assert.deepEqual(eventos.map((e) => e.event), ['opened', 'worsened', 'resolved'])
  assert.ok(!JSON.stringify(eventos).includes('bearer'))
})

test('entrega em varios destinos ativos com deduplicacao independente', async () => {
  let disco = '{}'; const chamadas = []
  const destinos = [
    { id: 'hook', ativo: true, modo: 'webhook', url: 'https://hook' },
    { id: 'discord', ativo: true, modo: 'discord', discordUrl: 'https://discord.com/api/webhooks/1/token' },
    { id: 'inativo', ativo: false, modo: 'webhook', url: 'https://inativo' },
  ]
  const fetchFn = async (url, op) => { chamadas.push({ url, body: JSON.parse(op.body) }); return { ok: true, status: 204 } }
  const d = criarDispatcherWebhook({ ler: async () => disco, gravar: async (x) => { disco = x }, obterConfig: () => ({ destinos }), fetchFn })
  const alerta = { chave: 'x', nivel: 'ruim', origem: 'n8n', tipo: 'erro', titulo: 'Fluxo', resumo: 'falhou', magnitude: 1 }

  await d.carregar()
  await d.processar([alerta])
  await d.processar([alerta])

  assert.equal(chamadas.length, 2)
  assert.ok(chamadas.some((c) => c.url === 'https://hook'))
  assert.ok(chamadas.some((c) => c.url.startsWith('https://discord.com/')))
  assert.ok(!chamadas.some((c) => c.url === 'https://inativo'))
  assert.deepEqual(Object.keys(JSON.parse(disco).destinos).sort(), ['discord', 'hook'])
})

test('migra estado legado para o primeiro destino sem reenviar alerta estavel', async () => {
  const alerta = { chave: 'x', nivel: 'ruim', origem: 'n8n', tipo: 'erro', titulo: 'Fluxo', resumo: 'falhou', magnitude: 1 }
  let disco = JSON.stringify({ ativos: { x: { assinatura: 'ruim|1', alerta } }, ultimo: { ok: true, detalhe: 'opened: x' } })
  const chamadas = []
  const d = criarDispatcherWebhook({
    ler: async () => disco,
    gravar: async (x) => { disco = x },
    obterConfig: () => ({ destinos: [{ id: 'migrado', ativo: true, modo: 'webhook', url: 'https://hook' }] }),
    fetchFn: async (...args) => { chamadas.push(args); return { ok: true, status: 204 } },
  })

  await d.carregar()
  await d.processar([alerta])

  assert.equal(chamadas.length, 0)
  assert.equal(d.status('migrado').detalhe, 'opened: x')
})

test('reativacao envia uma vez os alertas que continuam abertos', async () => {
  let disco = '{}'; const eventos = []
  const cfg = { id: 'hook', ativo: true, modo: 'webhook', url: 'https://hook' }
  const alerta = { chave: 'x', nivel: 'ruim', origem: 'n8n', tipo: 'erro', titulo: 'Fluxo', resumo: 'falhou', magnitude: 1 }
  const d = criarDispatcherWebhook({
    ler: async () => disco,
    gravar: async (x) => { disco = x },
    obterConfig: () => ({ destinos: [cfg] }),
    fetchFn: async (_url, op) => { eventos.push(JSON.parse(op.body)); return { ok: true, status: 204 } },
  })

  await d.carregar()
  await d.processar([alerta])
  cfg.ativo = false
  await d.processar([alerta])
  cfg.ativo = true
  await d.processar([alerta])
  await d.processar([alerta])

  assert.deepEqual(eventos.map((e) => e.event), ['opened', 'opened'])
})

test('nao envia resolucao quando a fonte nao pode confirmar recuperacao', async () => {
  let disco = '{}'; const eventos = []
  const cfg = { id: 'hook', ativo: true, modo: 'webhook', url: 'https://hook' }
  const alerta = { chave: 'erro:fora:w:n', nivel: 'ruim', origem: 'n8n', tipo: 'erro', titulo: 'Fluxo', resumo: 'falhou', magnitude: 1 }
  const d = criarDispatcherWebhook({
    ler: async () => disco, gravar: async (x) => { disco = x },
    obterConfig: () => ({ destinos: [cfg] }),
    fetchFn: async (_url, op) => { eventos.push(JSON.parse(op.body)); return { ok: true, status: 204 } },
  })
  await d.carregar()
  await d.processar([alerta])
  await d.processar([], () => false)
  assert.deepEqual(eventos.map((e) => e.event), ['opened'])
})

test('prepara webhook com metodo, bearer e header opcional', () => {
  const p = payloadDe('opened', { chave: 'x', nivel: 'ruim', origem: 'n8n', tipo: 'erro', titulo: 'Fluxo', resumo: 'falhou', magnitude: 2 })
  const e = prepararEnvio(p, { modo: 'webhook', url: 'https://hook', metodo: 'PATCH', bearer: 'b', headerNome: 'X-API-Key', headerValor: 'h' })
  assert.equal(e.method, 'PATCH')
  assert.equal(e.headers.authorization, 'Bearer b')
  assert.equal(e.headers['X-API-Key'], 'h')
  assert.equal(e.body, p)
})

test('rejeita URL insegura e headers reservados', () => {
  const p = payloadDe('test', { chave: 'x', nivel: 'atencao', origem: 'teste', tipo: 'teste', titulo: 'Teste', resumo: 'ok' })
  assert.throws(() => prepararEnvio(p, { modo: 'webhook', url: 'file:///tmp/x' }), /URL/)
  assert.throws(() => prepararEnvio(p, { modo: 'webhook', url: 'https://hook', headerNome: 'Host', headerValor: 'evil' }), /reservado/)
  assert.throws(() => prepararEnvio(p, { modo: 'webhook', url: 'https://hook', headerNome: 'X-Test', headerValor: 'ok\r\nevil' }), /inválido/)
  assert.throws(() => prepararEnvio(p, { modo: 'webhook', url: 'https://user:pass@hook' }), /URL/)
})

test('prepara mensagens Evolution API e Discord', () => {
  const p = payloadDe('test', { chave: 'x', nivel: 'atencao', origem: 'teste', tipo: 'teste', titulo: 'Teste', resumo: 'ok', magnitude: 1 })
  const evo = prepararEnvio(p, { modo: 'evolution', evolutionUrl: 'https://evo/', evolutionInstancia: 'principal', evolutionApiKey: 'k', evolutionNumero: '+55 (65) 99999-9999' })
  assert.equal(evo.url, 'https://evo/message/sendText/principal')
  assert.equal(evo.headers.apikey, 'k')
  assert.equal(evo.body.number, '5565999999999')
  assert.match(evo.body.textMessage.text, /TESTE/)
  const discord = prepararEnvio(p, { modo: 'discord', discordUrl: 'https://discord.com/api/webhooks/1/token', discordNome: 'Monitor' })
  assert.match(discord.url, /wait=true/)
  assert.equal(discord.body.username, 'Monitor')
  assert.deepEqual(discord.body.allowed_mentions, { parse: [] })
})
