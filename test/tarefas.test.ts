import test from 'node:test'
import assert from 'node:assert/strict'
import { criarRepo } from '../src/tarefas.ts'

test('abre, move, resolve automaticamente e reabre recorrencia', async () => {
  let disco = '{}'
  const repo = criarRepo({ ler: async () => disco, gravar: async (x) => { disco = x } })
  await repo.carregar()
  await repo.abrir({ chave: 'erro:a:w:n', titulo: 'Fluxo', magnitude: 2 })
  await repo.mover('erro:a:w:n', 'corrigindo', 'ajuste em curso')
  await repo.resolverAusentes([])
  assert.equal(repo.pegar('erro:a:w:n').estado, 'resolvido')
  await repo.abrir({ chave: 'erro:a:w:n', titulo: 'Fluxo', magnitude: 3 })
  assert.equal(repo.pegar('erro:a:w:n').estado, 'analise')
  assert.ok(repo.pegar('erro:a:w:n').historico.some((h) => h.motivo === 'recorrencia'))
})

test('mantem tarefa aberta quando a fonte nao pode confirmar recuperacao', async () => {
  let disco = '{}'
  const repo = criarRepo({ ler: async () => disco, gravar: async (x) => { disco = x } })
  await repo.carregar()
  await repo.abrir({ chave: 'erro:offline:w:n', titulo: 'Fluxo' })
  await repo.resolverAusentes([], () => false)
  assert.equal(repo.pegar('erro:offline:w:n').estado, 'analise')
})

test('ignora chaves perigosas ao carregar e ao abrir', async () => {
  const repo = criarRepo({
    ler: async () => '{"__proto__":{"estado":"analise"},"ok":{"chave":"ok","estado":"analise"}}',
    gravar: async () => {},
  })
  await repo.carregar()
  assert.equal(repo.lista().length, 1)
  await assert.rejects(() => repo.abrir({ chave: 'constructor' }), /inválida/)
})
