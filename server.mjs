// Painel de monitoramento do n8n.
//
// As chaves de API ficam SEMPRE do lado do servidor: sao lidas de um arquivo de
// config em %LOCALAPPDATA% (fora do repositorio, para nao ser commitado por
// acidente) e nunca sao enviadas ao navegador. O endpoint /api/config responde
// apenas SE existe chave configurada, jamais o valor.
//
// Escuta so em 127.0.0.1.

import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, rename, rm, chmod } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { join, dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gatilhosDe, regraParaCron, descreverRegra, esperadas, comparar } from './cron.mjs'
import { clienteDe, criarCliente, descartarClientes, idDeInstancia } from './instancias.mjs'
import { coletarUptime } from './uptime.mjs'
import { criarRepo, ESTADOS as ESTADOS_TAREFA, normalizarEstado } from './tarefas.mjs'
import { montarAlertas, podeConfirmarRecuperacao } from './alertas.mjs'
import { criarResolvedorRdap } from './rdap.mjs'
import { criarDispatcherWebhook, payloadDe } from './webhook.mjs'
import { chaveDeRegistroValida, redigir, redigirTexto, registroSeguro, urlHttpValida } from './seguranca.mjs'

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

const DESTINO_PADRAO = {
  id: '',
  nome: '',
  ativo: false,
  modo: 'webhook',
  url: '',
  metodo: 'POST',
  bearer: '',
  headerNome: '',
  headerValor: '',
  evolutionUrl: '',
  evolutionInstancia: '',
  evolutionApiKey: '',
  evolutionNumero: '',
  discordUrl: '',
  discordNome: 'n8n-monitor',
}

const WEBHOOK_PADRAO = { destinos: [] }

const PADRAO = {
  instancias: [],
  ativo: true,
  idioma: 'pt-BR',
  fuso: 'America/Cuiaba',   // usado quando o workflow nao define timezone proprio
  horasCron: 24,            // janela da conferencia configurado-vs-executou
  toleranciaMin: 5,         // atraso aceito antes de considerar ocorrencia perdida
  notificacoes: { ...NOTIF_PADRAO },
  uptimeKuma: { ...UPTIME_PADRAO },
  webhook: { ...WEBHOOK_PADRAO },
}

let config = { ...PADRAO }

const numeroLimitado = (valor, minimo, maximo, padrao) => {
  const numero = Number(valor)
  return Number.isFinite(numero) ? Math.max(minimo, Math.min(maximo, numero)) : padrao
}

let sequenciaGravacao = 0
async function gravarPrivado(caminho, conteudo) {
  await mkdir(dirname(caminho), { recursive: true })
  const temporario = `${caminho}.${process.pid}.${Date.now()}.${++sequenciaGravacao}.tmp`
  try {
    await writeFile(temporario, conteudo, { mode: 0o600 })
    await rename(temporario, caminho)
    await chmod(caminho, 0o600).catch(() => {})
  } finally {
    await rm(temporario, { force: true }).catch(() => {})
  }
}

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
  const nome = (String(cru?.nome || '').trim() || `n8n ${i + 1}`).slice(0, 120)
  const idInformado = String(cru?.id || '').trim().slice(0, 200)
  return {
    id: chaveDeRegistroValida(idInformado) ? idInformado : idDeInstancia(nome),
    nome,
    baseUrl: String(cru?.baseUrl || '').trim().replace(/\/+$/, '').slice(0, 2048),
    apiKey: String(cru?.apiKey || ''),
    ativo: cru?.ativo !== false,
  }
}

function saneaDestino(cru, i) {
  const modo = ['webhook', 'evolution', 'discord'].includes(cru?.modo) ? cru.modo : 'webhook'
  const nomePadrao = { webhook: 'Webhook HTTP', evolution: 'WhatsApp', discord: 'Discord' }[modo]
  return {
    ...DESTINO_PADRAO,
    id: chaveDeRegistroValida(String(cru?.id || '').trim()) ? String(cru.id).trim().slice(0, 200) : `destino-${i + 1}`,
    nome: (String(cru?.nome || '').trim() || nomePadrao).slice(0, 120),
    ativo: cru?.ativo === true,
    modo,
    url: String(cru?.url || '').trim().slice(0, 4096),
    metodo: ['POST', 'PUT', 'PATCH'].includes(cru?.metodo) ? cru.metodo : 'POST',
    bearer: String(cru?.bearer || '').trim(),
    headerNome: String(cru?.headerNome || '').trim().slice(0, 128),
    headerValor: String(cru?.headerValor || '').trim().slice(0, 8192),
    evolutionUrl: String(cru?.evolutionUrl || '').trim().replace(/\/+$/, '').slice(0, 2048),
    evolutionInstancia: String(cru?.evolutionInstancia || '').trim(),
    evolutionApiKey: String(cru?.evolutionApiKey || '').trim(),
    evolutionNumero: String(cru?.evolutionNumero || '').replace(/\D/g, ''),
    discordUrl: String(cru?.discordUrl || '').trim().slice(0, 4096),
    discordNome: String(cru?.discordNome || 'n8n-monitor').trim().slice(0, 80),
  }
}

