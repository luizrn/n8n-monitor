// Painel de monitoramento do n8n.
//
// A chave da API fica SEMPRE do lado do servidor: e lida de um arquivo de config
// em %LOCALAPPDATA% (fora do repositorio, para nao ser commitada por acidente) e
// nunca e enviada ao navegador. O endpoint /api/config responde apenas se existe
// chave configurada, jamais o valor.
//
// Escuta so em 127.0.0.1.

import { createServer } from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gatilhosDe, regraParaCron, descreverRegra, esperadas, comparar } from './cron.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const PORTA = Number(process.env.PORT || 8787)

const DIR_CONFIG = join(
  process.env.LOCALAPPDATA || process.env.HOME || AQUI,
  'n8n-monitor'
)
const ARQ_CONFIG = join(DIR_CONFIG, 'config.json')

const PADRAO = {
  baseUrl: process.env.N8N_BASE_URL || 'http://localhost:5678',
  apiKey: '',
  ativo: true,
  fuso: 'America/Cuiaba',   // usado quando o workflow nao define timezone proprio
  horasCron: 24,            // janela da conferencia configurado-vs-executou
  toleranciaMin: 5,         // atraso aceito antes de considerar ocorrencia perdida
}

let config = { ...PADRAO }

// ---------------------------------------------------------------- config

async function lerRegistroWindows() {
  if (process.platform !== 'win32') return ''
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('N8N_API_KEY','User')"],
      { timeout: 10000 },
      (erro, saida) => resolve(erro ? '' : String(saida).trim())
    )
  })
}

async function carregarConfig() {
  try {
    config = { ...PADRAO, ...JSON.parse(await readFile(ARQ_CONFIG, 'utf8')) }
  } catch {
    config = { ...PADRAO }
  }
  // Semeia a chave do ambiente na primeira execucao, para funcionar de imediato.
  if (!config.apiKey) {
    config.apiKey = process.env.N8N_API_KEY || (await lerRegistroWindows()) || ''
    if (config.apiKey) await salvarConfig()
  }
}

async function salvarConfig() {
  await mkdir(DIR_CONFIG, { recursive: true })
  await writeFile(ARQ_CONFIG, JSON.stringify(config, null, 2), { mode: 0o600 })
}

// ---------------------------------------------------------------- n8n

const cacheNomes = new Map()
let nomesEm = 0

