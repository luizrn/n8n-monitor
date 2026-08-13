import { randomUUID } from 'node:crypto'
import { assinaturaAlerta } from './alertas.js'
import { chaveDeRegistroValida, registroSeguro, urlHttpValida } from './seguranca.js'
import { VERSAO } from './versao.js'

const UA = `n8n-monitor/${VERSAO}`

const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const METODOS = new Set(['POST', 'PUT', 'PATCH'])
const HEADERS_RESERVADOS = new Set([
  'authorization', 'connection', 'content-length', 'content-type', 'cookie', 'host',
  'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'user-agent',
])

type Payload = {
  version: number
  eventId: string
  event: string
  occurredAt: string
  source: string
  alert: Record<string, unknown>
  resolution: unknown
}

function textoEvento(payload: Payload) {
  const a = payload.alert as {
    severity?: string; title?: string; summary?: string; detail?: string
    instance?: { name?: string }; magnitude?: number; url?: string
  }
  const evento = { opened: 'ABERTO', worsened: 'AGRAVADO', resolved: 'RESOLVIDO', test: 'TESTE' }[payload.event] || payload.event.toUpperCase()
  return [
    `*${evento}* | ${a.severity === 'red' ? 'VERMELHO' : 'AMARELO'}`,
    a.title,
    a.summary || a.detail,
    a.instance?.name ? `Instância: ${a.instance.name}` : null,
    (a.magnitude || 0) > 1 ? `Ocorrências: ${a.magnitude}` : null,
    a.url || null,
  ].filter(Boolean).join('\n').slice(0, 4000)
}

export function prepararEnvio(payload: Payload, cfg: Record<string, unknown> = {}) {
  const modo = cfg.modo || 'webhook'
  if (modo === 'discord') {
    if (!cfg.discordUrl || !urlHttpValida(cfg.discordUrl)) throw new Error('URL do webhook Discord inválida')
    const url = new URL(String(cfg.discordUrl))
    url.searchParams.set('wait', 'true')
    return {
      url: url.toString(), method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: { content: textoEvento(payload).slice(0, 2000), username: cfg.discordNome || 'n8n-monitor', allowed_mentions: { parse: [] } },
    }
  }
  if (modo === 'evolution') {
    if (!urlHttpValida(cfg.evolutionUrl) || !cfg.evolutionInstancia || !cfg.evolutionApiKey || !cfg.evolutionNumero) {
      throw new Error('URL, instância, API key e número da Evolution API são obrigatórios')
    }
    return {
      url: `${String(cfg.evolutionUrl).replace(/\/+$/, '')}/message/sendText/${encodeURIComponent(String(cfg.evolutionInstancia))}`,
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA, apikey: String(cfg.evolutionApiKey) },
      body: { number: String(cfg.evolutionNumero).replace(/\D/g, ''), textMessage: { text: textoEvento(payload) } },
    }
  }
  if (!urlHttpValida(cfg.url)) throw new Error('URL do webhook inválida')
  const headers = Object.assign(Object.create(null), { 'content-type': 'application/json', 'user-agent': UA }) as Record<string, string>
  if (cfg.bearer) headers.authorization = `Bearer ${cfg.bearer}`
  if (cfg.headerNome) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(String(cfg.headerNome))) throw new Error('Nome do header opcional inválido')
    if (HEADERS_RESERVADOS.has(String(cfg.headerNome).toLowerCase())) throw new Error('Header opcional reservado')
    if (/[\r\n]/.test(String(cfg.headerValor || ''))) throw new Error('Valor do header opcional inválido')
    headers[String(cfg.headerNome)] = String(cfg.headerValor || '')
  }
  return { url: String(cfg.url), method: METODOS.has(String(cfg.metodo)) ? String(cfg.metodo) : 'POST', headers, body: payload }
}

