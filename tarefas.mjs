// Pendencias: o que saiu do Monitor por "Em analise" e ainda nao foi resolvido.
//
// A ideia e resolver uma tensao real do reconhecimento de alerta. Silenciar um
// alerta no Monitor e necessario — senao a tela vira parede de coisa velha — mas
// silenciar tambem esquece, e um problema esquecido continua em producao. Por
// isso "Em analise" nao apaga: MOVE. O alerta sai do Monitor e entra aqui, com
// estado explicito e historico de transicoes.
//
// A identidade da tarefa e a MESMA chave do alerta (`erro:<inst>:<wf>:<no>`).
// Consequencia deliberada: se o mesmo erro voltar, ele reencontra a tarefa
// existente em vez de criar duplicata — e o contador de ocorrencias sobe na
// tarefa que alguem ja esta tratando.

export const ESTADOS = ['analise', 'aguardando', 'corrigindo', 'corrigido', 'producao', 'resolvido']

export const ROTULOS = {
  analise: 'Em análise',
  aguardando: 'Aguardando',
  corrigindo: 'Corrigindo',
  corrigido: 'Corrigido',
  producao: 'Em produção',
  resolvido: 'Resolvido',
}

// Ordem de exibicao: "em analise" primeiro porque e o que ninguem comecou a
// tratar. "Resolvido" por ultimo, mas nao removido: o historico e o que permite
// perceber que o mesmo fluxo quebra toda semana.
const PESO = Object.fromEntries(ESTADOS.map((e, i) => [e, i]))

export function normalizarEstado(v) {
  return ESTADOS.includes(v) ? v : 'analise'
}

export function criarRepo({ ler, gravar }) {
  let tarefas = {}

  async function carregar() {
    try {
      const cru = JSON.parse(await ler())
      tarefas = cru && typeof cru === 'object' ? cru : {}
    } catch {
      tarefas = {}
    }
  }

  async function salvar() {
    await gravar(JSON.stringify(tarefas, null, 2))
  }

  // Chamado quando o usuario marca "Em analise" no Monitor. Se a tarefa ja
  // existe, NAO reabre nem reescreve o estado: so atualiza os dados do alerta e
  // a maior magnitude ja vista. Reabrir aqui apagaria o trabalho de quem moveu
  // a tarefa para "corrigindo".
  async function abrir(dados) {
    const agora = new Date().toISOString()
    const chave = String(dados.chave || '').trim()
    if (!chave) throw new Error('falta chave')

    const antiga = tarefas[chave]
    if (antiga) {
      antiga.magnitude = Math.max(Number(antiga.magnitude || 1), Number(dados.magnitude || 1))
      antiga.ocorrencias = (antiga.ocorrencias || 1) + 1
      antiga.vistoEm = agora
      for (const c of ['fluxo', 'no', 'mensagem', 'link', 'tipo', 'nivel', 'instancia', 'instanciaId', 'workflowId']) {
        if (dados[c] != null && dados[c] !== '') antiga[c] = dados[c]
      }
      if (antiga.estado === 'resolvido') {
        antiga.historico = [...(antiga.historico || []), {
          de: 'resolvido', para: 'analise', em: agora, motivo: 'recorrencia',
        }].slice(-40)
        antiga.estado = 'analise'
        antiga.criadoEm = agora
      }
      antiga.atualizadoEm = agora
      await salvar()
      return antiga
    }

    tarefas[chave] = {
      chave,
      instanciaId: dados.instanciaId || null,
      instancia: dados.instancia || null,
      tipo: dados.tipo || 'alerta',
      nivel: dados.nivel || 'atencao',
      fluxo: dados.fluxo || dados.titulo || null,
      workflowId: dados.workflowId || null,
      no: dados.no || null,
      mensagem: dados.mensagem || null,
      link: dados.link || null,
      magnitude: Number(dados.magnitude || 1),
      ocorrencias: 1,
      estado: 'analise',
      nota: '',
      criadoEm: agora,
      vistoEm: agora,
      atualizadoEm: agora,
      historico: [{ para: 'analise', em: agora }],
    }
    await salvar()
    return tarefas[chave]
  }

  async function mover(chave, estado, nota) {
    const t = tarefas[chave]
    if (!t) return null
    const novo = normalizarEstado(estado)
    const agora = new Date().toISOString()
    if (novo !== t.estado) {
      t.historico = [...(t.historico || []), { de: t.estado, para: novo, em: agora }].slice(-40)
      t.estado = novo
    }
    if (typeof nota === 'string') t.nota = nota.slice(0, 2000)
    t.atualizadoEm = agora
    await salvar()
    return t
  }

  async function remover(chave) {
    if (!tarefas[chave]) return false
    delete tarefas[chave]
    await salvar()
    return true
  }

  function lista() {
    return Object.values(tarefas).sort(
      (a, b) => (PESO[a.estado] ?? 9) - (PESO[b.estado] ?? 9)
        || new Date(b.atualizadoEm) - new Date(a.atualizadoEm)
    )
  }

  function contagem() {
    const c = Object.fromEntries(ESTADOS.map((e) => [e, 0]))
    for (const t of Object.values(tarefas)) c[t.estado] = (c[t.estado] || 0) + 1
    return c
  }

  // O Monitor precisa saber quais chaves estao sob tratamento para nao
  // reexibi-las. Tarefa em "resolvido" sai desta lista: se o erro voltar depois
  // de resolvido, ele DEVE reaparecer no Monitor.
  function chavesAtivas() {
    return Object.values(tarefas)
      .filter((t) => t.estado !== 'resolvido')
      .map((t) => t.chave)
  }

  function pegar(chave) { return tarefas[chave] || null }

  async function resolverAusentes(chavesPresentes) {
    const presentes = new Set(chavesPresentes || [])
    const agora = new Date().toISOString()
    let mudou = false
    for (const t of Object.values(tarefas)) {
      if (t.estado === 'resolvido' || presentes.has(t.chave)) continue
      t.historico = [...(t.historico || []), {
        de: t.estado, para: 'resolvido', em: agora, motivo: 'recuperacao-automatica',
      }].slice(-40)
      t.estado = 'resolvido'
      t.atualizadoEm = agora
      t.resolvidoAutomaticamente = true
      mudou = true
    }
    if (mudou) await salvar()
    return mudou
  }

  return { carregar, salvar, abrir, mover, remover, lista, contagem, chavesAtivas, pegar, resolverAusentes }
}
