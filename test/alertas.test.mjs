import test from 'node:test'
import assert from 'node:assert/strict'
import { montarAlertas, assinaturaAlerta, podeConfirmarRecuperacao } from '../alertas.mjs'

test('normaliza alertas e isola chaves por instancia', () => {
  const estado = {
    instancias: [{ id: 'a', nome: 'A', baseUrl: 'https://a', alcancavel: true }],
    inalcancaveis: [], limiteTravadaMin: 30,
    erros: [{ chave: 'erro:a:w:n', instanciaId: 'a', instancia: 'A', workflowId: 'w', fluxo: 'Fluxo', no: 'Nó', total: 2, idExemplo: '9' }],
    rodando: [{ id: '8', instanciaId: 'a', instancia: 'A', workflowId: 'w', fluxo: 'Fluxo', minutos: 31 }],
  }
  const alertas = montarAlertas(estado, { linhas: [] }, { ok: false })
  assert.deepEqual(alertas.map((a) => a.chave), ['erro:a:w:n', 'travada:a:8'])
  assert.equal(alertas[0].link, 'https://a/workflow/w/executions/9')
  assert.equal(assinaturaAlerta(alertas[0]), 'ruim|2')
})

test('mapeia severidade equilibrada do Kuma e expiracoes', () => {
  const alertas = montarAlertas({}, {}, { ok: true, baseUrl: 'https://kuma', limiteCertDias: 21, monitores: [
    { id: '1', nome: 'API', ativo: true, situacao: 'desligado', certDias: 4, certValido: true, alvo: 'https://api.tld' },
    { id: '2', nome: 'Fila', ativo: true, situacao: 'manutencao' },
  ], dominios: [{ dominio: 'api.tld', dias: -1, expiraEm: '2026-01-01' }] })
  assert.equal(alertas.filter((a) => a.nivel === 'ruim').length, 2)
  assert.equal(alertas.filter((a) => a.origem === 'tls')[0].nivel, 'atencao')
  assert.ok(!alertas.some((a) => a.titulo === 'Fila'))
})

test('leva apenas servicos Kuma ativos e offline para o painel de atencao', () => {
  const alertas = montarAlertas({}, {}, {
    ok: true,
    baseUrl: 'https://kuma.example',
    limiteCertDias: 21,
    dominios: [],
    monitores: [
      { id: 'offline', nome: 'API offline', ativo: true, situacao: 'desligado' },
      { id: 'online', nome: 'API online', ativo: true, situacao: 'ligado' },
      { id: 'ignorado', nome: 'API desmarcada', ativo: false, situacao: 'desligado' },
    ],
  })

  assert.deepEqual(alertas.map((a) => a.chave), ['kuma:offline'])
  assert.equal(alertas[0].nivel, 'ruim')
  assert.equal(alertas[0].tipo, 'serviço offline')
  assert.equal(alertas[0].instancia, 'Uptime Kuma')
})

test('so confirma recuperacao quando a fonte respondeu', () => {
  const estado = { instancias: [{ id: 'ok', alcancavel: true }, { id: 'fora', alcancavel: false }] }
  assert.equal(podeConfirmarRecuperacao({ chave: 'erro:ok:w:n' }, estado, {}), true)
  assert.equal(podeConfirmarRecuperacao({ chave: 'erro:fora:w:n' }, estado, {}), false)
  assert.equal(podeConfirmarRecuperacao({ chave: 'kuma:1' }, estado, { ok: false }), false)
  assert.equal(podeConfirmarRecuperacao({ chave: 'kuma:1' }, estado, { ok: true }), true)
})
