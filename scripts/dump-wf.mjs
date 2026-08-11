import { execFileSync } from 'node:child_process'
import { redigir, urlHttpValida } from '../seguranca.mjs'
const base = process.env.N8N_BASE_URL || 'http://localhost:5678'
const wid = process.argv[2]
const alvos = process.argv.slice(3)
const key = process.env.N8N_API_KEY || (process.platform === 'win32'
  ? execFileSync('powershell.exe', ['-NoProfile', '-Command',
    "[Environment]::GetEnvironmentVariable('N8N_API_KEY','User')"], { encoding: 'utf8' }).trim()
  : '')
if (!wid || !key || !urlHttpValida(base)) throw new Error('uso: N8N_API_KEY=... npm run dump -- WORKFLOW_ID [NOS...]')
const h = { 'X-N8N-API-KEY': key, accept: 'application/json' }

const resposta = await fetch(`${base}/api/v1/workflows/${wid}`, { headers: h })
if (!resposta.ok) throw new Error(`n8n respondeu HTTP ${resposta.status}`)
const wf = await resposta.json()
console.log(`# ${wf.name} | ativo=${wf.active}`)
console.log(`settings: ${JSON.stringify(redigir(wf.settings))}`)
console.log(`\n## nos (${wf.nodes.length})`)
for (const n of wf.nodes) {
  console.log(`- ${n.name} :: ${n.type} v${n.typeVersion}${n.disabled ? ' [DESATIVADO]' : ''}`)
}
console.log('\n## conexoes')
for (const [de, saidas] of Object.entries(wf.connections)) {
  for (const [i, lista] of (saidas.main || []).entries()) {
    for (const c of lista || []) console.log(`  ${de} [${i}] -> ${c.node}`)
  }
}
for (const alvo of alvos) {
  const n = wf.nodes.find((x) => x.name === alvo)
  console.log(`\n## ===== ${alvo} =====`)
  if (!n) { console.log('(nao encontrado)'); continue }
  console.log(`tipo: ${n.type} v${n.typeVersion}`)
  console.log(JSON.stringify(redigir(n.parameters), null, 2))
}
