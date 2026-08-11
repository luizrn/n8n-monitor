// Painel de monitoramento do n8n.
//
// As chaves de API ficam SEMPRE do lado do servidor: sao lidas de um arquivo de
// config em %LOCALAPPDATA% (fora do repositorio, para nao ser commitado por
// acidente) e nunca sao enviadas ao navegador. O endpoint /api/config responde
// apenas SE existe chave configurada, jamais o valor.
//
// Escuta so em 127.0.0.1.

import { createServer } from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { join, dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gatilhosDe, regraParaCron, descreverRegra, esperadas, comparar } from './cron.mjs'
import { clienteDe, criarCliente, descartarClientes, idDeInstancia } from './instancias.mjs'
import { coletarUptime } from './uptime.mjs'
import { criarRepo, ESTADOS as ESTADOS_TAREFA, normalizarEstado } from './tarefas.mjs'
import { montarAlertas } from './alertas.mjs'
import { criarResolvedorRdap } from './rdap.mjs'
import { criarDispatcherWebhook, payloadDe } from './webhook.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const PORTA = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '127.0.0.1'

const DIR_CONFIG = process.env.N8N_MONITOR_DATA_DIR
  ? resolve(process.env.N8N_MONITOR_DATA_DIR)
  : join(process.env.LOCALAPPDATA || process.env.HOME || AQUI, 'n8n-monitor')
const ARQ_CONFIG = join(DIR_CONFIG, 'config.json')
const ARQ_RECON = join(DIR_CONFIG, 'reconhecimentos.json')
const ARQ_TAREFAS = join(DIR_CONFIG, 'tarefas.json')
const ARQ_WEBHOOK = join(DIR_CONFIG, 'webhook-estado.json')

const NOTIF_PADRAO = {
  // 0 = o toast nao fecha sozinho. O maximo de 600s vem do pedido de "ate 10min".
  toastSeg: 60,
  navegador: false,
  som: false,
  volume: 0.5,
}

const UPTIME_PADRAO = {
  ativo: false,
  baseUrl: '',
  token: '',
  slug: '',
  monitores: {},      // nome -> boolean; ausente = ativo
  avisarCertDias: 21,
}

const WEBHOOK_PADRAO = {
  ativo: false,
  url: '',
  bearer: '',
}

const PADRAO = {
  instancias: [],
  ativo: true,
  fuso: 'America/Cuiaba',   // usado quando o workflow nao define timezone proprio
  horasCron: 24,            // janela da conferencia configurado-vs-executou
  toleranciaMin: 5,         // atraso aceito antes de considerar ocorrencia perdida
  notificacoes: { ...NOTIF_PADRAO },
  uptimeKuma: { ...UPTIME_PADRAO },
  webhook: { ...WEBHOOK_PADRAO },
}

let config = { ...PADRAO }

const LIMITE_TRAVADA_MIN = 30
const JANELA_MS = 3600000
const ehErro = (s) => s === 'error' || s === 'crashed'

// ---------------------------------------------------------------- config

async function lerRegistroWindows() {
  if (process.platform !== 'win32') return ''
  return new Promise((ok) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('N8N_API_KEY','User')"],
      { timeout: 10000 },
      (erro, saida) => ok(erro ? '' : String(saida).trim())
    )
  })
}

function saneaInstancia(cru, i) {
  const nome = String(cru?.nome || '').trim() || `n8n ${i + 1}`
  return {
    id: String(cru?.id || '').trim() || idDeInstancia(nome),
    nome,
    baseUrl: String(cru?.baseUrl || '').trim().replace(/\/+$/, ''),
    apiKey: String(cru?.apiKey || ''),
    ativo: cru?.ativo !== false,
  }
}

// MIGRACAO. A primeira versao guardava uma instancia unica em `baseUrl`/`apiKey`
// na raiz da config. Ler isso e converter em lista e o que evita que quem ja
// usava o painel perca a configuracao ao atualizar.
function migrar(cru) {
  const c = { ...PADRAO, ...cru }
  c.notificacoes = { ...NOTIF_PADRAO, ...(cru?.notificacoes || {}) }
  c.uptimeKuma = { ...UPTIME_PADRAO, ...(cru?.uptimeKuma || {}) }
  c.webhook = { ...WEBHOOK_PADRAO, ...(cru?.webhook || {}) }

  if (!Array.isArray(c.instancias) || !c.instancias.length) {
    const url = String(cru?.baseUrl || process.env.N8N_BASE_URL || '').trim()
    const chave = String(cru?.apiKey || '').trim()
    c.instancias = (url || chave)
      ? [{ id: 'principal', nome: 'Principal', baseUrl: url || 'http://localhost:5678', apiKey: chave, ativo: true }]
      : []
  }
  c.instancias = c.instancias.map(saneaInstancia)

  // ids duplicados quebram o cache por instancia e o roteamento de /api/execucao
  const vistos = new Set()
  for (const inst of c.instancias) {
    let id = inst.id, n = 2
    while (vistos.has(id)) id = `${inst.id}-${n++}`
    inst.id = id
    vistos.add(id)
  }

  delete c.baseUrl
  delete c.apiKey
  return c
}

async function carregarConfig() {
  let cru = {}
  try { cru = JSON.parse(await readFile(ARQ_CONFIG, 'utf8')) } catch { cru = {} }
  config = migrar(cru)

  // Semeia a primeira instancia a partir do ambiente, para o painel funcionar de
  // imediato numa maquina recem-configurada.
  if (!config.instancias.length) {
    const chave = process.env.N8N_API_KEY || (await lerRegistroWindows()) || ''
    if (chave) {
      config.instancias = [{
        id: 'principal', nome: 'Principal',
        baseUrl: (process.env.N8N_BASE_URL || 'http://localhost:5678').replace(/\/+$/, ''),
        apiKey: chave, ativo: true,
      }]
      await salvarConfig()
    }
  } else if (config.instancias.length === 1 && !config.instancias[0].apiKey) {
    const chave = process.env.N8N_API_KEY || (await lerRegistroWindows()) || ''
    if (chave) { config.instancias[0].apiKey = chave; await salvarConfig() }
  }
}

