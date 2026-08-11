// Cliente do Uptime Kuma, sem dependencia.
//
// POR QUE ASSIM: o Uptime Kuma nao expoe REST para listar monitores. A propria
// interface dele conversa com o servidor por Socket.IO, e falar Socket.IO exige
// biblioteca. Sobram duas portas HTTP puras:
//
//   1. GET /metrics            -> formato Prometheus, autenticado por API key.
//      Da status, tipo, alvo, tempo de resposta e DIAS RESTANTES DO CERTIFICADO
//      de cada monitor. E a fonte principal: funciona sempre que existe token.
//
//   2. GET /api/status-page/:slug            -> monitores agrupados
//      GET /api/status-page/heartbeat/:slug  -> uptimeList com a razao de 24h
//      Publicos, sem token. Sao a UNICA forma HTTP de obter percentual de
//      uptime, porque /metrics nao carrega esse numero.
//
// Dai a config ter token (obrigatorio) e slug (opcional): sem slug o painel
// mostra status e certificado, e simplesmente NAO mostra uptime — em vez de
// estimar um numero que nao tem como conhecer.

const TEMPO_LIMITE_MS = 15000

// O /metrics do Uptime Kuma usa Basic com usuario vazio e a API key como senha.
function cabecalhoBasic(token) {
  return 'Basic ' + Buffer.from(':' + token).toString('base64')
}

