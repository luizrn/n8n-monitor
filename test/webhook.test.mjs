import test from 'node:test'
import assert from 'node:assert/strict'
import { criarDispatcherWebhook, payloadDe, prepararEnvio } from '../webhook.mjs'

test('envia abertura, ignora estabilidade, envia piora e resolucao', async () => {
  let disco = '{}'; const eventos = []
  const fetchFn = async (_url, op) => { eventos.push(JSON.parse(op.body)); return { ok: true, status: 204 } }
  const d = criarDispatcherWebhook({ ler: async () => disco, gravar: async (x) => { disco = x }, obterConfig: () => ({ ativo: true, url: 'https://hook' }), fetchFn })
  await d.carregar()
  const a = { chave: 'x', nivel: 'ruim', origem: 'n8n', tipo: 'erro', titulo: 'Fluxo', resumo: 'falhou', magnitude: 1 }
  await d.processar([a]); await d.processar([a]); await d.processar([{ ...a, magnitude: 2 }]); await d.processar([])
  assert.deepEqual(eventos.map((e) => e.event), ['opened', 'worsened', 'resolved'])
  assert.ok(!JSON.stringify(eventos).includes('bearer'))
})

test('prepara webhook com metodo, bearer e header opcional', () => {
  const p = payloadDe('opened', { chave: 'x', nivel: 'ruim', origem: 'n8n', tipo: 'erro', titulo: 'Fluxo', resumo: 'falhou', magnitude: 2 })
  const e = prepararEnvio(p, { modo: 'webhook', url: 'https://hook', metodo: 'PATCH', bearer: 'b', headerNome: 'X-API-Key', headerValor: 'h' })
  assert.equal(e.method, 'PATCH')
  assert.equal(e.headers.authorization, 'Bearer b')
  assert.equal(e.headers['X-API-Key'], 'h')
  assert.equal(e.body, p)
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