function destinoConfigurado(destino) {
  return Boolean(
    destino.ativo || destino.url || destino.bearer || destino.headerNome || destino.headerValor
    || destino.evolutionUrl || destino.evolutionInstancia || destino.evolutionApiKey || destino.evolutionNumero
    || destino.discordUrl,
  )
}

function idsUnicos(itens) {
  const vistos = new Set()
  for (const item of itens) {
    const base = item.id
    let id = base, n = 2
    while (vistos.has(id)) id = `${base}-${n++}`
    item.id = id
    vistos.add(id)
  }
  return itens
}

// MIGRACAO. A primeira versao guardava uma instancia unica em `baseUrl`/`apiKey`
// na raiz da config. Ler isso e converter em lista e o que evita que quem ja
// usava o painel perca a configuracao ao atualizar.
function migrar(cru) {
  const c = { ...PADRAO, ...cru }
  if (!['pt-BR', 'en'].includes(c.idioma)) c.idioma = 'pt-BR'
  c.notificacoes = { ...NOTIF_PADRAO, ...(cru?.notificacoes || {}) }
  c.uptimeKuma = { ...UPTIME_PADRAO, ...(cru?.uptimeKuma || {}) }
  c.horasCron = numeroLimitado(c.horasCron, 1, 168, PADRAO.horasCron)
  c.toleranciaMin = numeroLimitado(c.toleranciaMin, 0, 1440, PADRAO.toleranciaMin)
  c.notificacoes.toastSeg = numeroLimitado(c.notificacoes.toastSeg, 0, 600, NOTIF_PADRAO.toastSeg)
  c.notificacoes.volume = numeroLimitado(c.notificacoes.volume, 0, 1, NOTIF_PADRAO.volume)
  c.notificacoes.navegador = c.notificacoes.navegador === true
  c.notificacoes.som = c.notificacoes.som === true
  c.uptimeKuma.avisarCertDias = numeroLimitado(c.uptimeKuma.avisarCertDias, 1, 365, UPTIME_PADRAO.avisarCertDias)
  c.uptimeKuma.monitores = registroSeguro(c.uptimeKuma.monitores)
  const webhookCru = cru?.webhook
  const destinosCrus = Array.isArray(webhookCru?.destinos)
    ? webhookCru.destinos
    : (webhookCru && typeof webhookCru === 'object' ? [{ ...webhookCru, id: 'destino-1' }] : [])
  c.webhook = { destinos: idsUnicos(destinosCrus.map(saneaDestino).filter(destinoConfigurado)) }

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
  try {
    cru = JSON.parse(await readFile(ARQ_CONFIG, 'utf8'))
  } catch (erro) {
    if (erro?.code !== 'ENOENT') throw new Error(`configuração inválida em ${ARQ_CONFIG}: ${erro.message}`)
  }
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
  await gravarPrivado(ARQ_CONFIG, JSON.stringify(config, null, 2))
}

const instanciasAtivas = () => config.instancias.filter((i) => i.ativo && i.apiKey && i.baseUrl)
const instanciaPorId = (id) => config.instancias.find((i) => i.id === id) || null

// Instancia publicavel: tudo menos o segredo.
const publica = (i) => ({
  id: i.id, nome: i.nome, baseUrl: i.baseUrl, ativo: i.ativo, temChave: Boolean(i.apiKey),
})

const publicaDestino = (d) => ({
  id: d.id, nome: d.nome, ativo: d.ativo, modo: d.modo,
  temUrl: Boolean(d.url), metodo: d.metodo, temBearer: Boolean(d.bearer),
  headerNome: d.headerNome, temHeaderValor: Boolean(d.headerValor),
  evolutionUrl: d.evolutionUrl, evolutionInstancia: d.evolutionInstancia,
  evolutionNumero: d.evolutionNumero, temEvolutionApiKey: Boolean(d.evolutionApiKey),
  temDiscordUrl: Boolean(d.discordUrl), discordNome: d.discordNome,
  ultimo: webhook.status(d.id),
})