async function buscar(url, cabecalhos = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TEMPO_LIMITE_MS)
  try {
    const r = await fetch(url, { headers: { accept: '*/*', ...cabecalhos }, signal: ctrl.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r
  } finally {
    clearTimeout(t)
  }
}

// ------------------------------------------------------------ prometheus
//
// Uma linha tem a forma:
//   nome{rotulo="valor",outro="valor"} 1
// Valores podem ser `Nan` (o Uptime Kuma escreve assim quando o monitor esta
// pausado ou ainda nao tem leitura), e rotulos podem conter chave escapada.
const LINHA = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+(.+)$/

function lerRotulos(bruto) {
  const saida = {}
  if (!bruto) return saida
  // divide em virgulas que estao FORA de aspas
  const partes = bruto.match(/(?:[^,"]|"(?:\\.|[^"\\])*")+/g) || []
  for (const p of partes) {
    const i = p.indexOf('=')
    if (i < 0) continue
    const chave = p.slice(0, i).trim()
    let valor = p.slice(i + 1).trim()
    if (valor.startsWith('"')) valor = valor.slice(1, -1).replace(/\\(.)/g, '$1')
    saida[chave] = valor
  }
  return saida
}

export function lerMetrics(texto) {
  const linhas = String(texto).split('\n')
  const porMonitor = new Map()

  for (const cru of linhas) {
    const linha = cru.trim()
    if (!linha || linha.startsWith('#')) continue
    const m = LINHA.exec(linha)
    if (!m) continue
    const [, metrica, , rotulosCrus, valorCru] = m
    if (!metrica.startsWith('monitor_')) continue

    const rot = lerRotulos(rotulosCrus)
    const nome = rot.monitor_name
    if (!nome) continue
    const id = rot.monitor_id || null
    const chave = id || `${rot.monitor_type || 'monitor'}:${nome}:${rot.monitor_url || rot.monitor_hostname || ''}`

    const bruto = valorCru.trim()
    const valor = /^nan$/i.test(bruto) ? null : Number(bruto)

    const reg = porMonitor.get(chave) || {
      id,
      chave,
      nome,
      tipo: rot.monitor_type || null,
      // `null` chega como a string "null" nos rotulos do Uptime Kuma
      url: rot.monitor_url && rot.monitor_url !== 'null' ? rot.monitor_url : null,
      host: rot.monitor_hostname && rot.monitor_hostname !== 'null' ? rot.monitor_hostname : null,
      porta: rot.monitor_port && rot.monitor_port !== 'null' ? rot.monitor_port : null,
      status: null,
      respostaMs: null,
      certDias: null,
      certValido: null,
      uptime24: null,
    }

    if (metrica === 'monitor_status') reg.status = valor
    else if (metrica === 'monitor_response_time') reg.respostaMs = valor
    else if (metrica === 'monitor_cert_days_remaining') reg.certDias = valor
    else if (metrica === 'monitor_cert_is_valid') reg.certValido = valor === null ? null : valor === 1
    else if (metrica === 'monitor_uptime_ratio' && (!rot.window || rot.window === '1d')) reg.uptime24 = valor

    porMonitor.set(chave, reg)
  }

  return [...porMonitor.values()].map((m) => ({ ...m, alvo: m.url || [m.host, m.porta].filter(Boolean).join(':') || null }))
}

// O Uptime Kuma numera: 0 DOWN, 1 UP, 2 PENDING, 3 MAINTENANCE. Monitor pausado
// costuma sair com valor ausente/Nan, e nao com um numero proprio — por isso
// "pausado" e "desconhecido" precisam ser deduzidos aqui, e nao lidos.
export const SITUACOES = ['ligado', 'desligado', 'manutencao', 'desconhecido', 'pausado']

export function situacaoDe(m) {
  if (m.status === 1) return 'ligado'
  if (m.status === 0) return 'desligado'
  if (m.status === 3) return 'manutencao'
  if (m.status === 2) return 'desconhecido'   // PENDING: ainda decidindo
  return 'pausado'                            // sem leitura: pausado ou recem-criado
}

// -------------------------------------------------------- status page (uptime)

async function uptimeDaStatusPage(baseUrl, slug) {
  const raiz = baseUrl.replace(/\/+$/, '')
  const [pagina, batidas] = await Promise.all([
    buscar(`${raiz}/api/status-page/${encodeURIComponent(slug)}`).then((r) => r.json()),
    buscar(`${raiz}/api/status-page/heartbeat/${encodeURIComponent(slug)}`).then((r) => r.json()),
  ])

  // id -> nome, para casar com o /metrics, que nao carrega id nenhum
  const nomePorId = new Map()
  for (const grupo of pagina?.publicGroupList || []) {
    for (const mon of grupo?.monitorList || []) {
      if (mon?.id != null && mon?.name) nomePorId.set(String(mon.id), mon.name)
    }
  }

  const porNome = new Map()
  for (const [chave, razao] of Object.entries(batidas?.uptimeList || {})) {
    const partes = String(chave).split('_')
    const id = partes[0]
    if (partes.length > 1 && partes[1] !== '24') continue
    const nome = nomePorId.get(id)
    if (nome && typeof razao === 'number') porNome.set(nome, razao)
  }
  return porNome
}

// ---------------------------------------------------------------- publico

// `selecao` e um mapa nome -> boolean. Ausente significa ATIVO: monitor novo no
// Uptime Kuma aparece no painel sem precisar de configuracao, que e o
// comportamento esperado de "ativos por default".
export async function coletarUptime(cfg) {
  if (!cfg?.baseUrl || !cfg?.token) return { ok: false, motivo: 'nao-configurado' }

  const raiz = cfg.baseUrl.replace(/\/+$/, '')
  let monitores
  try {
    const r = await buscar(`${raiz}/metrics`, { authorization: cabecalhoBasic(cfg.token) })
    monitores = lerMetrics(await r.text())
  } catch (e) {
    return { ok: false, motivo: 'inalcancavel', detalhe: String(e.message || e) }
  }

  // O uptime e opcional de proposito: falha aqui nao derruba o resto.
  if (cfg.slug) {
    try {
      const up = await uptimeDaStatusPage(raiz, cfg.slug)
      for (const m of monitores) {
        if (m.uptime24 == null && up.has(m.nome)) m.uptime24 = up.get(m.nome)
      }
    } catch { /* segue sem percentual */ }
  }

  const selecao = cfg.monitores || {}
  const marcados = monitores.map((m) => ({
    ...m,
    situacao: situacaoDe(m),
    ativo: selecao[m.id || m.chave] !== false,
  }))

  const visiveis = marcados.filter((m) => m.ativo)
  const resumo = Object.fromEntries(SITUACOES.map((s) => [s, 0]))
  for (const m of visiveis) resumo[m.situacao]++

  // Certificado vencendo entra como alerta proprio: e a falha que o monitor de
  // status nao pega, porque o site continua "ligado" ate o dia em que quebra.
  const limiteDias = Number(cfg.avisarCertDias ?? 21)
  const certificados = visiveis
    .filter((m) => m.certDias != null && m.certDias <= limiteDias)
    .map((m) => ({ nome: m.nome, dias: m.certDias, url: m.url, host: m.host }))
    .sort((a, b) => a.dias - b.dias)

  return {
    ok: true,
    baseUrl: raiz,
    temUptime: Boolean(cfg.slug),
    limiteCertDias: limiteDias,
    resumo,
    caidos: visiveis.filter((m) => m.situacao === 'desligado').map((m) => m.nome),
    certificados,
    monitores: marcados.sort((a, b) => {
      const peso = { desligado: 0, manutencao: 1, desconhecido: 2, ligado: 3, pausado: 4 }
      return (peso[a.situacao] ?? 9) - (peso[b.situacao] ?? 9) || a.nome.localeCompare(b.nome)
    }),
  }
}
