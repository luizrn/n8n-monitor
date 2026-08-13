const CHAVE_SENSIVEL = /(token|apikey|api_key|secret|senha|password|authorization|cookie|bearer|credential)/i
const CHAVES_PERIGOSAS = new Set(['__proto__', 'prototype', 'constructor'])

export function chaveDeRegistroValida(valor: unknown) {
  const chave = String(valor || '').trim()
  return Boolean(chave) && chave.length <= 1000 && !CHAVES_PERIGOSAS.has(chave)
}

export function registroSeguro<T = unknown>(valor?: unknown): Record<string, T> {
  const saida = Object.create(null) as Record<string, T>
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return saida
  for (const [chave, item] of Object.entries(valor as Record<string, T>)) {
    if (chaveDeRegistroValida(chave)) saida[chave] = item
  }
  return saida
}

export function urlHttpValida(valor: unknown) {
  try {
    const url = new URL(String(valor || ''))
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}

export function redigirTexto(valor: unknown) {
  const texto = String(valor ?? '')
  if (/^ey[A-Za-z0-9_-]{20,}\./.test(texto)) return '[REDIGIDO:jwt]'
  return texto
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_=.~-]+/gi, '$1 [REDIGIDO]')
    .replace(/([?&](?:access[_-]?token|token|api[_-]?key|apikey|secret|senha|password|authorization|cookie|bearer|credential)=)[^&#\s"'`]+/gi, '$1[REDIGIDO]')
    .replace(/(\b(?:access[_-]?token|token|api[_-]?key|apikey|secret|senha|password|authorization|cookie|bearer|credential)\s*[:=]\s*)[^\s,;&]+/gi, '$1[REDIGIDO]')
    .replace(/(https?:\/\/)[^/\s:@]+:[^@\s/]+@/gi, '$1[REDIGIDO]@')
}

export function redigir(valor: unknown, profundidade = 0): unknown {
  if (profundidade > 12) return '[fundo]'
  if (Array.isArray(valor)) return valor.map((item) => redigir(item, profundidade + 1))
  if (valor && typeof valor === 'object') {
    const saida = Object.create(null) as Record<string, unknown>
    const obj = valor as Record<string, unknown>
    for (const [chave, item] of Object.entries(obj)) {
      if (CHAVE_SENSIVEL.test(chave)) {
        saida[chave] = '[REDIGIDO]'
      } else if (chave === 'value' && CHAVE_SENSIVEL.test(String(obj.name ?? ''))) {
        saida[chave] = '[REDIGIDO]'
      } else {
        saida[chave] = redigir(item, profundidade + 1)
      }
    }
    return saida
  }
  return typeof valor === 'string' ? redigirTexto(valor) : valor
}
