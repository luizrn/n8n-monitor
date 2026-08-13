const TEMPO_LIMITE_MS = 15000

function cabecalhoBasic(token: string) {
  return 'Basic ' + Buffer.from(':' + token).toString('base64')
}

async function buscar(url: string, cabecalhos: Record<string, string> = {}) {
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

const LINHA = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+(.+)$/

function lerRotulos(bruto?: string) {
  const saida: Record<string, string> = {}
  if (!bruto) return saida
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

type MonitorBruto = {
  id: string | null
  chave: string
  nome: string
  tipo: string | null
  url: string | null
  host: string | null
  porta: string | null
  status: number | null
  respostaMs: number | null
  certDias: number | null
  certValido: boolean | null
  uptime24: number | null
  alvo?: string | null
}

export function lerMetrics(texto: string) {
  const linhas = String(texto).split('\n')
  const porMonitor = new Map<string, MonitorBruto>()

  for (const cru of linhas) {
    const linha = cru.trim()
    if (!linha || linha.startsWith('#')) continue
    const m = LINHA.exec(linha)
    if (!m) continue
    const [, metrica, , rotulosCrus, valorCru] = m
    if (!metrica.startsWith('monitor_')) continue

    const rot = lerRotulos(rotulosCrus)
    if (rot.monitor_type === 'group') continue
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

export const SITUACOES = ['ligado', 'desligado', 'manutencao', 'desconhecido', 'pausado'] as const

export function situacaoDe(m: { status?: number | null }) {
  if (m.status === 1) return 'ligado'
  if (m.status === 0) return 'desligado'
  if (m.status === 3) return 'manutencao'
  if (m.status === 2) return 'desconhecido'
  return 'pausado'
}

async function uptimeDaStatusPage(baseUrl: string, slug: string) {
  const raiz = baseUrl.replace(/\/+$/, '')
  const [pagina, batidas] = await Promise.all([
    buscar(`${raiz}/api/status-page/${encodeURIComponent(slug)}`).then((r) => r.json() as Promise<{ publicGroupList?: { monitorList?: { id?: unknown; name?: string }[] }[] }>),
    buscar(`${raiz}/api/status-page/heartbeat/${encodeURIComponent(slug)}`).then((r) => r.json() as Promise<{ uptimeList?: Record<string, number> }>),
  ])

  const nomePorId = new Map<string, string>()
  for (const grupo of pagina?.publicGroupList || []) {
    for (const mon of grupo?.monitorList || []) {
      if (mon?.id != null && mon?.name) nomePorId.set(String(mon.id), mon.name)
    }
  }

  const porNome = new Map<string, number>()
  for (const [chave, razao] of Object.entries(batidas?.uptimeList || {})) {
    const partes = String(chave).split('_')
    const id = partes[0]
    if (partes.length > 1 && partes[1] !== '24') continue
    const nome = nomePorId.get(id)
    if (nome && typeof razao === 'number') porNome.set(nome, razao)
  }
  return porNome
}

export async function coletarUptime(cfg: {
  baseUrl?: string
  token?: string
  slug?: string
  monitores?: Record<string, boolean>
  avisarCertDias?: number
}) {
  if (!cfg?.baseUrl || !cfg?.token) return { ok: false as const, motivo: 'nao-configurado' }

  const raiz = cfg.baseUrl.replace(/\/+$/, '')
  let monitores: ReturnType<typeof lerMetrics>
  try {
    const r = await buscar(`${raiz}/metrics`, { authorization: cabecalhoBasic(cfg.token) })
    monitores = lerMetrics(await r.text())
  } catch (e) {
    return { ok: false as const, motivo: 'inalcancavel', detalhe: String((e as Error).message || e) }
  }

  if (cfg.slug) {
    try {
      const up = await uptimeDaStatusPage(raiz, cfg.slug)
      for (const m of monitores) {
        if (m.uptime24 == null && up.has(m.nome)) m.uptime24 = up.get(m.nome) ?? null
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
  const resumo = Object.fromEntries(SITUACOES.map((s) => [s, 0])) as Record<string, number>
  for (const m of visiveis) resumo[m.situacao]++

  const limiteDias = Number(cfg.avisarCertDias ?? 21)
  const certificados = visiveis
    .filter((m) => m.certDias != null && m.certDias <= limiteDias)
    .map((m) => ({ nome: m.nome, dias: m.certDias, url: m.url, host: m.host }))
    .sort((a, b) => (a.dias ?? 0) - (b.dias ?? 0))

  return {
    ok: true as const,
    baseUrl: raiz,
    temUptime: Boolean(cfg.slug),
    limiteCertDias: limiteDias,
    resumo,
    caidos: visiveis.filter((m) => m.situacao === 'desligado').map((m) => m.nome),
    certificados,
    dominios: [] as { dominio: string; dias: number; expiraEm?: string }[],
    monitores: marcados.sort((a, b) => {
      const peso: Record<string, number> = { desligado: 0, manutencao: 1, desconhecido: 2, ligado: 3, pausado: 4 }
      return (peso[a.situacao] ?? 9) - (peso[b.situacao] ?? 9) || a.nome.localeCompare(b.nome)
    }),
  }
}
