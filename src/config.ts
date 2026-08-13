import { execFile } from 'node:child_process'
import type { Config, Destino, Instancia, ModoDestino } from './tipos.js'
import { idDeInstancia } from './instancias.js'
import { chaveDeRegistroValida, registroSeguro, urlHttpValida } from './seguranca.js'
import type { DispatcherWebhook } from './webhook.js'

export const NOTIF_PADRAO = {
  toastSeg: 60,
  navegador: false,
  som: false,
  volume: 0.5,
}

export const UPTIME_PADRAO = {
  ativo: false,
  baseUrl: '',
  token: '',
  slug: '',
  monitores: {} as Record<string, boolean>,
  avisarCertDias: 21,
}

export const DESTINO_PADRAO: Destino = {
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

export const WEBHOOK_PADRAO = { destinos: [] as Destino[] }

export const PADRAO: Config = {
  instancias: [],
  ativo: true,
  idioma: 'pt-BR',
  tema: 'escuro',
  fuso: 'America/Cuiaba',
  horasCron: 24,
  toleranciaMin: 5,
  limiteTravadaMin: 30,
  limitesTravada: {},
  notificacoes: { ...NOTIF_PADRAO },
  uptimeKuma: { ...UPTIME_PADRAO },
  webhook: { ...WEBHOOK_PADRAO },
}

export const numeroLimitado = (valor: unknown, minimo: number, maximo: number, padrao: number) => {
  const numero = Number(valor)
  return Number.isFinite(numero) ? Math.max(minimo, Math.min(maximo, numero)) : padrao
}

export const chaveLimite = (instanciaId: string, workflowId: string) => `${instanciaId}|${workflowId}`

export function saneaLimitesTravada(cru: unknown) {
  const saida = registroSeguro<number>()
  for (const [chave, valor] of Object.entries(registroSeguro(cru))) {
    if (!/^[^|]+\|[^|]+$/.test(chave)) continue
    const minutos = Number(valor)
    if (!Number.isFinite(minutos) || minutos < 1) continue
    saida[chave] = Math.min(1440, Math.round(minutos))
  }
  return saida
}

export async function lerRegistroWindows() {
  if (process.platform !== 'win32') return ''
  return new Promise<string>((ok) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('N8N_API_KEY','User')"],
      { timeout: 10000 },
      (erro, saida) => ok(erro ? '' : String(saida).trim())
    )
  })
}

