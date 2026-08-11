import test from 'node:test'
import assert from 'node:assert/strict'
import { lerMetrics, situacaoDe } from '../uptime.mjs'

test('le id, status, resposta, TLS e uptime 24h do Prometheus', () => {
  const labels = 'monitor_id="7",monitor_name="API",monitor_type="http",monitor_url="https://api.example.com",window="1d"'
  const itens = lerMetrics([
    `monitor_status{${labels}} 1`, `monitor_response_time{${labels}} 42`,
    `monitor_cert_days_remaining{${labels}} 18`, `monitor_cert_is_valid{${labels}} 1`,
    `monitor_uptime_ratio{${labels}} 0.998`,
  ].join('\n'))
  assert.equal(itens.length, 1)
  assert.deepEqual(
    Object.fromEntries(['id', 'nome', 'status', 'respostaMs', 'certDias', 'certValido', 'uptime24'].map((k) => [k, itens[0][k]])),
    { id: '7', nome: 'API', status: 1, respostaMs: 42, certDias: 18, certValido: true, uptime24: 0.998 },
  )
})

test('ignora grupos do Uptime Kuma', () => {
  const grupo = 'monitor_name="Ferramentas Internas",monitor_type="group",monitor_url="https://"'
  const servico = 'monitor_id="7",monitor_name="API",monitor_type="http",monitor_url="https://api.example.com"'
  const itens = lerMetrics([
    `monitor_status{${grupo}} 0`,
    `monitor_response_time{${grupo}} -1`,
    `monitor_status{${servico}} 1`,
  ].join('\n'))

  assert.deepEqual(itens.map((m) => m.nome), ['API'])
})

test('mapeia estados Kuma', () => {
  assert.equal(situacaoDe({ status: 0 }), 'desligado')
  assert.equal(situacaoDe({ status: 2 }), 'desconhecido')
  assert.equal(situacaoDe({ status: 3 }), 'manutencao')
  assert.equal(situacaoDe({ status: null }), 'pausado')
})