// ------------------------------------------- reconhecimento de alertas
//
// Guardado em disco, nao no navegador: marcar algo como tratado e informacao de
// equipe, e some se ficar preso a um localStorage.
//
// A magnitude no momento do reconhecimento e parte do registro. Assim, se o erro
// voltar a crescer, ele reaparece sozinho — reconhecer silencia o que ja se viu,
// nao o que ainda vai acontecer.
let reconhecimentos = registroSeguro()

async function carregarReconhecimentos() {
  try { reconhecimentos = registroSeguro(JSON.parse(await readFile(ARQ_RECON, 'utf8'))) } catch { reconhecimentos = registroSeguro() }
}
async function salvarReconhecimentos() {
  await gravarPrivado(ARQ_RECON, JSON.stringify(reconhecimentos, null, 2))
}

const repoTarefas = criarRepo({
  ler: () => readFile(ARQ_TAREFAS, 'utf8'),
  gravar: (t) => gravarPrivado(ARQ_TAREFAS, t),
})

const rdap = criarResolvedorRdap()
const webhook = criarDispatcherWebhook({
  ler: () => readFile(ARQ_WEBHOOK, 'utf8'),
  gravar: (texto) => gravarPrivado(ARQ_WEBHOOK, texto),
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
    const podeResolver = (item) => podeConfirmarRecuperacao(item, estado, uptime)

    let limpou = false
    for (const chave of Object.keys(reconhecimentos)) {
      const reconhecimento = { chave, ...reconhecimentos[chave] }
      const tarefa = repoTarefas.pegar(chave)
      if (!chaves.has(chave) && podeResolver({ ...tarefa, ...reconhecimento })) {
        delete reconhecimentos[chave]
        limpou = true
      }
    }
    if (limpou) await salvarReconhecimentos()
    await repoTarefas.resolverAusentes(chaves, podeResolver)

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
    webhook.processar(alertasAtivos, podeResolver).catch((e) => console.error('webhook:', e.message || e))
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
    if (e.message) L.push(`\`\`\`\n${redigirTexto(e.message)}\n\`\`\``)
    if (e.description) L.push(`descricao: ${redigirTexto(e.description)}`)
    if (e.httpCode) L.push(`httpCode: ${e.httpCode}`)
    if (e.name) L.push(`tipo: ${e.name}`)
    if (Array.isArray(e.messages) && e.messages.length) L.push(`dicas: ${redigirTexto(e.messages.join(' | '))}`)
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
    L.push(redigirTexto(e.stack).split('\n').slice(0, 12).join('\n'))
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

class ErroHttp extends Error {
  constructor(status, message) { super(message); this.status = status }
}

async function lerCorpo(req) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    throw new ErroHttp(415, 'Content-Type deve ser application/json')
  }
  const origem = req.headers.origin
  if (origem) {
    let hostOrigem = ''
    try { hostOrigem = new URL(origem).host } catch { /* origem inválida */ }
    if (!hostOrigem || hostOrigem !== req.headers.host) throw new ErroHttp(403, 'origem não permitida')
  }
  const partes = []
  let total = 0
  for await (const c of req) {
    partes.push(c)
    total += c.length
    if (total > 1e6) throw new ErroHttp(413, 'corpo excede 1 MB')
  }
  try { return JSON.parse(Buffer.concat(partes).toString('utf8') || '{}') }
  catch { throw new ErroHttp(400, 'JSON inválido') }
}

