import test from 'node:test'
import assert from 'node:assert/strict'
import { criarDispatcherWebhook } from '../webhook.mjs'

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
