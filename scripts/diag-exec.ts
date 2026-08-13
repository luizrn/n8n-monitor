import { execFileSync } from 'node:child_process'
import { redigir, redigirTexto, urlHttpValida } from '../src/seguranca.ts'

const base = process.env.N8N_BASE_URL || 'http://localhost:5678'
const id = process.argv[2]
const key = process.env.N8N_API_KEY || (process.platform === 'win32'
  ? execFileSync('powershell.exe', ['-NoProfile', '-Command',
    "[Environment]::GetEnvironmentVariable('N8N_API_KEY','User')"], { encoding: 'utf8' }).trim()
  : '')
if (!id || !key || !urlHttpValida(base)) throw new Error('uso: N8N_API_KEY=... npm run diag -- ID')

const h = { 'X-N8N-API-KEY': key, accept: 'application/json' }

const wfMeta = async (wid: string) => {
  const r = await fetch(`${base}/api/v1/workflows/${wid}`, { headers: h })
  if (!r.ok) throw new Error(`n8n respondeu HTTP ${r.status}`)
  return r.json() as Promise<{ name: string; active?: boolean; settings?: unknown; nodes?: { name: string; type: string; parameters?: unknown }[] }>
}

const r = await fetch(`${base}/api/v1/executions/${id}?includeData=true`, { headers: h })
if (!r.ok) throw new Error(`n8n respondeu HTTP ${r.status}`)
const txt = await r.text()
console.log(`bytes recebidos: ${(txt.length / 1048576).toFixed(1)} MB`)
const e = JSON.parse(txt) as Record<string, unknown>

console.log(`status=${e.status} mode=${e.mode} finished=${e.finished}`)
console.log(`startedAt=${e.startedAt} stoppedAt=${e.stoppedAt} waitTill=${e.waitTill}`)
console.log(`workflowId=${e.workflowId}`)

const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data as Record<string, unknown>
const rd = (d as { resultData?: Record<string, unknown> })?.resultData as { lastNodeExecuted?: string; error?: { message?: string; name?: string }; runData?: Record<string, { executionTime?: number; executionStatus?: string; data?: { main?: unknown[][] } }[]> }
console.log(`lastNodeExecuted=${rd?.lastNodeExecuted}`)
console.log(`erro no resultData: ${rd?.error ? redigirTexto(rd.error.message || rd.error.name) : 'nenhum'}`)

const linhas = []
for (const [no, runs] of Object.entries(rd?.runData || {})) {
  let itens = 0, tempo = 0, bytes = 0, status = ''
  for (const run of runs || []) {
    tempo += run.executionTime || 0
    status = run.executionStatus || status
    for (const saida of run.data?.main || []) itens += (saida || []).length
  }
  bytes = JSON.stringify(runs).length
  linhas.push({ no, runs: (runs || []).length, itens, tempoMs: tempo, mb: bytes / 1048576, status })
}
linhas.sort((a, b) => b.mb - a.mb)

console.log('\n=== nos por peso de dados ===')
for (const l of linhas.slice(0, 15)) {
  console.log(`${l.mb.toFixed(1).padStart(7)} MB | ${String(l.runs).padStart(5)} exec | ${String(l.itens).padStart(7)} itens | ${String(Math.round(l.tempoMs)).padStart(8)} ms | ${l.status.padEnd(9)} | ${l.no}`)
}
const totalMb = linhas.reduce((n, l) => n + l.mb, 0)
const totalItens = linhas.reduce((n, l) => n + l.itens, 0)
console.log(`\ntotal: ${totalMb.toFixed(1)} MB, ${totalItens} itens, ${linhas.length} nos`)

const pend = (d as { executionData?: { nodeExecutionStack?: { node?: { name?: string; type?: string } }[] } })?.executionData?.nodeExecutionStack || []
console.log(`pilha pendente: ${pend.length}`)
if (pend.length) console.log(`  proximo: ${pend[0]?.node?.name} (${pend[0]?.node?.type})`)
const esperando = (d as { executionData?: { waitingExecution?: Record<string, unknown> } })?.executionData?.waitingExecution || {}
console.log(`waitingExecution: ${Object.keys(esperando).length} chave(s)`)

const wf = await wfMeta(String(e.workflowId))
console.log(`\nfluxo: ${wf.name} | ativo=${wf.active}`)
console.log(`settings: ${JSON.stringify(redigir(wf.settings))}`)
const loops = (wf.nodes || []).filter((n) => /splitInBatches|itemLists|loop/i.test(n.type))
console.log(`nos de loop: ${loops.map((n) => `${n.name} (${n.type}) opts=${JSON.stringify(redigir(n.parameters))}`).join(' ; ') || 'nenhum'}`)
