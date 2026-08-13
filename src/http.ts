import type { IncomingMessage, ServerResponse } from 'node:http'

export class ErroHttp extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function json(res: ServerResponse, codigo: number, corpo: unknown) {
  const s = JSON.stringify(corpo)
  res.writeHead(codigo, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(s)
}

export function redirecionar(res: ServerResponse, destino: string) {
  res.writeHead(302, { location: destino, 'cache-control': 'no-store' })
  res.end()
}

export async function lerCorpo(req: IncomingMessage) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    throw new ErroHttp(415, 'Content-Type deve ser application/json')
  }
  const origem = req.headers.origin
  if (origem) {
    let hostOrigem = ''
    try { hostOrigem = new URL(origem).host } catch { /* origem inválida */ }
    if (!hostOrigem || hostOrigem !== req.headers.host) throw new ErroHttp(403, 'origem não permitida')
  }
  const partes: Buffer[] = []
  let total = 0
  for await (const c of req) {
    const buf = Buffer.isBuffer(c) ? c : Buffer.from(c)
    partes.push(buf)
    total += buf.length
    if (total > 1e6) throw new ErroHttp(413, 'corpo excede 1 MB')
  }
  try { return JSON.parse(Buffer.concat(partes).toString('utf8') || '{}') as Record<string, unknown> }
  catch { throw new ErroHttp(400, 'JSON inválido') }
}

export function copiarCookies(de: Headers, para: ServerResponse) {
  const cookies = typeof de.getSetCookie === 'function' ? de.getSetCookie() : []
  if (cookies.length) para.setHeader('set-cookie', cookies)
}
