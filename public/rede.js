/* Uma requisição em voo por chave, com prazo. Compartilhado por Monitor, Tarefas,
   Dashboard e Logs.

   Sem esta guarda, um setInterval sobre um backend lento empilha requisições
   penduradas até estourar o limite de conexões por origem do navegador — e aí a
   página inteira congela, não só a chamada lenta. */
window.Rede = (() => {
  const LIMITE_MS = 25000
  const emVoo = new Map()

  /* Devolve o JSON, ou null quando já havia uma requisição em voo para a mesma
     chave e forcar é falso. Trate null como "pule este ciclo". */
  async function json(chave, url, { forcar = false, limiteMs = LIMITE_MS } = {}) {
    const atual = emVoo.get(chave)
    if (atual) {
      if (!forcar) return null
      atual.abort()
    }
    const ctrl = new AbortController()
    emVoo.set(chave, ctrl)
    const prazo = setTimeout(() => ctrl.abort(), limiteMs)
    try {
      const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal })
      return await r.json()
    } finally {
      clearTimeout(prazo)
      if (emVoo.get(chave) === ctrl) emVoo.delete(chave)
    }
  }

  const abortado = (e) => e && e.name === 'AbortError'

  return { json, abortado }
})()