export function payloadDe(evento: string, alerta: Record<string, unknown>, resolucao: unknown = null): Payload {
  return {
    version: 1,
    eventId: randomUUID(),
    event: evento,
    occurredAt: new Date().toISOString(),
    source: 'n8n-monitor',
    alert: {
      key: alerta.chave, severity: alerta.nivel === 'ruim' ? 'red' : 'yellow',
      category: alerta.origem, type: alerta.tipo, title: alerta.titulo,
      summary: alerta.resumo, detail: alerta.detalhe || null,
      message: alerta.mensagem || null, magnitude: Number(alerta.magnitude || 1),
      instance: alerta.instanciaId ? { id: alerta.instanciaId, name: alerta.instancia } : null,
      url: alerta.link || null,
    },
    resolution: resolucao,
  }
}

type DestinoEstado = {
  ativos: Record<string, { assinatura?: string; alerta?: Record<string, unknown>; em?: string; acknowledged?: boolean }>
  ultimo: { ok: boolean; detalhe: string; em: string } | null
}

type FetchFn = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number }>

export function criarDispatcherWebhook({
  ler, gravar, obterConfig, fetchFn = fetch,
}: {
  ler: () => Promise<string>
  gravar: (texto: string) => Promise<void>
  obterConfig: () => { destinos?: Record<string, unknown>[] }
  fetchFn?: FetchFn
}) {
  let estado = { destinos: registroSeguro<DestinoEstado>() }
  let ocupado = false
  let filaGravacao = Promise.resolve()

  async function carregar() {
    try {
      const salvo = JSON.parse(await ler()) as { destinos?: Record<string, DestinoEstado>; ativos?: DestinoEstado['ativos']; ultimo?: DestinoEstado['ultimo'] }
      if (salvo?.destinos && typeof salvo.destinos === 'object') {
        estado = { destinos: registroSeguro<DestinoEstado>(salvo.destinos) }
        for (const destino of Object.values(estado.destinos)) destino.ativos = registroSeguro(destino?.ativos)
      } else {
        const primeiro = obterConfig()?.destinos?.[0]?.id as string | undefined
        if (primeiro) estado.destinos[primeiro] = { ativos: salvo?.ativos || {}, ultimo: salvo?.ultimo || null }
      }
    } catch { /* primeiro uso */ }
  }

  const estadoDo = (id: string) => {
    if (!chaveDeRegistroValida(id)) throw new Error('ID de destino inválido')
    return (estado.destinos[id] ||= { ativos: registroSeguro(), ultimo: null })
  }
  const persistir = () => {
    const texto = JSON.stringify(estado, null, 2)
    filaGravacao = filaGravacao.then(() => gravar(texto))
    return filaGravacao
  }

  async function enviar(payload: Payload, cfg: Record<string, unknown> = obterConfig()) {
    let ultimoErro: unknown
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 10000)
      try {
        const envio = prepararEnvio(payload, cfg)
        const r = await fetchFn(envio.url, { method: envio.method, headers: envio.headers as Record<string, string>, body: JSON.stringify(envio.body), signal: ctrl.signal })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return { ok: true, status: r.status }
      } catch (e) {
        ultimoErro = e
        if (tentativa < 2) await esperar([250, 1000][tentativa])
      } finally { clearTimeout(timer) }
    }
    throw ultimoErro
  }

  async function registrarUltimo(destinoId: string, ok: boolean, detalhe: unknown) {
    estadoDo(destinoId).ultimo = { ok, detalhe: String(detalhe || ''), em: new Date().toISOString() }
    await persistir()
  }

  async function testar(cfg: Record<string, unknown>) {
    const destinoId = String(cfg.id || 'teste')
    const alerta = { chave: 'teste', nivel: 'atencao', origem: 'teste', tipo: 'teste', titulo: 'Teste do n8n-monitor', resumo: 'Webhook configurado corretamente', magnitude: 1 }
    try {
      const r = await enviar(payloadDe('test', alerta), cfg)
      await registrarUltimo(destinoId, true, `HTTP ${r.status}`)
      return { ok: true }
    } catch (e) {
      await registrarUltimo(destinoId, false, (e as Error).message || e)
      return { ok: false, erro: String((e as Error).message || e) }
    }
  }

  async function processarDestino(alertas: Record<string, unknown>[], cfg: Record<string, unknown>, podeResolver: (item: Record<string, unknown>) => boolean = () => true) {
    const destino = estadoDo(String(cfg.id))
    const atuais = new Map(alertas.map((a) => [String(a.chave), a]))
    for (const alerta of alertas) {
      const anterior = destino.ativos[String(alerta.chave)]
      const assinatura = assinaturaAlerta(alerta)
      if (anterior?.assinatura === assinatura) continue
      const piorou = !anterior
        || (anterior.alerta?.nivel !== 'ruim' && alerta.nivel === 'ruim')
        || Number(alerta.magnitude || 1) > Number(anterior.alerta?.magnitude || 1)
      if (anterior && !piorou) {
        destino.ativos[String(alerta.chave)] = { ...anterior, assinatura, alerta }
        await persistir()
        continue
      }
      const evento = anterior ? 'worsened' : 'opened'
      try {
        await enviar(payloadDe(evento, alerta), cfg)
        destino.ativos[String(alerta.chave)] = { assinatura, alerta, em: new Date().toISOString() }
        await registrarUltimo(String(cfg.id), true, `${evento}: ${alerta.chave}`)
      } catch (e) { await registrarUltimo(String(cfg.id), false, (e as Error).message || e) }
    }
    for (const [chave, anterior] of Object.entries({ ...destino.ativos })) {
      if (atuais.has(chave)) continue
      if (!podeResolver(anterior.alerta || { chave })) continue
      if (anterior.acknowledged) {
        delete destino.ativos[chave]
        await persistir()
        continue
      }
      try {
        await enviar(payloadDe('resolved', anterior.alerta || { chave }, { mode: 'automatic' }), cfg)
        delete destino.ativos[chave]
        await registrarUltimo(String(cfg.id), true, `resolved: ${chave}`)
      } catch (e) { await registrarUltimo(String(cfg.id), false, (e as Error).message || e) }
    }
  }

  async function processar(alertas: Record<string, unknown>[], podeResolver: (item: Record<string, unknown>) => boolean = () => true) {
    const configurados = obterConfig()?.destinos || []
    const porId = new Map(configurados.map((d) => [d.id as string, d]))
    let mudou = false
    for (const [id, salvo] of Object.entries(estado.destinos)) {
      const cfg = porId.get(id)
      if (!cfg) { delete estado.destinos[id]; mudou = true }
      else if (!cfg.ativo && Object.keys(salvo.ativos || {}).length) {
        salvo.ativos = {}
        mudou = true
      }
    }
    if (mudou) await persistir()
    const destinos = configurados.filter((d) => d.ativo)
    if (!destinos.length || ocupado) return
    ocupado = true
    try {
      await Promise.all(destinos.map((cfg) => processarDestino(alertas, cfg, podeResolver)))
    } finally { ocupado = false }
  }

  async function resolver(alerta: Record<string, unknown>, mode = 'manual') {
    const destinos = (obterConfig()?.destinos || []).filter((d) => d.ativo && estadoDo(String(d.id)).ativos[String(alerta?.chave)])
    if (!destinos.length) return { ok: true, enviado: false }
    const resultados = await Promise.all(destinos.map(async (cfg) => {
      const anterior = estadoDo(String(cfg.id)).ativos[String(alerta.chave)]
      try {
        await enviar(payloadDe('resolved', anterior.alerta || alerta, { mode }), cfg)
        estadoDo(String(cfg.id)).ativos[String(alerta.chave)] = { ...anterior, acknowledged: true }
        await registrarUltimo(String(cfg.id), true, `resolved:${mode}: ${alerta.chave}`)
        return null
      } catch (e) {
        await registrarUltimo(String(cfg.id), false, (e as Error).message || e)
        return String((e as Error).message || e)
      }
    }))
    const erros = resultados.filter(Boolean)
    return erros.length ? { ok: false, enviado: resultados.length > erros.length, erro: erros.join('; ') } : { ok: true, enviado: true }
  }

  function status(destinoId: string) { return estado.destinos[destinoId]?.ultimo || null }
  return { carregar, processar, testar, resolver, status }
}

export type DispatcherWebhook = ReturnType<typeof criarDispatcherWebhook>
