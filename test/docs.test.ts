import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VERSAO } from '../src/versao.ts'

const raiz = fileURLToPath(new URL('..', import.meta.url))

const PARES_RAIZ: [string, string][] = [
  ['README.md', 'README.en.md'],
  ['CHANGELOG.md', 'CHANGELOG.en.md'],
  ['CONTRIBUTING.md', 'CONTRIBUTING.en.md'],
  ['SECURITY.md', 'SECURITY.en.md'],
  ['SUPPORT.md', 'SUPPORT.en.md'],
  ['CODE_OF_CONDUCT.md', 'CODE_OF_CONDUCT.en.md'],
  ['AGENTS.md', 'AGENTS.en.md'],
]

const PARES_DOCS: [string, string][] = [
  ['arquitetura.md', 'architecture.en.md'],
  ['operacao.md', 'operations.en.md'],
  ['decisoes.md', 'decisions.en.md'],
]

async function existe(rel: string) {
  try {
    await access(join(raiz, rel))
    return true
  } catch {
    return false
  }
}

test('documentos publicos da raiz tem par em ingles', async () => {
  for (const [pt, en] of PARES_RAIZ) {
    assert.equal(await existe(pt), true, `falta ${pt}`)
    assert.equal(await existe(en), true, `falta ${en}`)
  }
})

test('docs/ tecnicos tem par em ingles', async () => {
  for (const [pt, en] of PARES_DOCS) {
    assert.equal(await existe(join('docs', pt)), true, `falta docs/${pt}`)
    assert.equal(await existe(join('docs', en)), true, `falta docs/${en}`)
  }
})

test('docs/2.0 em portugues tem .en.md', async () => {
  const dir = join(raiz, 'docs', '2.0')
  const nomes = await readdir(dir)
  const pts = nomes.filter((n) => n.endsWith('.md') && !n.endsWith('.en.md'))
  assert.ok(pts.length > 0)
  for (const pt of pts) {
    const en = pt === 'README.md' ? 'README.en.md' : pt.replace(/\.md$/, '.en.md')
    assert.equal(await existe(join('docs', '2.0', en)), true, `falta docs/2.0/${en} para ${pt}`)
  }
  assert.equal(await existe(join('docs', '2.0', 'env.exemplo')), true)
})

test('repositorio publico nao versiona FQDN de instancia', async () => {
  const { spawnSync } = await import('node:child_process')
  const marca = ['stack', 'base', '.com'].join('')
  const r = spawnSync('git', ['grep', '-n', '-i', marca, '--', 'src', 'docs', 'public', 'AGENTS.md', 'AGENTS.en.md', 'README.md', 'README.en.md'], {
    cwd: raiz,
    encoding: 'utf8',
  })
  assert.equal((r.stdout || '').trim(), '', r.stdout)
})

test('VERSAO bate com package.json', async () => {
  const pkg = JSON.parse(await readFile(join(raiz, 'package.json'), 'utf8')) as { version: string }
  assert.equal(VERSAO, pkg.version)
  assert.equal(VERSAO, '2.0.0')
})
