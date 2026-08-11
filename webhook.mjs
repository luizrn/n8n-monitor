import { randomUUID } from 'node:crypto'
import { assinaturaAlerta } from './alertas.mjs'

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const METODOS = new Set(['POST', 'PUT', 'PATCH'])

function textoEvento(payload) {
  const a = payload.alert
  const evento = { opened: 'ABERTO', worsened: 'AGRAVADO', resolved: 'RESOLVIDO', test: 'TESTE' }[payload.event] || payload.event.toUpperCase()
  return [
    `*${evento}* | ${a.severity === 'red' ? 'VERMELHO' : 'AMARELO'}`,
    a.title,
    a.summary || a.detail,
    a.instance?.name ? `Instância: ${a.instance.name}` : null,
    a.magnitude > 1 ? `Ocorrências: ${a.magnitude}` : null,
    a.url || null,
  ].filter(Boolean).join('\n').slice(0, 4000)
}

export function prepararEnvio(payload, cfg = {}) {
  const modo = cfg.modo || 'webhook'
  if (modo === 'discord') {
    if (!cfg.discordUrl) throw new Error('URL do webhook Discord não configurada')
    const url = new URL(cfg.discordUrl)
    url.searchParams.set('wait', 'true')
    return {
      url: url.toString(), method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'n8n-monitor/1.0' },
      body: { content: textoEvento(payload).slice(0, 2000), username: cfg.discordNome || 'n8n-monitor', allowed_mentions: { parse: [] } },
    }
  }
  if (modo === 'evolution') {
    if (!cfg.evolutionUrl || !cfg.evolutionInstancia || !cfg.evolutionApiKey || !cfg.evolutionNumero) {
      throw new Error('URL, instância, API key e número da Evolution API são obrigatórios')
    }
    return {
      url: `${cfg.evolutionUrl.replace(/\/+$/, '')}/message/sendText/${encodeURIComponent(cfg.evolutionInstancia)}`,
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'n8n-monitor/1.0', apikey: cfg.evolutionApiKey },
      body: { number: String(cfg.evolutionNumero).replace(/\D/g, ''), textMessage: { text: textoEvento(payload) } },
    }
  }
  if (!cfg.url) throw new Error('URL do webhook não configurada')
  const headers = { 'content-type': 'application/json', 'user-agent': 'n8n-monitor/1.0' }
  if (cfg.bearer) headers.authorization = `Bearer ${cfg.bearer}`
  if (cfg.headerNome) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(cfg.headerNome)) throw new Error('Nome do header opcional inválido')
    if (cfg.headerNome.toLowerCase() === 'content-type') throw new Error('Content-Type é definido automaticamente')
    headers[cfg.headerNome] = cfg.headerValor || ''
  }
  return { url: cfg.url, method: METODOS.has(cfg.metodo) ? cfg.metodo : 'POST', headers, body: payload }
}

export function payloadDe(evento, alerta, resolucao = null) {
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

export function criarDispatcherWebhook({ ler, gravar, obterConfig, fetchFn = fetch } = {}) {
  let estado = { ativos: {}, ultimo: null }
  let ocupado = false

  async function carregar() {
    try { estado = { ...estado, ...JSON.parse(await ler()) } } catch { /* primeiro uso */ }
  }

  async function enviar(payload, cfg = obterConfig()) {
    let ultimoErro
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 10000)
      try {
        const envio = prepararEnvio(payload, cfg)
        const r = await fetchFn(envio.url, { method: envio.method, headers: envio.headers, body: JSON.stringify(envio.body), signal: ctrl.signal })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return { ok: true, status: r.status }
      } catch (e) {
        ultimoErro = e
        if (tentativa < 2) await esperar([250, 1000][tentativa])
      } finally { clearTimeout(timer) }
    }
    throw ultimoErro
  }

  async function registrarUltimo(ok, detalhe) {
    estado.ultimo = { ok, detalhe: String(detalhe || ''), em: new Date().toISOString() }
    await gravar(JSON.stringify(estado, null, 2))
  }

  async function testar(cfg) {
    const alerta = { chave: 'teste', nivel: 'atencao', origem: 'teste', tipo: 'teste', titulo: 'Teste do n8n-monitor', resumo: 'Webhook configurado corretamente', magnitude: 1 }
    try {
      const r = await enviar(payloadDe('test', alerta), cfg)
      await registrarUltimo(true, `HTTP ${r.status}`)
      return { ok: true }
    } catch (e) {
      await registrarUltimo(false, e.message || e)
      return { ok: false, erro: String(e.message || e) }
    }
  }

  async function processar(alertas) {
    const cfg = obterConfig()
    if (!cfg?.ativo || ocupado) return
    ocupado = true
    try {
      const atuais = new Map(alertas.map((a) => [a.chave, a]))
      for (const alerta of alertas) {
        const anterior = estado.ativos[alerta.chave]
        const assinatura = assinaturaAlerta(alerta)
        if (anterior?.assinatura === assinatura) continue
        const piorou = !anterior
          || (anterior.alerta?.nivel !== 'ruim' && alerta.nivel === 'ruim')
          || Number(alerta.magnitude || 1) > Number(anterior.alerta?.magnitude || 1)
        if (anterior && !piorou) {
          estado.ativos[alerta.chave] = { ...anterior, assinatura, alerta }
          await gravar(JSON.stringify(estado, null, 2))
          continue
        }
        const evento = anterior ? 'worsened' : 'opened'
        try {
          await enviar(payloadDe(evento, alerta), cfg)
          estado.ativos[alerta.chave] = { assinatura, alerta, em: new Date().toISOString() }
          await registrarUltimo(true, `${evento}: ${alerta.chave}`)
        } catch (e) { await registrarUltimo(false, e.message || e) }
      }
      for (const [chave, anterior] of Object.entries({ ...estado.ativos })) {
        if (atuais.has(chave)) continue
        if (anterior.acknowledged) {
          delete estado.ativos[chave]
          await gravar(JSON.stringify(estado, null, 2))
          continue
        }
        try {
          await enviar(payloadDe('resolved', anterior.alerta, { mode: 'automatic' }), cfg)
          delete estado.ativos[chave]
          await registrarUltimo(true, `resolved: ${chave}`)
        } catch (e) { await registrarUltimo(false, e.message || e) }
      }
    } finally { ocupado = false }
  }

  async function resolver(alerta, mode = 'manual') {
    const cfg = obterConfig()
    const anterior = estado.ativos[alerta?.chave]
    if (!cfg?.ativo || !anterior) return { ok: true, enviado: false }
    try {
      await enviar(payloadDe('resolved', anterior.alerta || alerta, { mode }), cfg)
      estado.ativos[alerta.chave] = { ...anterior, acknowledged: true }
      await registrarUltimo(true, `resolved:${mode}: ${alerta.chave}`)
      return { ok: true, enviado: true }
    } catch (e) {
      await registrarUltimo(false, e.message || e)
      return { ok: false, erro: String(e.message || e) }
    }
  }

  function status() { return estado.ultimo }
  return { carregar, processar, testar, resolver, status }
}