async function chamarN8n(caminho) {
  if (!config.apiKey || !config.baseUrl) throw new Error('nao configurado')
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 25000)
  try {
    const r = await fetch(config.baseUrl.replace(/\/+$/, '') + caminho, {
      headers: { 'X-N8N-API-KEY': config.apiKey, accept: 'application/json' },
      signal: ctrl.signal,
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally {
    clearTimeout(t)
  }
}

async function nomesDeFluxos() {
  if (Date.now() - nomesEm < 300000 && cacheNomes.size) return cacheNomes
  try {
    const r = await chamarN8n('/api/v1/workflows?limit=250')
    for (const w of r.data || []) cacheNomes.set(w.id, w.name)
    nomesEm = Date.now()
  } catch {
    /* mantem o cache anterior */
  }
  return cacheNomes
}

async function nomeDeFluxo(id) {
  const m = await nomesDeFluxos()
  if (m.has(id)) return m.get(id)
  try {
    const w = await chamarN8n(`/api/v1/workflows/${id}`)
    if (w?.name) { cacheNomes.set(id, w.name); return w.name }
  } catch { /* ignora */ }
  return id
}

const LIMITE_TRAVADA_MIN = 30
const JANELA_MS = 3600000

// A API limita a 250 por pagina. Sem paginar, o painel reporta 250 como se fosse
// o total da hora - mentindo para baixo justamente quando o volume explode, que e
// quando o numero importa. Segue pelo nextCursor ate cobrir a janela.
async function paginarExecucoes(query, { paginas = 6, ate = null } = {}) {
  const itens = []
  let cursor = null
  for (let p = 0; p < paginas; p++) {
    const q = `/api/v1/executions?limit=250&${query}` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '')
    const r = await chamarN8n(q)
    const lote = r.data || []
    itens.push(...lote)
    cursor = r.nextCursor
    if (!cursor || !lote.length) break
    if (ate) {
      const maisVelho = lote[lote.length - 1]?.startedAt
      if (maisVelho && new Date(maisVelho).getTime() < ate) break
    }
  }
  return { itens, truncado: Boolean(cursor) }
}

// Agrupa erros repetidos: um fluxo que falha 200 vezes pelo mesmo motivo deve
// virar UMA linha com contador, nao 200 linhas. O detalhe (no que falhou e
// mensagem) e buscado so para o mais recente de cada grupo, para nao fazer uma
// chamada por execucao.
async function agruparErros(lista) {
  const porFluxo = new Map()
  for (const e of lista) {
    const g = porFluxo.get(e.workflowId) || { workflowId: e.workflowId, execs: [] }
    g.execs.push(e)
    porFluxo.set(e.workflowId, g)
  }

  const grupos = [...porFluxo.values()].sort(
    (a, b) => new Date(b.execs[0].startedAt) - new Date(a.execs[0].startedAt)
  )

  const MAX_DETALHE = 10
  const saida = []
  for (const [i, g] of grupos.entries()) {
    const novo = g.execs[0]
    let no = null, mensagem = null
    if (i < MAX_DETALHE) {
      try {
        const ex = await chamarN8n(`/api/v1/executions/${novo.id}?includeData=true`)
        const rd = ex?.data?.resultData
        const f = acharFalha(rd?.runData) || (rd?.error ? { no: rd.lastNodeExecuted, erro: rd.error } : null)
        no = f?.no ?? rd?.lastNodeExecuted ?? null
        mensagem = f?.erro?.message ?? null
      } catch { /* segue sem detalhe */ }
    }
    saida.push({
      workflowId: g.workflowId,
      fluxo: await nomeDeFluxo(g.workflowId),
      no,
      mensagem,
      total: g.execs.length,
      ids: g.execs.slice(0, 50).map((x) => x.id),
      idExemplo: novo.id,
      ultimo: novo.startedAt,
      primeiro: g.execs[g.execs.length - 1].startedAt,
      modo: novo.mode,
      detalheOmitido: i >= MAX_DETALHE,
    })
  }
  return saida
}

async function montarEstado() {
  const agora = Date.now()
  const desde = agora - JANELA_MS

  const [pgRecentes, pgErros, pgRodando] = await Promise.all([
    paginarExecucoes('', { paginas: 6, ate: desde }),
    paginarExecucoes('status=error', { paginas: 3, ate: desde }),
    paginarExecucoes('status=running', { paginas: 1 }),
  ])

  const recentes = { data: pgRecentes.itens }
  const erros = { data: pgErros.itens }
  const rodando = { data: pgRodando.itens }

  await nomesDeFluxos()

  const comNome = async (e) => ({
    id: e.id,
    fluxo: await nomeDeFluxo(e.workflowId),
    workflowId: e.workflowId,
    status: e.status,
    modo: e.mode,
    inicio: e.startedAt,
    fim: e.stoppedAt,
    minutos: e.startedAt ? (agora - new Date(e.startedAt).getTime()) / 60000 : null,
  })

  const errosJanela = (erros.data || []).filter(
    (e) => e.startedAt && agora - new Date(e.startedAt).getTime() <= JANELA_MS
  )
  const gruposErro = await agruparErros(errosJanela.length ? errosJanela : (erros.data || []).slice(0, 60))
  const listaRodando = await Promise.all((rodando.data || []).slice(0, 30).map(comNome))

  // Execucoes por minuto nos ultimos 60 min, separadas por desfecho.
  // Um pico aqui e a assinatura de um loop de auto-disparo.
  const baldes = new Map()
  for (let i = 59; i >= 0; i--) {
    const t = new Date(agora - i * 60000)
    t.setSeconds(0, 0)
    baldes.set(t.toISOString(), { minuto: t.toISOString(), ok: 0, erro: 0 })
  }
  for (const e of recentes.data || []) {
    if (!e.startedAt) continue
    const t = new Date(e.startedAt)
    t.setSeconds(0, 0)
    const b = baldes.get(t.toISOString())
    if (!b) continue
    if (e.status === 'error' || e.status === 'crashed') b.erro++
    else b.ok++
  }

  const porFluxo = new Map()
  for (const e of recentes.data || []) {
    if (!e.startedAt || agora - new Date(e.startedAt).getTime() > 3600000) continue
    const k = e.workflowId
    const v = porFluxo.get(k) || { workflowId: k, fluxo: cacheNomes.get(k) || k, total: 0, erros: 0 }
    v.total++
    if (e.status === 'error' || e.status === 'crashed') v.erros++
    porFluxo.set(k, v)
  }

  const umaHora = (recentes.data || []).filter(
    (e) => e.startedAt && agora - new Date(e.startedAt).getTime() <= 3600000
  )

  return {
    ok: true,
    momento: new Date(agora).toISOString(),
    baseUrl: config.baseUrl,
    tiles: {
      errosHora: umaHora.filter((e) => e.status === 'error' || e.status === 'crashed').length,
      execucoesHora: umaHora.length,
      rodando: listaRodando.length,
      travadas: listaRodando.filter((e) => (e.minutos ?? 0) >= LIMITE_TRAVADA_MIN).length,
      porMinuto: umaHora.length / 60,
      truncado: pgRecentes.truncado,
    },
    serie: [...baldes.values()],
    erros: gruposErro,
    rodando: listaRodando,
    porFluxo: [...porFluxo.values()].sort((a, b) => b.total - a.total).slice(0, 12),
    limiteTravadaMin: LIMITE_TRAVADA_MIN,
  }
}

// ------------------------------------------- configurado vs executou (cron)

let cacheCron = { em: 0, dados: null }

async function conferirAgendamentos() {
  if (Date.now() - cacheCron.em < 120000 && cacheCron.dados) return cacheCron.dados

  const wfs = await chamarN8n('/api/v1/workflows?limit=250')
  const fim = Date.now()
  const inicio = fim - config.horasCron * 3600000

  const alvos = []
  for (const wf of wfs.data || []) {
    const gats = gatilhosDe(wf)
    if (!gats.length) continue
    alvos.push({ wf, gats })
  }

  const linhas = []
  for (const { wf, gats } of alvos.slice(0, 40)) {
    const tz = wf.settings?.timezone && wf.settings.timezone !== 'DEFAULT'
      ? wf.settings.timezone : config.fuso

    let execs = []
    try {
      const pg = await paginarExecucoes(`workflowId=${encodeURIComponent(wf.id)}`, { paginas: 3, ate: inicio })
      execs = pg.itens
        .filter((e) => e.startedAt && new Date(e.startedAt).getTime() >= inicio)
        .filter((e) => e.mode === 'trigger' || e.mode === 'scheduled')
        .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt))
    } catch { /* segue sem execucoes */ }

    for (const g of gats) {
      const campos = regraParaCron(g.item)
      const desc = descreverRegra(g.item)

      if (!campos) {
        linhas.push({
          fluxo: wf.name, workflowId: wf.id, no: g.no, regra: desc, fuso: tz,
          ativo: Boolean(wf.active), desativado: g.desativado,
          veredito: 'nao-comparavel',
          detalhe: g.item?.field === 'seconds'
            ? 'intervalo em segundos: granularidade fina demais para conferir'
            : 'regra não reconhecida pelo avaliador',
          esperado: null, cumpridas: null, perdidas: [], atrasoMedioSeg: null, ultimaExec: execs.at(-1)?.startedAt ?? null,
        })
        continue
      }

      // ATENCAO A RETENCAO. Esta instancia guarda pouca execucao: o grosso do que
      // rodou ha mais de uma ou duas horas ja foi podado. Contar essas ocorrencias
      // como "perdidas" inventa falha - foi o que a primeira versao deste codigo
      // fez, reportando 66 de 72 perdidas num job que estava saudavel.
      // Logo: so julgamos o intervalo em que EXISTE execucao retida como prova.
      const inativo = !wf.active || g.desativado
      const horizonte = execs.length
        ? Math.max(inicio, new Date(execs[0].startedAt).getTime())
        : null

      if (!inativo && horizonte === null) {
        linhas.push({
          fluxo: wf.name, workflowId: wf.id, no: g.no, regra: desc, fuso: tz,
          ativo: Boolean(wf.active), desativado: g.desativado,
          veredito: 'sem-dados',
          detalhe: 'nenhuma execução retida na janela — a retenção do banco não permite afirmar se rodou',
          esperado: null, cumpridas: null, perdidas: [], totalPerdidas: 0, extras: 0,
          atrasoMedioSeg: null, janelaVerificadaHoras: 0,
          ultimoPrevisto: esperadas(campos, tz, inicio, fim).at(-1)?.toISOString() ?? null,
          ultimaExec: null,
        })
        continue
      }

      const de = inativo ? inicio : horizonte
      const ocor = esperadas(campos, tz, de, fim)
      // A ultima ocorrencia pode ainda estar dentro da tolerancia: nao cobrar.
      const cobraveis = ocor.filter((o) => fim - o.getTime() > config.toleranciaMin * 60000)
      const cmp = comparar(cobraveis, execs, config.toleranciaMin)

      let veredito = 'ok'
      if (inativo) veredito = 'inativo'
      else if (cobraveis.length === 0) veredito = 'sem-janela'
      else if (cmp.cumpridas.length === 0) veredito = 'nunca-executou'
      else if (cmp.perdidas.length) veredito = 'com-falhas'

      const atrasos = cmp.cumpridas.map((c) => c.atrasoSeg)
      linhas.push({
        fluxo: wf.name, workflowId: wf.id, no: g.no, regra: desc, fuso: tz,
        ativo: Boolean(wf.active), desativado: g.desativado,
        veredito,
        janelaVerificadaHoras: inativo ? null : Number(((fim - de) / 3600000).toFixed(1)),
        esperado: cobraveis.length,
        cumpridas: cmp.cumpridas.length,
        perdidas: cmp.perdidas.slice(-12),
        totalPerdidas: cmp.perdidas.length,
        extras: cmp.extras.length,
        atrasoMedioSeg: atrasos.length ? Math.round(atrasos.reduce((a, b) => a + b, 0) / atrasos.length) : null,
        ultimoPrevisto: cobraveis.at(-1)?.toISOString() ?? null,
        ultimaExec: execs.at(-1)?.startedAt ?? null,
      })
    }
  }

  const ordem = { 'nunca-executou': 0, 'com-falhas': 1, 'sem-dados': 2, 'nao-comparavel': 3, ok: 4, 'sem-janela': 5, inativo: 6 }
  linhas.sort((a, b) => (ordem[a.veredito] ?? 9) - (ordem[b.veredito] ?? 9) || (b.totalPerdidas ?? 0) - (a.totalPerdidas ?? 0))

  cacheCron = { em: Date.now(), dados: { ok: true, janelaHoras: config.horasCron, toleranciaMin: config.toleranciaMin, fusoPadrao: config.fuso, linhas } }
  return cacheCron.dados
}