async function salvarConfig() {
  await mkdir(DIR_CONFIG, { recursive: true })
  await writeFile(ARQ_CONFIG, JSON.stringify(config, null, 2), { mode: 0o600 })
}

const instanciasAtivas = () => config.instancias.filter((i) => i.ativo && i.apiKey && i.baseUrl)
const instanciaPorId = (id) => config.instancias.find((i) => i.id === id) || null

// Instancia publicavel: tudo menos o segredo.
const publica = (i) => ({
  id: i.id, nome: i.nome, baseUrl: i.baseUrl, ativo: i.ativo, temChave: Boolean(i.apiKey),
})

// ------------------------------------------- reconhecimento de alertas
//
// Guardado em disco, nao no navegador: marcar algo como tratado e informacao de
// equipe, e some se ficar preso a um localStorage.
//
// A magnitude no momento do reconhecimento e parte do registro. Assim, se o erro
// voltar a crescer, ele reaparece sozinho — reconhecer silencia o que ja se viu,
// nao o que ainda vai acontecer.
let reconhecimentos = {}

async function carregarReconhecimentos() {
  try { reconhecimentos = JSON.parse(await readFile(ARQ_RECON, 'utf8')) } catch { reconhecimentos = {} }
}
async function salvarReconhecimentos() {
  await mkdir(DIR_CONFIG, { recursive: true })
  await writeFile(ARQ_RECON, JSON.stringify(reconhecimentos, null, 2))
}
function limparReconhecimentosVelhos() {
  const limite = Date.now() - 7 * 86400000
  let mudou = false
  for (const [k, v] of Object.entries(reconhecimentos)) {
    if (new Date(v.em).getTime() < limite) { delete reconhecimentos[k]; mudou = true }
  }
  if (mudou) salvarReconhecimentos().catch(() => {})
}

const repoTarefas = criarRepo({
  ler: () => readFile(ARQ_TAREFAS, 'utf8'),
  gravar: async (t) => {
    await mkdir(DIR_CONFIG, { recursive: true })
    await writeFile(ARQ_TAREFAS, t, { mode: 0o600 })
  },
})

const rdap = criarResolvedorRdap()
const webhook = criarDispatcherWebhook({
  ler: () => readFile(ARQ_WEBHOOK, 'utf8'),
  gravar: async (texto) => {
    await mkdir(DIR_CONFIG, { recursive: true })
    await writeFile(ARQ_WEBHOOK, texto, { mode: 0o600 })
  },
  obterConfig: () => config.webhook,
})

function percentil(valores, p) {
  if (!valores.length) return null
  const v = valores.slice().sort((a, b) => a - b)
  return v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))]
}

// ------------------------------------------------------------- estado

function acharFalha(runData) {
  for (const [no, execs] of Object.entries(runData || {})) {
    for (const ex of execs || []) {
      if (ex?.error) return { no, erro: ex.error, tempo: ex.executionTime }
    }
  }
  return null
}

