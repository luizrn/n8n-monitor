import test from 'node:test'
import assert from 'node:assert/strict'
import { chaveDeRegistroValida, redigir, redigirTexto, registroSeguro, urlHttpValida } from '../seguranca.mjs'

test('redige campos, URLs, credenciais HTTP e mensagens', () => {
  const valor = redigir({
    url: 'https://api.example/path?token=segredo&ok=1',
    header: 'Authorization: Bearer abc.def-123',
    nested: { name: 'apiKey', value: 'chave-secreta' },
    login: 'https://usuario:senha@example.com/path',
  })
  const texto = JSON.stringify(valor)
  assert.ok(!texto.includes('segredo'))
  assert.ok(!texto.includes('abc.def-123'))
  assert.ok(!texto.includes('chave-secreta'))
  assert.ok(!texto.includes('usuario:senha'))
  assert.match(redigirTexto('password=minha-senha'), /password=\[REDIGIDO\]/)
})

test('usa registros sem prototipo e rejeita chaves perigosas', () => {
  const registro = registroSeguro(JSON.parse('{"ok":1,"__proto__":{"poluido":true}}'))
  assert.equal(Object.getPrototypeOf(registro), null)
  assert.equal(registro.ok, 1)
  assert.equal(Object.hasOwn(registro, '__proto__'), false)
  assert.equal(chaveDeRegistroValida('constructor'), false)
})

test('aceita apenas URLs HTTP sem credenciais embutidas', () => {
  assert.equal(urlHttpValida('https://example.com/path'), true)
  assert.equal(urlHttpValida('http://127.0.0.1:5678'), true)
  assert.equal(urlHttpValida('javascript:alert(1)'), false)
  assert.equal(urlHttpValida('https://user:pass@example.com'), false)
})