export function saneaInstancia(cru: Record<string, unknown> | undefined, i: number): Instancia {
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

export function saneaDestino(cru: Record<string, unknown> | undefined, i: number): Destino {
  const modo = (['webhook', 'evolution', 'discord'].includes(String(cru?.modo)) ? cru?.modo : 'webhook') as ModoDestino
  const nomePadrao = { webhook: 'Webhook HTTP', evolution: 'WhatsApp', discord: 'Discord' }[modo]
  return {
    ...DESTINO_PADRAO,
    id: chaveDeRegistroValida(String(cru?.id || '').trim()) ? String(cru?.id).trim().slice(0, 200) : `destino-${i + 1}`,
    nome: (String(cru?.nome || '').trim() || nomePadrao).slice(0, 120),
    ativo: cru?.ativo === true,
    modo,
    url: String(cru?.url || '').trim().slice(0, 4096),
    metodo: ['POST', 'PUT', 'PATCH'].includes(String(cru?.metodo)) ? String(cru?.metodo) : 'POST',
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

export function destinoConfigurado(destino: Destino) {
  return Boolean(
    destino.ativo || destino.url || destino.bearer || destino.headerNome || destino.headerValor
    || destino.evolutionUrl || destino.evolutionInstancia || destino.evolutionApiKey || destino.evolutionNumero
    || destino.discordUrl,
  )
}

export function idsUnicos<T extends { id: string }>(itens: T[]) {
  const vistos = new Set<string>()
  for (const item of itens) {
    const base = item.id
    let id = base, n = 2
    while (vistos.has(id)) id = `${base}-${n++}`
    item.id = id
    vistos.add(id)
  }
  return itens
}

export function migrar(cru: Record<string, unknown> = {}) {
  const c = { ...PADRAO, ...cru } as Config & { baseUrl?: string; apiKey?: string }
  if (!['pt-BR', 'en'].includes(c.idioma)) c.idioma = 'pt-BR'
  if (!['escuro', 'claro'].includes(c.tema)) c.tema = 'escuro'
  c.notificacoes = { ...NOTIF_PADRAO, ...((cru?.notificacoes as object) || {}) }
  c.uptimeKuma = { ...UPTIME_PADRAO, ...((cru?.uptimeKuma as object) || {}) }
  c.horasCron = numeroLimitado(c.horasCron, 1, 168, PADRAO.horasCron)
  c.toleranciaMin = numeroLimitado(c.toleranciaMin, 0, 1440, PADRAO.toleranciaMin)
  c.limiteTravadaMin = numeroLimitado(c.limiteTravadaMin, 1, 1440, PADRAO.limiteTravadaMin)
  c.limitesTravada = saneaLimitesTravada(c.limitesTravada)
  c.notificacoes.toastSeg = numeroLimitado(c.notificacoes.toastSeg, 0, 600, NOTIF_PADRAO.toastSeg)
  c.notificacoes.volume = numeroLimitado(c.notificacoes.volume, 0, 1, NOTIF_PADRAO.volume)
  c.notificacoes.navegador = c.notificacoes.navegador === true
  c.notificacoes.som = c.notificacoes.som === true
  c.uptimeKuma.avisarCertDias = numeroLimitado(c.uptimeKuma.avisarCertDias, 1, 365, UPTIME_PADRAO.avisarCertDias)
  c.uptimeKuma.monitores = registroSeguro(c.uptimeKuma.monitores)
  const webhookCru = cru?.webhook as Record<string, unknown> | undefined
  const destinosCrus = Array.isArray(webhookCru?.destinos)
    ? webhookCru.destinos as Record<string, unknown>[]
    : (webhookCru && typeof webhookCru === 'object' ? [{ ...webhookCru, id: 'destino-1' }] : [])
  c.webhook = { destinos: idsUnicos(destinosCrus.map(saneaDestino).filter(destinoConfigurado)) }

  if (!Array.isArray(c.instancias) || !c.instancias.length) {
    const url = String(cru?.baseUrl || process.env.N8N_BASE_URL || '').trim()
    const chave = String(cru?.apiKey || '').trim()
    c.instancias = (url || chave)
      ? [{ id: 'principal', nome: 'Principal', baseUrl: url || 'http://localhost:5678', apiKey: chave, ativo: true }]
      : []
  }
  c.instancias = c.instancias.map((item, i) => saneaInstancia(item as unknown as Record<string, unknown>, i))

  const vistos = new Set<string>()
  for (const inst of c.instancias) {
    let id = inst.id, n = 2
    while (vistos.has(id)) id = `${inst.id}-${n++}`
    inst.id = id
    vistos.add(id)
  }

  delete c.baseUrl
  delete c.apiKey
  return c as Config
}

export const instanciasAtivas = (config: Config) => config.instancias.filter((i) => i.ativo && i.apiKey && i.baseUrl)
export const instanciaPorId = (config: Config, id: string | null) => config.instancias.find((i) => i.id === id) || null

export const publica = (i: Instancia) => ({
  id: i.id, nome: i.nome, baseUrl: i.baseUrl, ativo: i.ativo, temChave: Boolean(i.apiKey),
})

export const publicaDestino = (d: Destino, webhook: DispatcherWebhook) => ({
  id: d.id, nome: d.nome, ativo: d.ativo, modo: d.modo,
  temUrl: Boolean(d.url), metodo: d.metodo, temBearer: Boolean(d.bearer),
  headerNome: d.headerNome, temHeaderValor: Boolean(d.headerValor),
  evolutionUrl: d.evolutionUrl, evolutionInstancia: d.evolutionInstancia,
  evolutionNumero: d.evolutionNumero, temEvolutionApiKey: Boolean(d.evolutionApiKey),
  temDiscordUrl: Boolean(d.discordUrl), discordNome: d.discordNome,
  ultimo: webhook.status(d.id),
})

export function configPublica(config: Config, webhook: DispatcherWebhook) {
  const uk = config.uptimeKuma
  return {
    instancias: config.instancias.map(publica),
    ativo: config.ativo,
    idioma: config.idioma,
    tema: config.tema,
    armazenamento: 'privado',
    limiteTravadaMin: config.limiteTravadaMin,
    limitesTravada: config.limitesTravada,
    notificacoes: config.notificacoes,
    uptimeKuma: {
      ativo: uk.ativo, baseUrl: uk.baseUrl, slug: uk.slug,
      temToken: Boolean(uk.token), monitores: uk.monitores,
      avisarCertDias: uk.avisarCertDias,
    },
    webhook: { destinos: config.webhook.destinos.map((d) => publicaDestino(d, webhook)) },
  }
}

export { urlHttpValida }