// Agrupa erros repetidos: um fluxo que falha 200 vezes pelo mesmo motivo deve
// virar UMA linha com contador, nao 200 linhas. O detalhe (no que falhou e
// mensagem) e buscado so para o mais recente de cada grupo, para nao fazer uma
// chamada por execucao.
async function agruparErros(cli, lista, todasRecentes = []) {
  const inst = cli.inst
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
        const ex = await cli.chamar(`/api/v1/executions/${novo.id}?includeData=true`)
        const rd = ex?.data?.resultData
        const f = acharFalha(rd?.runData) || (rd?.error ? { no: rd.lastNodeExecuted, erro: rd.error } : null)
        no = f?.no ?? rd?.lastNodeExecuted ?? null
        mensagem = f?.erro?.message ?? null
      } catch { /* segue sem detalhe */ }
    }
    // RESOLUCAO AUTOMATICA: se o mesmo fluxo voltou a rodar DEPOIS deste erro e
    // deu certo, o problema passou. Alerta que exige alguem lembrar de fechar
    // vira lixo acumulado na tela; este some sozinho, com a prova do que o
    // resolveu.
    const instanteErro = new Date(novo.startedAt).getTime()
    const sucessoDepois = todasRecentes.find(
      (e) => e.workflowId === g.workflowId && e.status === 'success'
        && e.startedAt && new Date(e.startedAt).getTime() > instanteErro
    )

    saida.push({
      instanciaId: inst.id,
      instancia: inst.nome,
      // A chave inclui a instancia porque os ids de workflow do n8n sao locais:
      // o mesmo id pode existir em duas instancias apontando para fluxos
      // diferentes, e sem o prefixo um reconhecimento silenciaria o alerta errado.
      chave: `erro:${inst.id}:${g.workflowId}:${no || ''}`,
      workflowId: g.workflowId,
      fluxo: await cli.nomeDeFluxo(g.workflowId),
      no,
      mensagem,
      resolvidoPor: sucessoDepois ? { id: sucessoDepois.id, quando: sucessoDepois.startedAt } : null,
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

async function estadoDaInstancia(inst, agora) {
  const cli = clienteDe(inst)
  const desde = agora - JANELA_MS

  const [pgRecentes, pgErros, pgRodando] = await Promise.all([
    cli.paginarExecucoes('', { paginas: 6, ate: desde }),
    cli.paginarExecucoes('status=error', { paginas: 3, ate: desde }),
    cli.paginarExecucoes('status=running', { paginas: 1 }),
  ])

  await cli.nomesDeFluxos()

  const comNome = async (e) => ({
    id: e.id,
    instanciaId: inst.id,
    instancia: inst.nome,
    fluxo: await cli.nomeDeFluxo(e.workflowId),
    workflowId: e.workflowId,
    status: e.status,
    modo: e.mode,
    inicio: e.startedAt,
    fim: e.stoppedAt,
    minutos: e.startedAt ? (agora - new Date(e.startedAt).getTime()) / 60000 : null,
  })

  const errosJanela = pgErros.itens.filter(
    (e) => e.startedAt && agora - new Date(e.startedAt).getTime() <= JANELA_MS
  )
  const todosGrupos = await agruparErros(
    cli,
    errosJanela.length ? errosJanela : pgErros.itens.slice(0, 60),
    pgRecentes.itens
  )
  const listaRodando = await Promise.all(pgRodando.itens.slice(0, 30).map(comNome))

  const umaHora = pgRecentes.itens.filter(
    (e) => e.startedAt && agora - new Date(e.startedAt).getTime() <= 3600000
  )

  const porFluxo = new Map()
  for (const e of umaHora) {
    const k = e.workflowId
    const v = porFluxo.get(k) || {
      workflowId: k, instanciaId: inst.id, instancia: inst.nome,
      fluxo: cli.nomes.get(k) || k, total: 0, erros: 0,
    }
    v.total++
    if (ehErro(e.status)) v.erros++
    porFluxo.set(k, v)
  }

  return {
    inst,
    recentes: pgRecentes.itens,
    // `truncado` na tela significa "o numero pode ser maior do que este", o que
    // so e verdade se a leitura NAO alcancou o inicio da janela.
    truncado: !pgRecentes.cobriu,
    grupos: todosGrupos,
    rodando: listaRodando,
    umaHora,
    porFluxo: [...porFluxo.values()],
  }
}

async function montarEstado() {
  const agora = Date.now()
  const ativas = instanciasAtivas()

  // Uma instancia inalcancavel NAO pode derrubar o painel das outras: cada uma e
  // resolvida em separado e reporta o proprio motivo de falha.
  const resultados = await Promise.all(ativas.map(async (inst) => {
    try {
      return { ok: true, dados: await estadoDaInstancia(inst, agora) }
    } catch (e) {
      return { ok: false, inst, motivo: String(e.message || e) }
    }
  }))

  const vivos = resultados.filter((r) => r.ok).map((r) => r.dados)
  const caidas = resultados.filter((r) => !r.ok)

  const todosGrupos = vivos.flatMap((v) => v.grupos)
  const gruposErro = todosGrupos.filter((g) => !g.resolvidoPor)
  const gruposResolvidos = todosGrupos.filter((g) => g.resolvidoPor)

  const rodando = vivos.flatMap((v) => v.rodando).sort((a, b) => (b.minutos ?? 0) - (a.minutos ?? 0))
  const umaHora = vivos.flatMap((v) => v.umaHora)
  const recentes = vivos.flatMap((v) => v.recentes)

  // Execucoes por minuto nos ultimos 60 min, somando as instancias. Um pico aqui
  // e a assinatura de um loop de auto-disparo.
  const baldes = new Map()
  for (let i = 59; i >= 0; i--) {
    const t = new Date(agora - i * 60000)
    t.setSeconds(0, 0)
    baldes.set(t.toISOString(), { minuto: t.toISOString(), ok: 0, erro: 0 })
  }
  for (const e of recentes) {
    if (!e.startedAt) continue
    const t = new Date(e.startedAt)
    t.setSeconds(0, 0)
    const b = baldes.get(t.toISOString())
    if (!b) continue
    b[ehErro(e.status) ? 'erro' : 'ok']++
  }

  return {
    ok: true,
    momento: new Date(agora).toISOString(),
    instancias: [
      ...vivos.map((v) => ({ ...publica(v.inst), alcancavel: true })),
      ...caidas.map((c) => ({ ...publica(c.inst), alcancavel: false, motivo: c.motivo })),
    ],
    // Instancia que nao responde e problema de nivel vermelho, e o painel precisa
    // dizer QUAL: com varias instancias, "n8n offline" sem nome nao ajuda ninguem.
    inalcancaveis: caidas.map((c) => ({ id: c.inst.id, nome: c.inst.nome, motivo: c.motivo })),
    tiles: {
      errosHora: umaHora.filter((e) => ehErro(e.status)).length,
      execucoesHora: umaHora.length,
      rodando: rodando.length,
      travadas: rodando.filter((e) => (e.minutos ?? 0) >= LIMITE_TRAVADA_MIN).length,
      porMinuto: umaHora.length / 60,
      truncado: vivos.some((v) => v.truncado),
    },
    serie: [...baldes.values()],
    erros: gruposErro,
    resolvidos: gruposResolvidos,
    reconhecimentos,
    tarefasAtivas: repoTarefas.chavesAtivas(),
    tarefasContagem: repoTarefas.contagem(),
    rodando,
    porFluxo: vivos.flatMap((v) => v.porFluxo).sort((a, b) => b.total - a.total).slice(0, 12),
    limiteTravadaMin: LIMITE_TRAVADA_MIN,
  }
}

// ------------------------------------------- configurado vs executou (cron)

const cacheCron = new Map()   // instanciaId -> { em, linhas }

async function cronDaInstancia(inst) {
  const guardado = cacheCron.get(inst.id)
  if (guardado && Date.now() - guardado.em < 300000) return guardado.linhas

  const cli = clienteDe(inst)
  const wfs = await cli.chamar('/api/v1/workflows?limit=250')
  const fim = Date.now()
  const inicio = fim - config.horasCron * 3600000

  const alvos = []
  for (const wf of wfs.data || []) {
    const gats = gatilhosDe(wf)
    if (gats.length) alvos.push({ wf, gats })
  }

  const linhas = []
  for (const { wf, gats } of alvos.slice(0, 40)) {
    const tz = wf.settings?.timezone && wf.settings.timezone !== 'DEFAULT'
      ? wf.settings.timezone : config.fuso

    let execs = []
    try {
      const pg = await cli.paginarExecucoes(`workflowId=${encodeURIComponent(wf.id)}`, { paginas: 3, ate: inicio })
      execs = pg.itens
        .filter((e) => e.startedAt && new Date(e.startedAt).getTime() >= inicio)
        .filter((e) => e.mode === 'trigger' || e.mode === 'scheduled')
        .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt))
    } catch { /* segue sem execucoes */ }

    const base = {
      instanciaId: inst.id, instancia: inst.nome,
      fluxo: wf.name, workflowId: wf.id,
      ativo: Boolean(wf.active), fuso: tz,
    }

    for (const g of gats) {
      const campos = regraParaCron(g.item)
      const desc = descreverRegra(g.item)
      const comum = { ...base, no: g.no, regra: desc, desativado: g.desativado }

      if (!campos) {
        linhas.push({
          ...comum,
          veredito: 'nao-comparavel',
          detalhe: g.item?.field === 'seconds'
            ? 'intervalo em segundos: granularidade fina demais para conferir'
            : 'regra não reconhecida pelo avaliador',
          esperado: null, cumpridas: null, perdidas: [], atrasoMedioSeg: null,
          ultimaExec: execs.at(-1)?.startedAt ?? null,
        })
        continue
      }

      // ATENCAO A RETENCAO. Esta instancia guarda pouca execucao: o grosso do que
      // rodou ha mais de uma ou duas horas ja foi podado. Contar essas ocorrencias
      // como "perdidas" inventa falha - foi o que a primeira versao deste codigo
      // fez, reportando 66 de 72 perdidas num job saudavel.
      // Logo: so julgamos o intervalo em que EXISTE execucao retida como prova.
      const inativo = !wf.active || g.desativado
      const horizonte = execs.length
        ? Math.max(inicio, new Date(execs[0].startedAt).getTime())
        : null

      if (!inativo && horizonte === null) {
        linhas.push({
          ...comum,
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
        ...comum,
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

  cacheCron.set(inst.id, { em: Date.now(), linhas })
  return linhas
}

const ORDEM_VER = {
  'nunca-executou': 0, 'com-falhas': 1, 'sem-dados': 2, 'nao-comparavel': 3,
  ok: 4, 'sem-janela': 5, inativo: 6,
}

async function conferirAgendamentos() {
  const ativas = instanciasAtivas()
  const lotes = await Promise.all(ativas.map(async (inst) => {
    try { return await cronDaInstancia(inst) } catch { return [] }
  }))
  const linhas = lotes.flat().sort(
    (a, b) => (ORDEM_VER[a.veredito] ?? 9) - (ORDEM_VER[b.veredito] ?? 9)
      || (b.totalPerdidas ?? 0) - (a.totalPerdidas ?? 0)
  )
  return {
    ok: true,
    janelaHoras: config.horasCron,
    toleranciaMin: config.toleranciaMin,
    fusoPadrao: config.fuso,
    linhas,
  }
}

// ------------------------------------------------- uptime kuma (cache curto)

let cacheUptime = { em: 0, dados: null }

async function uptimeAtual(forcar = false) {
  const cfg = config.uptimeKuma
  if (!cfg?.ativo) return { ok: false, motivo: 'desligado' }
  if (!forcar && Date.now() - cacheUptime.em < 20000 && cacheUptime.dados) return cacheUptime.dados
  const d = await coletarUptime(cfg)
  if (d.ok) d.dominios = await rdap.enriquecer(d.monitores)
  cacheUptime = { em: Date.now(), dados: d }
  return d
}

// ----------------------------------------- estado completo e coleta continua

let cacheCompleto = { em: 0, dados: null }
let coletaEmCurso = null

async function coletarCompleto(forcar = false) {
  if (!forcar && cacheCompleto.dados && Date.now() - cacheCompleto.em < 8000) return cacheCompleto.dados
  if (coletaEmCurso) return coletaEmCurso
  coletaEmCurso = (async () => {
    const [estado, cron, uptime] = await Promise.all([
      montarEstado(),
      conferirAgendamentos().catch((e) => ({ ok: false, motivo: 'erro', detalhe: String(e.message || e), linhas: [] })),
      uptimeAtual(forcar).catch((e) => ({ ok: false, motivo: 'erro', detalhe: String(e.message || e) })),
    ])
    const alertasAtivos = montarAlertas(estado, cron, uptime)
    const chaves = new Set(alertasAtivos.map((a) => a.chave))

    let limpou = false
    for (const chave of Object.keys(reconhecimentos)) {
      if (!chaves.has(chave)) { delete reconhecimentos[chave]; limpou = true }
    }
    if (limpou) await salvarReconhecimentos()
    await repoTarefas.resolverAusentes(chaves)

    const alertas = alertasAtivos.filter((a) => {
      const r = reconhecimentos[a.chave]
      return !r || Number(a.magnitude || 1) > Number(r.magnitude || 1)
    })
    const dados = {
      ...estado, cron, uptime, alertas, alertasAtivos: alertasAtivos.length,
      reconhecimentos, tarefasAtivas: repoTarefas.chavesAtivas(),
      tarefasContagem: repoTarefas.contagem(),
    }
    cacheCompleto = { em: Date.now(), dados }
    webhook.processar(alertasAtivos).catch((e) => console.error('webhook:', e.message || e))
    return dados
  })()
  try { return await coletaEmCurso } finally { coletaEmCurso = null }
}

function invalidarEstadoCompleto() {
  cacheCompleto = { em: 0, dados: null }
}

// ------------------------------------------------- diagnostico copiavel

// Os dados de execucao carregam segredos em texto puro (tokens chumbados nos
// query params dos nos HTTP). O dump que vai para a area de transferencia e
// depois para um chat NAO pode levar isso.
const CHAVE_SENSIVEL = /(token|apikey|api_key|secret|senha|password|authorization|cookie|bearer|credential)/i

function redigir(valor, prof = 0) {
  if (prof > 12) return '[fundo]'
  if (Array.isArray(valor)) return valor.map((v) => redigir(v, prof + 1))
  if (valor && typeof valor === 'object') {
    const saida = {}
    for (const [k, v] of Object.entries(valor)) {
      if (CHAVE_SENSIVEL.test(k)) { saida[k] = '[REDIGIDO]'; continue }
      // {name: "token", value: "..."} - o padrao dos parametros do n8n
      if (k === 'value' && CHAVE_SENSIVEL.test(String(valor.name ?? ''))) { saida[k] = '[REDIGIDO]'; continue }
      saida[k] = redigir(v, prof + 1)
    }
    return saida
  }
  if (typeof valor === 'string') {
    if (/^ey[A-Za-z0-9_-]{20,}\./.test(valor)) return '[REDIGIDO:jwt]'
    return valor
  }
  return valor
}

function montarDiagnostico(meta, fluxo, exec, inst) {
  const rd = exec?.data?.resultData
  const falha = acharFalha(rd?.runData) || (rd?.error ? { no: rd.lastNodeExecuted, erro: rd.error } : null)
  const e = falha?.erro || {}
  const L = []
  L.push('## Erro no n8n')
  L.push('')
  L.push(`- instancia: ${inst.nome} (\`${inst.id}\`)`)
  L.push(`- fluxo: ${fluxo} (\`${meta.workflowId}\`)`)
  L.push(`- execucao: \`${meta.id}\`  status: ${meta.status}  modo: ${meta.mode}`)
  L.push(`- inicio: ${meta.startedAt}  fim: ${meta.stoppedAt ?? '(nao terminou)'}`)
  L.push(`- no que falhou: **${falha?.no ?? rd?.lastNodeExecuted ?? '(desconhecido)'}**`)
  L.push(`- url: ${inst.baseUrl}/workflow/${meta.workflowId}/executions/${meta.id}`)
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
    L.push(JSON.stringify(redigir({
      name: e.node.name, type: e.node.type, typeVersion: e.node.typeVersion,
      retryOnFail: e.node.retryOnFail, maxTries: e.node.maxTries,
      onError: e.node.onError, parameters: e.node.parameters,
    }), null, 2))
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

// ---------------------------------------------- lista agregada (logs/dash)

// Concatena as instancias ativas numa unica linha do tempo. Cada item ja carrega
// `instancia`, entao a origem nunca se perde na mistura.
async function recentesDeTodas(paginas = 10) {
  const ativas = instanciasAtivas()
  const lotes = await Promise.all(ativas.map(async (inst) => {
    try { return await clienteDe(inst).listarRecentes(paginas) } catch { return null }
  }))
  const itens = lotes.filter(Boolean).flatMap((l) => l.itens)
    .sort((a, b) => new Date(b.inicio || 0) - new Date(a.inicio || 0))
  return {
    itens,
    // truncado = alguma instancia ficou sem ler tudo o que existe
    truncado: lotes.filter(Boolean).some((l) => !l.cobriu),
    falhas: ativas.filter((_, i) => !lotes[i]).map((i) => i.nome),
  }
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

const semInstancia = () => !instanciasAtivas().length

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')

  try {
    if (url.pathname === '/api/health') {
      return json(res, 200, { ok: true, uptimeSeg: Math.round(process.uptime()), coletaEm: cacheCompleto.dados?.momento || null })
    }

    // ---------------------------------------------------------- config
    if (url.pathname === '/api/config' && req.method === 'GET') {
      const uk = config.uptimeKuma
      return json(res, 200, {
        instancias: config.instancias.map(publica),
        ativo: config.ativo,
        caminhoConfig: ARQ_CONFIG,
        notificacoes: config.notificacoes,
        uptimeKuma: {
          ativo: uk.ativo, baseUrl: uk.baseUrl, slug: uk.slug,
          temToken: Boolean(uk.token), monitores: uk.monitores,
          avisarCertDias: uk.avisarCertDias,
        },
        webhook: {
          ativo: config.webhook.ativo, url: config.webhook.url,
          temBearer: Boolean(config.webhook.bearer), ultimo: webhook.status(),
        },
      })
    }

    if (url.pathname === '/api/config' && req.method === 'POST') {
      const corpo = await lerCorpo(req)

      if (Array.isArray(corpo.instancias)) {
        const antigas = new Map(config.instancias.map((i) => [i.id, i]))
        config.instancias = corpo.instancias.map((cru, i) => {
          const s = saneaInstancia(cru, i)
          // Chave vazia = manter a atual. Nunca devolvemos o valor ao navegador,
          // logo ele nao teria como reenviar o que ja esta salvo.
          if (!s.apiKey) s.apiKey = antigas.get(s.id)?.apiKey || ''
          return s
        })
        const vistos = new Set()
        for (const inst of config.instancias) {
          let id = inst.id, n = 2
          while (vistos.has(id)) id = `${inst.id}-${n++}`
          inst.id = id
          vistos.add(id)
        }
      }

      if (typeof corpo.ativo === 'boolean') config.ativo = corpo.ativo

      if (corpo.notificacoes && typeof corpo.notificacoes === 'object') {
        const n = corpo.notificacoes
        config.notificacoes = {
          toastSeg: Math.max(0, Math.min(600, Number(n.toastSeg ?? config.notificacoes.toastSeg))),
          navegador: Boolean(n.navegador),
          som: Boolean(n.som),
          volume: Math.max(0, Math.min(1, Number(n.volume ?? config.notificacoes.volume))),
        }
      }

      if (corpo.uptimeKuma && typeof corpo.uptimeKuma === 'object') {
        const u = corpo.uptimeKuma
        const atual = config.uptimeKuma
        config.uptimeKuma = {
          ativo: typeof u.ativo === 'boolean' ? u.ativo : atual.ativo,
          baseUrl: typeof u.baseUrl === 'string' ? u.baseUrl.trim().replace(/\/+$/, '') : atual.baseUrl,
          // token vazio = manter o atual, mesma regra das chaves do n8n
          token: typeof u.token === 'string' && u.token.trim() ? u.token.trim() : atual.token,
          slug: typeof u.slug === 'string' ? u.slug.trim() : atual.slug,
          monitores: u.monitores && typeof u.monitores === 'object' ? u.monitores : atual.monitores,
          avisarCertDias: Math.max(1, Math.min(365, Number(u.avisarCertDias ?? atual.avisarCertDias))),
        }
        cacheUptime = { em: 0, dados: null }
      }

      if (corpo.webhook && typeof corpo.webhook === 'object') {
        const w = corpo.webhook
        const atual = config.webhook
        config.webhook = {
          ativo: typeof w.ativo === 'boolean' ? w.ativo : atual.ativo,
          url: typeof w.url === 'string' ? w.url.trim() : atual.url,
          bearer: typeof w.bearer === 'string' && w.bearer.trim() ? w.bearer.trim() : atual.bearer,
        }
      }

      descartarClientes()
      cacheCron.clear()
      invalidarEstadoCompleto()
      await salvarConfig()
      return json(res, 200, { salvo: true, instancias: config.instancias.map(publica) })
    }

    if (url.pathname === '/api/teste' && req.method === 'POST') {
      const corpo = await lerCorpo(req)
      const salva = corpo.id ? instanciaPorId(corpo.id) : null
      const alvo = (corpo.baseUrl || corpo.apiKey)
        ? saneaInstancia({ ...salva, ...corpo, apiKey: corpo.apiKey || salva?.apiKey || '' }, 0)
        : (salva || instanciasAtivas()[0])
      if (!alvo) return json(res, 200, { ok: false, erro: 'instância não encontrada' })
      try {
        await criarCliente(alvo).chamar('/api/v1/workflows?limit=1')
        return json(res, 200, { ok: true, nome: alvo.nome })
      } catch (e) {
        return json(res, 200, { ok: false, nome: alvo.nome, erro: String(e.message || e) })
      }
    }

    // ---------------------------------------------------------- uptime kuma
    if (url.pathname === '/api/uptime') {
      try {
        return json(res, 200, await uptimeAtual(Boolean(url.searchParams.get('recarregar'))))
      } catch (e) {
        return json(res, 200, { ok: false, motivo: 'erro', detalhe: String(e.message || e) })
      }
    }

    // Teste de conexao da aba de config: le com os dados ENVIADOS, sem salvar,
    // para o usuario conferir antes de gravar. Token vazio usa o token salvo.
    if (url.pathname === '/api/uptime/teste' && req.method === 'POST') {
      const c = await lerCorpo(req)
      const cfg = {
        baseUrl: String(c.baseUrl || config.uptimeKuma.baseUrl || '').trim().replace(/\/+$/, ''),
        token: String(c.token || '').trim() || config.uptimeKuma.token,
        slug: String(c.slug ?? config.uptimeKuma.slug ?? '').trim(),
        monitores: config.uptimeKuma.monitores,
        avisarCertDias: config.uptimeKuma.avisarCertDias,
      }
      try {
        const d = await coletarUptime(cfg)
        if (d.ok) d.dominios = await rdap.enriquecer(d.monitores)
        return json(res, 200, d)
      } catch (e) {
        return json(res, 200, { ok: false, motivo: 'erro', detalhe: String(e.message || e) })
      }
    }

    if (url.pathname === '/api/webhook/teste' && req.method === 'POST') {
      const c = await lerCorpo(req)
      const cfg = {
        url: String(c.url || config.webhook.url || '').trim(),
        bearer: String(c.bearer || '').trim() || config.webhook.bearer,
      }
      return json(res, 200, await webhook.testar(cfg))
    }

    // ---------------------------------------------------------- estado
    if (url.pathname === '/api/state') {
      if (!config.ativo) return json(res, 200, { ok: false, motivo: 'pausado' })
      if (semInstancia() && !config.uptimeKuma.ativo) return json(res, 200, { ok: false, motivo: 'sem-chave' })
      try {
        return json(res, 200, await coletarCompleto(Boolean(url.searchParams.get('recarregar'))))
      } catch (e) {
        return json(res, 200, { ok: false, motivo: 'erro-api', detalhe: String(e.message || e) })
      }
    }

    if (url.pathname === '/api/reconhecer' && req.method === 'POST') {
      const c = await lerCorpo(req)
      if (!c.chave) return json(res, 400, { ok: false, erro: 'falta chave' })

      if (!c.estado) {
        delete reconhecimentos[c.chave]
        await repoTarefas.remover(c.chave)
      } else if (c.estado === 'analise') {
        // "Em analise" MOVE para Tarefas: o alerta sai do Monitor e passa a ter
        // estado proprio. O reconhecimento continua sendo gravado porque e ele
        // que guarda a magnitude — se o erro crescer alem do que foi visto, o
        // alerta reaparece mesmo havendo tarefa aberta.
        reconhecimentos[c.chave] = {
          estado: 'analise', magnitude: Number(c.magnitude ?? 1), em: new Date().toISOString(),
        }
        await repoTarefas.abrir({ ...(c.alerta || {}), chave: c.chave, magnitude: c.magnitude })
      } else {
        reconhecimentos[c.chave] = {
          estado: 'resolvido', magnitude: Number(c.magnitude ?? 1), em: new Date().toISOString(),
        }
        webhook.resolver(c.alerta || { chave: c.chave }, 'manual').catch(() => {})
      }

      limparReconhecimentosVelhos()
      await salvarReconhecimentos()
      invalidarEstadoCompleto()
      return json(res, 200, {
        ok: true, reconhecimentos,
        tarefasAtivas: repoTarefas.chavesAtivas(),
        tarefasContagem: repoTarefas.contagem(),
      })
    }

    // ---------------------------------------------------------- tarefas
    if (url.pathname === '/api/tarefas' && req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        estados: ESTADOS_TAREFA,
        itens: repoTarefas.lista(),
        contagem: repoTarefas.contagem(),
        instancias: config.instancias.map(publica),
      })
    }

    if (url.pathname === '/api/tarefas' && req.method === 'POST') {
      const c = await lerCorpo(req)
      if (!c.chave) return json(res, 400, { ok: false, erro: 'falta chave' })

      if (c.acao === 'remover') {
        await repoTarefas.remover(c.chave)
        delete reconhecimentos[c.chave]
        await salvarReconhecimentos()
      } else {
        const t = await repoTarefas.mover(c.chave, normalizarEstado(c.estado), c.nota)
        if (!t) return json(res, 404, { ok: false, erro: 'tarefa não encontrada' })
        // Coerencia com o Monitor: tarefa resolvida silencia o alerta de vez;
        // tarefa reaberta volta ao estado "em analise", que mantem o alerta fora
        // do Monitor mas visivel aqui.
        reconhecimentos[c.chave] = {
          estado: t.estado === 'resolvido' ? 'resolvido' : 'analise',
          magnitude: Number(t.magnitude || 1),
          em: new Date().toISOString(),
        }
        await salvarReconhecimentos()
        if (t.estado === 'resolvido') webhook.resolver(t, 'manual').catch(() => {})
      }

      invalidarEstadoCompleto()

      return json(res, 200, {
        ok: true, itens: repoTarefas.lista(), contagem: repoTarefas.contagem(),
      })
    }

    // ---------------------------------------------------------- logs
    if (url.pathname === '/api/logs') {
      if (semInstancia()) return json(res, 200, { ok: false, motivo: 'sem-chave' })
      const { itens, truncado, falhas } = await recentesDeTodas()

      const q = (url.searchParams.get('q') || '').trim().toLowerCase()
      const status = (url.searchParams.get('status') || '').split(',').filter(Boolean)
      const modo = (url.searchParams.get('modo') || '').split(',').filter(Boolean)
      const insts = (url.searchParams.get('instancias') || '').split(',').filter(Boolean)
      const horas = Number(url.searchParams.get('horas') || 0)
      const pagina = Math.max(0, Number(url.searchParams.get('pagina') || 0))
      const porPagina = Math.min(500, Math.max(10, Number(url.searchParams.get('limite') || 100)))
      const corte = horas ? Date.now() - horas * 3600000 : null

      const filtrados = itens.filter((e) => {
        if (status.length && !status.includes(e.status)) return false
        if (modo.length && !modo.includes(e.modo)) return false
        if (insts.length && !insts.includes(e.instanciaId)) return false
        if (corte && (!e.inicio || new Date(e.inicio).getTime() < corte)) return false
        if (!q) return true
        // busca por nome do fluxo ou por id da execucao
        return e.fluxo.toLowerCase().includes(q) || String(e.id).includes(q)
      })

      // facetas calculadas sobre o conjunto JA filtrado por busca/tempo, para os
      // contadores dos botoes baterem com o que o clique vai produzir
      const porStatus = {}, porModo = {}, porInstancia = {}
      for (const e of filtrados) {
        porStatus[e.status] = (porStatus[e.status] || 0) + 1
        porModo[e.modo] = (porModo[e.modo] || 0) + 1
        porInstancia[e.instanciaId] = (porInstancia[e.instanciaId] || 0) + 1
      }

      return json(res, 200, {
        ok: true,
        total: filtrados.length,
        universo: itens.length,
        truncado, falhas,
        pagina, porPagina,
        porStatus, porModo, porInstancia,
        instancias: config.instancias.map(publica),
        itens: filtrados.slice(pagina * porPagina, (pagina + 1) * porPagina),
      })
    }

    // ---------------------------------------------------------- dashboard
    if (url.pathname === '/api/dashboard') {
      if (semInstancia()) return json(res, 200, { ok: false, motivo: 'sem-chave' })
      const horas = Math.min(168, Math.max(1, Number(url.searchParams.get('horas') || 24)))
      // 250 execuções por página; quanto maior a janela, mais fundo é preciso ler
      const paginas = horas <= 2 ? 10 : horas <= 12 ? 30 : 60
      const { itens, truncado } = await recentesDeTodas(paginas)

      const insts = (url.searchParams.get('instancias') || '').split(',').filter(Boolean)
      const agora = Date.now()
      const corte = agora - horas * 3600000
      const janela = itens.filter((e) => e.inicio && new Date(e.inicio).getTime() >= corte)
        .filter((e) => !insts.length || insts.includes(e.instanciaId))

      // baldes por hora (ou por minuto quando a janela e curta)
      const passoMin = horas <= 2 ? 1 : horas <= 12 ? 10 : 60
      const passoMs = passoMin * 60000
      const baldes = new Map()
      for (let t = Math.floor(corte / passoMs) * passoMs; t <= agora; t += passoMs) {
        baldes.set(t, { t: new Date(t).toISOString(), ok: 0, erro: 0 })
      }
      for (const e of janela) {
        const t = Math.floor(new Date(e.inicio).getTime() / passoMs) * passoMs
        const b = baldes.get(t)
        if (b) b[ehErro(e.status) ? 'erro' : 'ok']++
      }

      // A chave agrega por instancia + fluxo: somar dois fluxos homonimos de
      // instancias diferentes numa linha so inventaria um volume que nao existe.
      const porFluxo = new Map()
      for (const e of janela) {
        const k = `${e.instanciaId}|${e.workflowId}`
        const v = porFluxo.get(k) || {
          workflowId: e.workflowId, fluxo: e.fluxo,
          instanciaId: e.instanciaId, instancia: e.instancia,
          total: 0, erros: 0, duracoes: [],
        }
        v.total++
        if (ehErro(e.status)) v.erros++
        if (e.duracaoMs != null) v.duracoes.push(e.duracaoMs)
        porFluxo.set(k, v)
      }
      const fluxos = [...porFluxo.values()].map((f) => ({
        workflowId: f.workflowId, fluxo: f.fluxo,
        instanciaId: f.instanciaId, instancia: f.instancia,
        total: f.total, erros: f.erros,
        taxaErro: f.total ? f.erros / f.total : 0,
        medianaMs: percentil(f.duracoes, 50),
        p95Ms: percentil(f.duracoes, 95),
      }))

      const porStatus = {}, porModo = {}, porInstancia = {}
      for (const e of janela) {
        porStatus[e.status] = (porStatus[e.status] || 0) + 1
        porModo[e.modo] = (porModo[e.modo] || 0) + 1
        porInstancia[e.instanciaId] = (porInstancia[e.instanciaId] || 0) + 1
      }
      const duracoes = janela.map((e) => e.duracaoMs).filter((d) => d != null)
      const erros = janela.filter((e) => ehErro(e.status)).length
      const maisAntiga = janela.length ? janela[janela.length - 1].inicio : null

      return json(res, 200, {
        ok: true,
        horas, passoMin, truncado,
        // quanto do periodo pedido a retencao realmente cobre
        coberturaHoras: maisAntiga
          ? Number(((agora - new Date(maisAntiga).getTime()) / 3600000).toFixed(1))
          : 0,
        kpis: {
          total: janela.length,
          erros,
          taxaErro: janela.length ? erros / janela.length : 0,
          fluxosAtivos: porFluxo.size,
          medianaMs: percentil(duracoes, 50),
          p95Ms: percentil(duracoes, 95),
        },
        serie: [...baldes.values()],
        porStatus, porModo, porInstancia,
        instancias: config.instancias.map(publica),
        volume: fluxos.slice().sort((a, b) => b.total - a.total).slice(0, 12),
        falhas: fluxos.filter((f) => f.erros).sort((a, b) => b.erros - a.erros).slice(0, 12),
        lentos: fluxos.filter((f) => f.p95Ms != null).sort((a, b) => b.p95Ms - a.p95Ms).slice(0, 12),
      })
    }

    if (url.pathname === '/api/cron') {
      if (semInstancia()) return json(res, 200, { ok: false, motivo: 'sem-chave' })
      try {
        if (url.searchParams.get('recarregar')) cacheCron.clear()
        return json(res, 200, await conferirAgendamentos())
      } catch (e) {
        return json(res, 200, { ok: false, motivo: 'erro-api', detalhe: String(e.message || e) })
      }
    }

    if (url.pathname === '/api/execucao') {
      const id = url.searchParams.get('id')
      if (!id) return json(res, 400, { ok: false, erro: 'falta id' })
      // Sem a instancia nao ha como saber a QUEM pedir a execucao: os ids sao
      // locais. Na duvida cai na primeira ativa, que era o comportamento antigo.
      const inst = instanciaPorId(url.searchParams.get('instancia')) || instanciasAtivas()[0]
      if (!inst) return json(res, 200, { ok: false, erro: 'nenhuma instância ativa' })
      try {
        const cli = clienteDe(inst)
        const exec = await cli.chamar(`/api/v1/executions/${encodeURIComponent(id)}?includeData=true`)
        const fluxo = await cli.nomeDeFluxo(exec.workflowId)
        return json(res, 200, {
          ok: true, fluxo, instancia: inst.nome,
          diagnostico: montarDiagnostico(exec, fluxo, exec, inst),
        })
      } catch (e) {
        return json(res, 200, { ok: false, erro: String(e.message || e) })
      }
    }

    // ---------------------------------------------------------- estaticos
    const PAGINAS = {
      '/': 'index.html',
      '/dashboard': 'dashboard.html',
      '/logs': 'logs.html',
      '/tarefas': 'tarefas.html',
    }
    const TIPOS = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.svg': 'image/svg+xml',
    }

    const alvo = PAGINAS[url.pathname] || url.pathname.replace(/^\/+/, '')
    const RAIZ = join(AQUI, 'public')
    const caminho = resolve(RAIZ, alvo)

    // impede subir de diretorio via ../ no caminho pedido
    if (caminho.startsWith(RAIZ + sep) || caminho === RAIZ) {
      try {
        const conteudo = await readFile(caminho)
        const ext = caminho.slice(caminho.lastIndexOf('.'))
        res.writeHead(200, {
          'content-type': TIPOS[ext] || 'application/octet-stream',
          'cache-control': 'no-store',
        })
        return res.end(conteudo)
      } catch { /* cai no 404 */ }
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('nao encontrado')
  } catch (e) {
    json(res, 500, { ok: false, erro: String(e.message || e) })
  }
})

await carregarConfig()
await carregarReconhecimentos()
await repoTarefas.carregar()
await webhook.carregar()
limparReconhecimentosVelhos()
const timerColeta = setInterval(() => {
  if (config.ativo && (instanciasAtivas().length || config.uptimeKuma.ativo)) {
    coletarCompleto(true).catch((e) => console.error('coleta:', e.message || e))
  }
}, 10000)
timerColeta.unref()

servidor.listen(PORTA, HOST, () => {
  console.log(`painel n8n em http://${HOST}:${PORTA}`)
  console.log(`config: ${ARQ_CONFIG}`)
  for (const i of config.instancias) {
    console.log(`  instancia "${i.nome}" (${i.id}) ${i.ativo ? 'ativa' : 'inativa'} · chave: ${i.apiKey ? 'sim' : 'nao'} · ${i.baseUrl}`)
  }
  if (config.uptimeKuma.ativo) console.log(`uptime kuma: ${config.uptimeKuma.baseUrl}`)
})

let encerrando = false
function encerrar(sinal) {
  if (encerrando) return
  encerrando = true
  clearInterval(timerColeta)
  console.log(`encerrando (${sinal})`)
  servidor.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 10000).unref()
}
process.on('SIGTERM', () => encerrar('SIGTERM'))
process.on('SIGINT', () => encerrar('SIGINT'))
