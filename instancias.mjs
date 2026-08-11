// Um cliente n8n por instancia, cada um com o seu proprio cache.
//
// A versao anterior tinha `chamarN8n` lendo uma config global e caches em
// variaveis de modulo. Com duas instancias isso vazaria: o cache de nomes de
// fluxo de uma responderia pelos ids da outra, e os ids do n8n sao locais a
// instancia — o mesmo `ubmape6ok` pode existir nas duas apontando para coisas
// diferentes. Por isso o cache vive DENTRO do cliente, e o cliente e criado por
// instancia e descartado quando a config dela muda.

const TEMPO_LIMITE_MS = 25000
const VALIDADE_NOMES_MS = 300000
const VALIDADE_LISTA_MS = 30000

export function idDeInstancia(nome) {
  const base = String(nome || 'n8n')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return base || 'n8n'
}

export function criarCliente(inst) {
  const raiz = String(inst.baseUrl || '').replace(/\/+$/, '')
  const cacheNomes = new Map()
  let nomesEm = 0
  let cacheLista = { em: 0, itens: [], truncado: false, paginas: 0 }

  async function chamar(caminho) {
    if (!inst.apiKey || !raiz) throw new Error('nao configurado')
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), TEMPO_LIMITE_MS)
    try {
      const r = await fetch(raiz + caminho, {
        headers: { 'X-N8N-API-KEY': inst.apiKey, accept: 'application/json' },
        signal: ctrl.signal,
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return await r.json()
    } finally {
      clearTimeout(t)
    }
  }

  async function nomesDeFluxos() {
    if (Date.now() - nomesEm < VALIDADE_NOMES_MS && cacheNomes.size) return cacheNomes
    try {
      const r = await chamar('/api/v1/workflows?limit=250')
      for (const w of r.data || []) cacheNomes.set(w.id, w.name)
      nomesEm = Date.now()
    } catch {
      /* mantem o cache anterior: nome velho e melhor que id cru na tela */
    }
    return cacheNomes
  }

  async function nomeDeFluxo(id) {
    const m = await nomesDeFluxos()
    if (m.has(id)) return m.get(id)
    try {
      const w = await chamar(`/api/v1/workflows/${id}`)
      if (w?.name) { cacheNomes.set(id, w.name); return w.name }
    } catch { /* ignora */ }
    return id
  }

  // A API limita a 250 por pagina. Sem paginar, o painel reporta 250 como se
  // fosse o total da hora - mentindo para baixo justamente quando o volume
  // explode, que e quando o numero importa. Segue pelo nextCursor.
  // `cobriu` responde a pergunta que interessa: a leitura alcancou o inicio da
  // janela pedida? "Existem mais paginas" (o antigo `truncado`) era verdadeiro
  // quase sempre e fazia o painel exibir "≥30" quando 30 era exato — ruido que
  // ensina a desconfiar do numero certo. Sem `ate`, nao ha janela a cobrir e a
  // resposta honesta e "cobriu ate onde deu".
  async function paginarExecucoes(query, { paginas = 6, ate = null } = {}) {
    const itens = []
    let cursor = null
    let alcancou = false
    for (let p = 0; p < paginas; p++) {
      const q = `/api/v1/executions?limit=250&${query}` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '')
      const r = await chamar(q)
      const lote = r.data || []
      itens.push(...lote)
      cursor = r.nextCursor
      // fim do historico: nao existe nada mais antigo para buscar
      if (!cursor || !lote.length) { alcancou = true; break }
      if (ate) {
        const maisVelho = lote[lote.length - 1]?.startedAt
        if (maisVelho && new Date(maisVelho).getTime() < ate) { alcancou = true; break }
      }
    }
    return { itens, truncado: Boolean(cursor), cobriu: ate ? alcancou : !cursor }
  }

  // `paginas` cresce conforme a janela pedida: 10 paginas cobrem menos de 2
  // horas numa instancia com ~1.400 execucoes/hora, entao um pedido de 24h
  // precisa ler muito mais. O cache guarda com quantas paginas foi montado e
  // refaz a leitura quando alguem pede mais fundo do que ele tem.
  async function listarRecentes(paginas = 10) {
    const valido = Date.now() - cacheLista.em < VALIDADE_LISTA_MS && cacheLista.itens.length
    if (valido && cacheLista.paginas >= paginas) return cacheLista
    const { itens, truncado, cobriu } = await paginarExecucoes('', { paginas })
    await nomesDeFluxos()
    const enriquecidos = itens.map((e) => ({
      id: e.id,
      workflowId: e.workflowId,
      fluxo: cacheNomes.get(e.workflowId) || e.workflowId,
      status: e.status,
      modo: e.mode,
      inicio: e.startedAt,
      fim: e.stoppedAt,
      duracaoMs: e.startedAt && e.stoppedAt
        ? new Date(e.stoppedAt).getTime() - new Date(e.startedAt).getTime()
        : null,
      // Toda linha carrega a instancia de origem. Sem isso, dois fluxos
      // homonimos em instancias diferentes ficam indistinguiveis na tela.
      instanciaId: inst.id,
      instancia: inst.nome,
    }))
    cacheLista = { em: Date.now(), itens: enriquecidos, truncado, cobriu, paginas }
    return cacheLista
  }

  return {
    inst,
    baseUrl: raiz,
    chamar,
    nomesDeFluxos,
    nomeDeFluxo,
    paginarExecucoes,
    listarRecentes,
    get nomes() { return cacheNomes },
    invalidar() {
      cacheNomes.clear(); nomesEm = 0
      cacheLista = { em: 0, itens: [], truncado: false, paginas: 0 }
    },
  }
}

// Registro de clientes vivos. A chave inclui baseUrl e um marcador da chave para
// que trocar credencial na tela de config descarte o cliente antigo em vez de
// seguir usando conexao com dado velho.
const registro = new Map()

function assinatura(inst) {
  return `${inst.id}|${inst.baseUrl}|${(inst.apiKey || '').slice(-6)}`
}

export function clienteDe(inst) {
  const chave = assinatura(inst)
  const atual = registro.get(inst.id)
  if (atual && atual.chave === chave) return atual.cliente
  const cliente = criarCliente(inst)
  registro.set(inst.id, { chave, cliente })
  return cliente
}

export function descartarClientes() {
  registro.clear()
}
