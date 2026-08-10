import { execFileSync } from 'node:child_process'
const base = process.env.N8N_BASE_URL || 'http://localhost:5678'
const wid = process.argv[2]
const alvos = process.argv.slice(3)
const key = execFileSync('powershell.exe', ['-NoProfile', '-Command',
  "[Environment]::GetEnvironmentVariable('N8N_API_KEY','User')"], { encoding: 'utf8' }).trim()
const h = { 'X-N8N-API-KEY': key, accept: 'application/json' }

const wf = await (await fetch(`${base}/api/v1/workflows/${wid}`, { headers: h })).json()
console.log(`# ${wf.name} | ativo=${wf.active}`)
console.log(`settings: ${JSON.stringify(wf.settings)}`)
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
  if (n.parameters?.jsCode) console.log(n.parameters.jsCode)
  else console.log(JSON.stringify(n.parameters, null, 2))
}