// ------------------------------------------------- diagnostico copiavel

// Os dados de execucao carregam segredos em texto puro (o token do RD esta
// chumbado nos query params dos nos HTTP deste projeto). O dump que vai para a
// area de transferencia e depois para um chat NAO pode levar isso.
const CHAVE_SENSIVEL = /(token|apikey|api_key|secret|senha|password|authorization|cookie|bearer|credential)/i

function redigir(valor, prof = 0) {
  if (prof > 12) return '[fundo]'
  if (Array.isArray(valor)) return valor.map((v) => redigir(v, prof + 1))
  if (valor && typeof valor === 'object') {
    const saida = {}
    for (const [k, v] of Object.entries(valor)) {
      if (CHAVE_SENSIVEL.test(k)) { saida[k] = '[REDIGIDO]'; continue }
      // {name: "token", value: "..."} - o padrao dos parametros do n8n
      if (k === 'value' && CHAVE_SENSIVEL.test(String(valor.name ?? ''))) {
        saida[k] = '[REDIGIDO]'
        continue
      }
      saida[k] = redigir(v, prof + 1)
    }
    return saida
  }
  if (typeof valor === 'string') {
    if (/^ey[A-Za-z0-9_-]{20,}\./.test(valor)) return '[REDIGIDO:jwt]'
    if (/^[0-9a-f]{24}$/i.test(valor) && valor.length === 24) return valor // id do RD, nao e segredo
    return valor
  }
  return valor
}

