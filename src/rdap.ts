const IANA = 'https://data.iana.org/rdap/dns.json'
const DIA = 86400000

export function hostnameDeMonitor(m: { host?: string | null; url?: string | null }) {
  const cru = m?.host || m?.url
  if (!cru) return null
  try {
    const host = m.host || new URL(m.url || '').hostname
    if (!host || host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return null
    return host.toLowerCase().replace(/\.$/, '')
  } catch { return null }
}

export function expiracaoDeRdap(json: { events?: { eventAction?: string; eventDate?: string }[] }) {
  const evento = (json?.events || []).find((e) => ['expiration', 'expiry'].includes(String(e.eventAction).toLowerCase()))
  const data = evento?.eventDate ? new Date(evento.eventDate) : null
  return data && !Number.isNaN(data.getTime()) ? data : null
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export function criarResolvedorRdap({ fetchFn = fetch, agora = () => Date.now() }: { fetchFn?: FetchFn; agora?: () => number } = {}) {
  let bootstrap: { em: number; dados: { services?: [string[], string[]][] } | null } = { em: 0, dados: null }
  const cache = new Map<string, { em: number; valor: { dominio: string; expiraEm: string; dias: number; fonte: string } | null }>()

  async function servicoDoTld(tld: string) {
    if (!bootstrap.dados || agora() - bootstrap.em > DIA) {
      const r = await fetchFn(IANA, { headers: { accept: 'application/json' } })
      if (!r.ok) throw new Error(`IANA HTTP ${r.status}`)
      bootstrap = { em: agora(), dados: await r.json() as { services?: [string[], string[]][] } }
    }
    for (const [tlds, urls] of (bootstrap.dados?.services || [])) {
      if (tlds.map((x) => String(x).toLowerCase()).includes(tld)) return urls?.[0] || null
    }
    return null
  }

  async function consultar(hostname: string) {
    if (cache.has(hostname) && agora() - (cache.get(hostname)?.em || 0) < DIA) return cache.get(hostname)?.valor ?? null
    const partes = hostname.split('.').filter(Boolean)
    if (partes.length < 2) return null
    let base: string | null
    try { base = await servicoDoTld(partes.at(-1) || '') } catch { return null }
    if (!base) return null

    for (let i = 0; i <= partes.length - 2; i++) {
      const dominio = partes.slice(i).join('.')
      try {
        const r = await fetchFn(`${base.replace(/\/+$/, '')}/domain/${encodeURIComponent(dominio)}`, {
          headers: { accept: 'application/rdap+json, application/json' },
        })
        if (r.status === 404) continue
        if (!r.ok) break
        const data = expiracaoDeRdap(await r.json() as { events?: { eventAction?: string; eventDate?: string }[] })
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

  async function enriquecer(monitores: { ativo?: boolean; host?: string | null; url?: string | null }[]) {
    const hosts = [...new Set((monitores || []).filter((m) => m.ativo).map(hostnameDeMonitor).filter(Boolean))] as string[]
    const itens = await Promise.all(hosts.map(consultar))
    return [...new Map(itens.filter(Boolean).map((x) => [x!.dominio, x!])).values()]
      .sort((a, b) => a.dias - b.dias)
  }

  return { consultar, enriquecer }
}
