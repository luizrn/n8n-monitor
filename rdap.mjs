const IANA = 'https://data.iana.org/rdap/dns.json'
const DIA = 86400000

export function hostnameDeMonitor(m) {
  const cru = m?.host || m?.url
  if (!cru) return null
  try {
    const host = m.host || new URL(m.url).hostname
    if (!host || host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return null
    return host.toLowerCase().replace(/\.$/, '')
  } catch { return null }
}

export function expiracaoDeRdap(json) {
  const evento = (json?.events || []).find((e) => ['expiration', 'expiry'].includes(String(e.eventAction).toLowerCase()))
  const data = evento?.eventDate ? new Date(evento.eventDate) : null
  return data && !Number.isNaN(data.getTime()) ? data : null
}

export function criarResolvedorRdap({ fetchFn = fetch, agora = () => Date.now() } = {}) {
  let bootstrap = { em: 0, dados: null }
  const cache = new Map()

  async function servicoDoTld(tld) {
    if (!bootstrap.dados || agora() - bootstrap.em > DIA) {
      const r = await fetchFn(IANA, { headers: { accept: 'application/json' } })
      if (!r.ok) throw new Error(`IANA HTTP ${r.status}`)
      bootstrap = { em: agora(), dados: await r.json() }
    }
    for (const [tlds, urls] of bootstrap.dados.services || []) {
      if (tlds.map((x) => String(x).toLowerCase()).includes(tld)) return urls?.[0] || null
    }
    return null
  }

  async function consultar(hostname) {
    if (cache.has(hostname) && agora() - cache.get(hostname).em < DIA) return cache.get(hostname).valor
    const partes = hostname.split('.').filter(Boolean)
    if (partes.length < 2) return null
    let base
    try { base = await servicoDoTld(partes.at(-1)) } catch { return null }
    if (!base) return null

    for (let i = 0; i <= partes.length - 2; i++) {
      const dominio = partes.slice(i).join('.')
      try {
        const r = await fetchFn(`${base.replace(/\/+$/, '')}/domain/${encodeURIComponent(dominio)}`, {
          headers: { accept: 'application/rdap+json, application/json' },
        })
        if (r.status === 404) continue
        if (!r.ok) break
        const data = expiracaoDeRdap(await r.json())
        if (!data) break
        const valor = {
          dominio, expiraEm: data.toISOString(),
          dias: Math.ceil((data.getTime() - agora()) / DIA), fonte: base,
        }
        cache.set(hostname, { em: agora(), valor })
        return valor
      } catch { break }
    }
    cache.set(hostname, { em: agora(), valor: null })
    return null
  }

  async function enriquecer(monitores) {
    const hosts = [...new Set((monitores || []).filter((m) => m.ativo).map(hostnameDeMonitor).filter(Boolean))]
    const itens = await Promise.all(hosts.map(consultar))
    return [...new Map(itens.filter(Boolean).map((x) => [x.dominio, x])).values()]
      .sort((a, b) => a.dias - b.dias)
  }

  return { consultar, enriquecer }
}
