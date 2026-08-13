import test from 'node:test'
import assert from 'node:assert/strict'
import { criarResolvedorRdap, expiracaoDeRdap, hostnameDeMonitor } from '../src/rdap.ts'

test('extrai host e expiracao RDAP', () => {
  assert.equal(hostnameDeMonitor({ url: 'https://api.example.com/x' }), 'api.example.com')
  assert.equal(hostnameDeMonitor({ host: '127.0.0.1' }), null)
  assert.equal(expiracaoDeRdap({ events: [{ eventAction: 'expiration', eventDate: '2030-01-01T00:00:00Z' }] }).toISOString(), '2030-01-01T00:00:00.000Z')
})

test('resolve o dominio registrado removendo subdominios', async () => {
  const calls = []
  const fetchFn = async (url) => {
    calls.push(url)
    if (url.includes('dns.json')) return { ok: true, json: async () => ({ services: [[['com'], ['https://rdap.test/']]] }) }
    if (url.endsWith('/api.example.com')) return { ok: false, status: 404 }
    return { ok: true, status: 200, json: async () => ({ events: [{ eventAction: 'expiration', eventDate: '2030-01-01T00:00:00Z' }] }) }
  }
  const r = criarResolvedorRdap({ fetchFn, agora: () => Date.parse('2029-12-01T00:00:00Z') })
  const d = await r.consultar('api.example.com')
  assert.equal(d.dominio, 'example.com')
  assert.ok(calls.some((x) => x.endsWith('/example.com')))
})
