import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

for (const arquivo of ['index.html', 'tarefas.html', 'dashboard.html', 'logs.html']) {
  test(`scripts embutidos de ${arquivo} possuem sintaxe valida`, async () => {
    const html = await readFile(new URL(`../public/${arquivo}`, import.meta.url), 'utf8')
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    for (const [, codigo] of scripts) new vm.Script(codigo, { filename: arquivo })
  })
}
