import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = fileURLToPath(new URL('..', import.meta.url))
const publicDir = join(raiz, 'public')

const IGNORAR = new Set([
  'n8n', 'HTTP', 'HTTPS', 'API', 'POST', 'PUT', 'PATCH', 'TLS', 'RDAP', 'JSON', 'SQLite',
  'Discord', 'WhatsApp', 'GitHub', 'Bearer', 'URL', 'ID', 'OK', 'Kuma', 'Principal',
  'Uptime Kuma', 'Evolution API', 'API key', 'Webhook HTTP', 'WhatsApp (Evolution API)',
  'n8n-monitor', 'pt-BR', 'en', 'min', 'h', 'm', 's', '×', '✓', '…',
  'p95', 'N8N', 'English', 'status', '1h', '6h', '24h',
])

function chavesDoCatalogo(fonte: string) {
  const ini = fonte.indexOf('const en = {')
  const fim = fonte.indexOf('const padroes = [')
  assert.ok(ini >= 0 && fim > ini, 'bloco const en não encontrado em i18n.js')
  const bloco = fonte.slice(ini, fim)
  return [...bloco.matchAll(/'((?:\\'|[^'])*)'\s*:/g)].map((m) => m[1].replace(/\\'/g, "'"))
}

function textosDoHtml(html: string) {
  const limpo = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  const achados = new Set<string>()
  for (const m of limpo.matchAll(/>([^<]+)</g)) {
    const t = m[1].replace(/&nbsp;/g, ' ').trim()
    if (t) achados.add(t)
  }
  for (const attr of ['placeholder', 'title', 'aria-label', 'alt']) {
    const re = new RegExp(`${attr}="([^"]+)"`, 'gi')
    for (const m of limpo.matchAll(re)) achados.add(m[1].trim())
  }
  return [...achados]
}

function precisaTraducao(texto: string) {
  if (!texto || IGNORAR.has(texto)) return false
  if (/^[\d\s.:/%#|+\-–—•·×✓…()]+$/.test(texto)) return false
  if (/^\d+[hm]$/i.test(texto)) return false
  if (/^https?:\/\//i.test(texto) || texto.startsWith('{') || texto.startsWith('$')) return false
  if (texto.length < 2) return false
  return /[A-Za-zÀ-ÿ]/.test(texto)
}

test('catalogo i18n tem o volume esperado de chaves', async () => {
  const fonte = await readFile(join(publicDir, 'i18n.js'), 'utf8')
  const chaves = chavesDoCatalogo(fonte)
  assert.ok(chaves.length > 80, `catálogo pequeno demais: ${chaves.length}`)
})

test('textos visiveis das paginas existem no catalogo i18n', async () => {
  const fonte = await readFile(join(publicDir, 'i18n.js'), 'utf8')
  const chaves = new Set(chavesDoCatalogo(fonte))
  const arquivos = (await readdir(publicDir)).filter((n) => n.endsWith('.html'))
  const faltando: string[] = []
  for (const nome of arquivos) {
    const html = await readFile(join(publicDir, nome), 'utf8')
    for (const texto of textosDoHtml(html)) {
      if (!precisaTraducao(texto)) continue
      if (chaves.has(texto)) continue
      faltando.push(`${nome}: ${texto}`)
    }
  }
  assert.deepEqual(faltando, [], `sem tradução em i18n.js:\n${faltando.join('\n')}`)
})

test('paginas de auth e workspace cobrem chaves novas', async () => {
  const fonte = await readFile(join(publicDir, 'i18n.js'), 'utf8')
  const chaves = new Set(chavesDoCatalogo(fonte))
  for (const chave of [
    'Entre com e-mail e senha.',
    'Primeiro acesso',
    'Aceitar convite',
    'Trocar senha',
    'Workspace',
    'Cadastrar usuário',
    'Salvar nome',
    'Gerar convite',
    'Não foi possível entrar.',
    'Você foi convidado para {workspace} como {role}.',
  ]) {
    assert.ok(chaves.has(chave), `falta no catálogo: ${chave}`)
  }
})