const semInstancia = () => !instanciasAtivas().length

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('x-frame-options', 'DENY')
  res.setHeader('referrer-policy', 'no-referrer')
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")

  try {
    if (url.pathname === '/api/health' && req.method === 'GET') {
      return json(res, 200, { ok: true, uptimeSeg: Math.round(process.uptime()), coletaEm: cacheCompleto.dados?.momento || null })
    }
    if (url.pathname === '/favicon.ico' && req.method === 'GET') {
      res.writeHead(204, { 'cache-control': 'public, max-age=86400' })
      return res.end()
    }

    // ---------------------------------------------------------- config
    if (url.pathname === '/api/config' && req.method === 'GET') {
      const uk = config.uptimeKuma
      return json(res, 200, {
        instancias: config.instancias.map(publica),
        ativo: config.ativo,
        idioma: config.idioma,
        armazenamento: 'privado',
        notificacoes: config.notificacoes,
        uptimeKuma: {
          ativo: uk.ativo, baseUrl: uk.baseUrl, slug: uk.slug,
          temToken: Boolean(uk.token), monitores: uk.monitores,
          avisarCertDias: uk.avisarCertDias,
        },
        webhook: { destinos: config.webhook.destinos.map(publicaDestino) },
      })
    }

    if (url.pathname === '/api/config' && req.method === 'POST') {
      const corpo = await lerCorpo(req)

      if (Array.isArray(corpo.instancias)) {
        const antigas = new Map(config.instancias.map((i) => [i.id, i]))
        const novas = corpo.instancias.slice(0, 100).map((cru, i) => {
          const s = saneaInstancia(cru, i)
          // Chave vazia = manter a atual. Nunca devolvemos o valor ao navegador,
          // logo ele nao teria como reenviar o que ja esta salvo.
          if (!s.apiKey) s.apiKey = antigas.get(s.id)?.apiKey || ''
          if (s.baseUrl && !urlHttpValida(s.baseUrl)) throw new ErroHttp(400, `URL inválida na instância ${s.nome}`)
          return s
        })
        const vistos = new Set()
        for (const inst of novas) {
          let id = inst.id, n = 2
          while (vistos.has(id)) id = `${inst.id}-${n++}`
          inst.id = id
          vistos.add(id)
        }
        config.instancias = novas
      }

      if (typeof corpo.ativo === 'boolean') config.ativo = corpo.ativo
      if (['pt-BR', 'en'].includes(corpo.idioma)) config.idioma = corpo.idioma

      if (corpo.notificacoes && typeof corpo.notificacoes === 'object') {
        const n = corpo.notificacoes
        config.notificacoes = {
          toastSeg: numeroLimitado(n.toastSeg, 0, 600, config.notificacoes.toastSeg),
          navegador: Boolean(n.navegador),
          som: Boolean(n.som),
          volume: numeroLimitado(n.volume, 0, 1, config.notificacoes.volume),
        }
      }

      if (corpo.uptimeKuma && typeof corpo.uptimeKuma === 'object') {
        const u = corpo.uptimeKuma
        const atual = config.uptimeKuma
        const novaUptime = {
          ativo: typeof u.ativo === 'boolean' ? u.ativo : atual.ativo,
          baseUrl: typeof u.baseUrl === 'string' ? u.baseUrl.trim().replace(/\/+$/, '') : atual.baseUrl,
          // token vazio = manter o atual, mesma regra das chaves do n8n
          token: typeof u.token === 'string' && u.token.trim() ? u.token.trim() : atual.token,
          slug: typeof u.slug === 'string' ? u.slug.trim() : atual.slug,
          monitores: u.monitores && typeof u.monitores === 'object' ? registroSeguro(u.monitores) : atual.monitores,
          avisarCertDias: numeroLimitado(u.avisarCertDias, 1, 365, atual.avisarCertDias),
        }
        if (novaUptime.baseUrl && !urlHttpValida(novaUptime.baseUrl)) throw new ErroHttp(400, 'URL inválida do Uptime Kuma')
        config.uptimeKuma = novaUptime
        cacheUptime = { em: 0, dados: null }
      }

      if (corpo.webhook && typeof corpo.webhook === 'object') {
        const w = corpo.webhook
        if (Array.isArray(w.destinos)) {
          const antigos = new Map(config.webhook.destinos.map((d) => [d.id, d]))
          const destinos = idsUnicos(w.destinos.slice(0, 50).map((cru, i) => {
            const anterior = antigos.get(String(cru?.id || '').trim()) || {}
            return saneaDestino({
              ...anterior, ...cru,
              url: String(cru?.url || '').trim() || anterior.url,
              bearer: String(cru?.bearer || '').trim() || anterior.bearer,
              headerValor: String(cru?.headerValor || '').trim() || anterior.headerValor,
              evolutionApiKey: String(cru?.evolutionApiKey || '').trim() || anterior.evolutionApiKey,
              discordUrl: String(cru?.discordUrl || '').trim() || anterior.discordUrl,
            }, i)
          }).filter(destinoConfigurado))
          for (const destino of destinos) {
            const urls = [destino.url, destino.evolutionUrl, destino.discordUrl].filter(Boolean)
            if (urls.some((valor) => !urlHttpValida(valor))) throw new ErroHttp(400, `URL inválida no destino ${destino.nome}`)
          }
          config.webhook = { destinos }
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
    if (url.pathname === '/api/uptime' && req.method === 'GET') {
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
      const anterior = config.webhook.destinos.find((d) => d.id === c.id) || {}
      const cfg = saneaDestino({
        ...anterior, ...c,
        url: String(c.url || '').trim() || anterior.url,
        bearer: String(c.bearer || '').trim() || anterior.bearer,
        headerValor: String(c.headerValor || '').trim() || anterior.headerValor,
        evolutionApiKey: String(c.evolutionApiKey || '').trim() || anterior.evolutionApiKey,
        discordUrl: String(c.discordUrl || '').trim() || anterior.discordUrl,
      }, 0)
      return json(res, 200, await webhook.testar(cfg))
    }

    // ---------------------------------------------------------- estado
    if (url.pathname === '/api/state' && req.method === 'GET') {
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
      if (!chaveDeRegistroValida(c.chave)) return json(res, 400, { ok: false, erro: 'chave inválida' })

      if (!c.estado) {
        delete reconhecimentos[c.chave]
        await repoTarefas.remover(c.chave)
      } else if (c.estado === 'analise') {
        // "Em analise" MOVE para Tarefas: o alerta sai do Monitor e passa a ter
        // estado proprio. O reconhecimento continua sendo gravado porque e ele
        // que guarda a magnitude — se o erro crescer alem do que foi visto, o
        // alerta reaparece mesmo havendo tarefa aberta.
        reconhecimentos[c.chave] = {
          estado: 'analise', magnitude: numeroLimitado(c.magnitude, 1, 1e9, 1),
          instanciaId: c.alerta?.instanciaId || null, origem: c.alerta?.origem || null,
          em: new Date().toISOString(),
        }
        await repoTarefas.abrir({ ...(c.alerta || {}), chave: c.chave, magnitude: c.magnitude })
      } else {
        reconhecimentos[c.chave] = {
          estado: 'resolvido', magnitude: numeroLimitado(c.magnitude, 1, 1e9, 1),
          instanciaId: c.alerta?.instanciaId || null, origem: c.alerta?.origem || null,
          em: new Date().toISOString(),
        }
        webhook.resolver(c.alerta || { chave: c.chave }, 'manual').catch(() => {})
      }

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
      if (!chaveDeRegistroValida(c.chave)) return json(res, 400, { ok: false, erro: 'chave inválida' })

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
          instanciaId: t.instanciaId || null, origem: t.origem || null,
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
    if (url.pathname === '/api/logs' && req.method === 'GET') {
      if (semInstancia()) return json(res, 200, { ok: false, motivo: 'sem-chave' })
      const { itens, truncado, falhas } = await recentesDeTodas()

      const q = (url.searchParams.get('q') || '').trim().toLowerCase()
      const status = (url.searchParams.get('status') || '').split(',').filter(Boolean)
      const modo = (url.searchParams.get('modo') || '').split(',').filter(Boolean)
      const insts = (url.searchParams.get('instancias') || '').split(',').filter(Boolean)
      const horas = numeroLimitado(url.searchParams.get('horas'), 0, 168, 0)
      const pagina = Math.floor(numeroLimitado(url.searchParams.get('pagina'), 0, 1e6, 0))
      const porPagina = Math.floor(numeroLimitado(url.searchParams.get('limite'), 10, 500, 100))
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
    if (url.pathname === '/api/dashboard' && req.method === 'GET') {
      if (semInstancia()) return json(res, 200, { ok: false, motivo: 'sem-chave' })
      const horas = numeroLimitado(url.searchParams.get('horas'), 1, 168, 24)
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

    if (url.pathname === '/api/cron' && req.method === 'GET') {
      if (semInstancia()) return json(res, 200, { ok: false, motivo: 'sem-chave' })
      try {
        if (url.searchParams.get('recarregar')) cacheCron.clear()
        return json(res, 200, await conferirAgendamentos())
      } catch (e) {
        return json(res, 200, { ok: false, motivo: 'erro-api', detalhe: String(e.message || e) })
      }
    }

    if (url.pathname === '/api/execucao' && req.method === 'GET') {
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
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' })
      return res.end('método não permitido')
    }
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
    if (!e?.status || e.status >= 500) console.error('http:', e)
    json(res, e?.status || 500, { ok: false, erro: e?.status ? e.message : 'erro interno' })
  }
})

servidor.requestTimeout = 30000
servidor.headersTimeout = 15000
servidor.keepAliveTimeout = 5000
servidor.maxRequestsPerSocket = 1000

await carregarConfig()
await carregarReconhecimentos()
await repoTarefas.carregar()
await webhook.carregar()
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