function acharFalha(runData) {
  for (const [no, execs] of Object.entries(runData || {})) {
    for (const ex of execs || []) {
      if (ex?.error) return { no, erro: ex.error, tempo: ex.executionTime }
    }
  }
  return null
}

function montarDiagnostico(meta, fluxo, exec) {
  const rd = exec?.data?.resultData
  const falha = acharFalha(rd?.runData) || (rd?.error ? { no: rd.lastNodeExecuted, erro: rd.error } : null)
  const e = falha?.erro || {}
  const L = []
  L.push('## Erro no n8n')
  L.push('')
  L.push(`- fluxo: ${fluxo} (\`${meta.workflowId}\`)`)
  L.push(`- execucao: \`${meta.id}\`  status: ${meta.status}  modo: ${meta.mode}`)
  L.push(`- inicio: ${meta.startedAt}  fim: ${meta.stoppedAt ?? '(nao terminou)'}`)
  L.push(`- no que falhou: **${falha?.no ?? rd?.lastNodeExecuted ?? '(desconhecido)'}**`)
  L.push(`- url: ${config.baseUrl}/workflow/${meta.workflowId}/executions/${meta.id}`)
  L.push('')
  if (e.message || e.description || e.httpCode) {
    L.push('### Mensagem')
    if (e.message) L.push(`\`\`\`\n${e.message}\n\`\`\``)
    if (e.description) L.push(`descricao: ${e.description}`)
    if (e.httpCode) L.push(`httpCode: ${e.httpCode}`)
    if (e.name) L.push(`tipo: ${e.name}`)
    if (Array.isArray(e.messages) && e.messages.length) L.push(`dicas: ${e.messages.join(' | ')}`)
    L.push('')
  }
  if (e.node) {
    L.push('### Nó (parâmetros, credenciais redigidas)')
    L.push('```json')
    L.push(JSON.stringify(redigir({ name: e.node.name, type: e.node.type, typeVersion: e.node.typeVersion, retryOnFail: e.node.retryOnFail, maxTries: e.node.maxTries, onError: e.node.onError, parameters: e.node.parameters }), null, 2))
    L.push('```')
    L.push('')
  }
  if (e.context) {
    L.push('### Contexto da requisição (redigido)')
    L.push('```json')
    L.push(JSON.stringify(redigir(e.context), null, 2))
    L.push('```')
    L.push('')
  }
  const nos = Object.keys(rd?.runData || {})
  if (nos.length) {
    L.push(`### Nós executados (${nos.length})`)
    L.push(nos.map((n) => `- ${n}`).join('\n'))
    L.push('')
  }
  if (e.stack) {
    L.push('### Stack')
    L.push('```')
    L.push(String(e.stack).split('\n').slice(0, 12).join('\n'))
    L.push('```')
  }
  L.push('')
  L.push('_Credenciais redigidas automaticamente pelo painel._')
  return L.join('\n')
}

// ---------------------------------------------------------------- http

function json(res, codigo, corpo) {
  const s = JSON.stringify(corpo)
  res.writeHead(codigo, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(s)
}

async function lerCorpo(req) {
  const partes = []
  for await (const c of req) {
    partes.push(c)
    if (partes.reduce((n, p) => n + p.length, 0) > 1e6) throw new Error('corpo grande')
  }
  return JSON.parse(Buffer.concat(partes).toString('utf8') || '{}')
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')

  try {
    if (url.pathname === '/api/config' && req.method === 'GET') {
      return json(res, 200, {
        baseUrl: config.baseUrl,
        temChave: Boolean(config.apiKey),
        ativo: config.ativo,
        caminhoConfig: ARQ_CONFIG,
      })
    }

    if (url.pathname === '/api/config' && req.method === 'POST') {
      const corpo = await lerCorpo(req)
      if (typeof corpo.baseUrl === 'string' && corpo.baseUrl.trim()) {
        config.baseUrl = corpo.baseUrl.trim()
      }
      // String vazia = manter a chave atual. Nunca devolvemos o valor.
      if (typeof corpo.apiKey === 'string' && corpo.apiKey.trim()) {
        config.apiKey = corpo.apiKey.trim()
      }
      if (typeof corpo.ativo === 'boolean') config.ativo = corpo.ativo
      cacheNomes.clear()
      nomesEm = 0
      await salvarConfig()
      return json(res, 200, { salvo: true, temChave: Boolean(config.apiKey), ativo: config.ativo })
    }

    if (url.pathname === '/api/teste' && req.method === 'POST') {
      try {
        await chamarN8n('/api/v1/workflows?limit=1')
        return json(res, 200, { ok: true })
      } catch (e) {
        return json(res, 200, { ok: false, erro: String(e.message || e) })
      }
    }

    if (url.pathname === '/api/state') {
      if (!config.ativo) return json(res, 200, { ok: false, motivo: 'pausado' })
      if (!config.apiKey) return json(res, 200, { ok: false, motivo: 'sem-chave' })
      try {
        return json(res, 200, await montarEstado())
      } catch (e) {
        return json(res, 200, { ok: false, motivo: 'erro-api', detalhe: String(e.message || e) })
      }
    }

    if (url.pathname === '/api/cron') {
      if (!config.apiKey) return json(res, 200, { ok: false, motivo: 'sem-chave' })
      try {
        if (url.searchParams.get('recarregar')) cacheCron = { em: 0, dados: null }
        return json(res, 200, await conferirAgendamentos())
      } catch (e) {
        return json(res, 200, { ok: false, motivo: 'erro-api', detalhe: String(e.message || e) })
      }
    }

    if (url.pathname === '/api/execucao') {
      const id = url.searchParams.get('id')
      if (!id) return json(res, 400, { ok: false, erro: 'falta id' })
      try {
        const exec = await chamarN8n(`/api/v1/executions/${encodeURIComponent(id)}?includeData=true`)
        const fluxo = await nomeDeFluxo(exec.workflowId)
        return json(res, 200, {
          ok: true,
          fluxo,
          diagnostico: montarDiagnostico(exec, fluxo, exec),
        })
      } catch (e) {
        return json(res, 200, { ok: false, erro: String(e.message || e) })
      }
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = await readFile(join(AQUI, 'public', 'index.html'))
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      return res.end(html)
    }

    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('nao encontrado')
  } catch (e) {
    json(res, 500, { ok: false, erro: String(e.message || e) })
  }
})

await carregarConfig()
servidor.listen(PORTA, '127.0.0.1', () => {
  console.log(`painel n8n em http://127.0.0.1:${PORTA}`)
  console.log(`config: ${ARQ_CONFIG}`)
  console.log(`chave configurada: ${config.apiKey ? 'sim' : 'nao'}`)
})
