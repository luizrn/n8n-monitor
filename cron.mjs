// Compara o que um Schedule Trigger DEVERIA disparar com o que de fato executou.
//
// Sem dependencia externa: em vez de uma biblioteca de cron, varre a janela
// minuto a minuto e testa cada minuto contra a expressao. 1440 iteracoes por dia
// e barato, e resolve horario de verao de graca porque a conversao de fuso e
// feita pelo Intl, nao por aritmetica de offset.

const DIAS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

function partesNoFuso(d, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  })
  const p = {}
  for (const { type, value } of f.formatToParts(d)) p[type] = value
  return {
    mes: +p.month,
    dia: +p.day,
    hora: +(p.hour === '24' ? '0' : p.hour),
    min: +p.minute,
    dow: DIAS[p.weekday],
  }
}

function casaCampo(campo, valor, max) {
  if (campo === '*' || campo === '?') return true
  for (const parte of String(campo).split(',')) {
    const [faixa, passoTxt] = parte.split('/')
    const passo = passoTxt ? Number(passoTxt) : 1
    if (!passo || Number.isNaN(passo)) continue
    let ini, fim
    if (faixa === '*') { ini = 0; fim = max }
    else if (faixa.includes('-')) { const [a, b] = faixa.split('-').map(Number); ini = a; fim = b }
    else { ini = fim = Number(faixa) }
    if (Number.isNaN(ini) || Number.isNaN(fim)) continue
    if (valor < ini || valor > fim) continue
    if ((valor - ini) % passo === 0) return true
  }
  return false
}

// Aceita 5 campos (min h dom mes dow) ou 6 (com segundos na frente).
export function normalizarCron(expr) {
  const p = String(expr || '').trim().split(/\s+/)
  if (p.length === 6) return p.slice(1)
  if (p.length === 5) return p
  return null
}

function casaCron(campos, t) {
  const [min, hora, dom, mes, dow] = campos
  if (!casaCampo(min, t.min, 59)) return false
  if (!casaCampo(hora, t.hora, 23)) return false
  if (!casaCampo(mes, t.mes, 12)) return false
  // Cron padrao: se dia-do-mes E dia-da-semana estao ambos restritos, vale OU.
  const domLivre = dom === '*' || dom === '?'
  const dowLivre = dow === '*' || dow === '?'
  const okDom = casaCampo(dom, t.dia, 31)
  const okDow = casaCampo(dow, t.dow % 7, 7) || casaCampo(dow, t.dow, 6)
  if (domLivre && dowLivre) return true
  if (!domLivre && !dowLivre) return okDom || okDow
  return domLivre ? okDow : okDom
}

// Traduz as opcoes do Schedule Trigger para cron, para ter um avaliador so.
export function regraParaCron(item) {
  // No Schedule Trigger o item default vem sem 'field': o padrao do no e 'days'.
  const campo = item?.field ?? 'days'
  const m = item?.triggerAtMinute ?? 0
  const h = item?.triggerAtHour ?? 0
  switch (campo) {
    case 'cronExpression': return normalizarCron(item.expression)
    case 'seconds': return null // granularidade fina demais para comparar
    case 'minutes': {
      const n = Number(item.minutesInterval ?? 5)
      return n > 0 ? [`*/${n}`, '*', '*', '*', '*'] : null
    }
    case 'hours': {
      const n = Number(item.hoursInterval ?? 1)
      return n > 0 ? [`${m}`, `*/${n}`, '*', '*', '*'] : null
    }
    case 'days': return [`${m}`, `${h}`, '*', '*', '*']
    case 'weeks': {
      const dias = Array.isArray(item.triggerAtDay) && item.triggerAtDay.length
        ? item.triggerAtDay.join(',') : '0'
      return [`${m}`, `${h}`, '*', '*', dias]
    }
    case 'months': {
      const d = item.triggerAtDayOfMonth ?? 1
      return [`${m}`, `${h}`, `${d}`, '*', '*']
    }
    default: return null
  }
}

export function descreverRegra(item) {
  switch (item?.field ?? 'days') {
    case 'cronExpression': return `cron: ${item.expression}`
    case 'seconds': return `a cada ${item.secondsInterval ?? 30}s`
    case 'minutes': return `a cada ${item.minutesInterval ?? 5} min`
    case 'hours': return `a cada ${item.hoursInterval ?? 1}h no min ${item.triggerAtMinute ?? 0}`
    case 'days': return `todo dia ${String(item.triggerAtHour ?? 0).padStart(2,'0')}:${String(item.triggerAtMinute ?? 0).padStart(2,'0')}`
    case 'weeks': return `semanal (dias ${(item.triggerAtDay||[0]).join(',')}) ${String(item.triggerAtHour ?? 0).padStart(2,'0')}:${String(item.triggerAtMinute ?? 0).padStart(2,'0')}`
    case 'months': return `mensal (dia ${item.triggerAtDayOfMonth ?? 1}) ${String(item.triggerAtHour ?? 0).padStart(2,'0')}:${String(item.triggerAtMinute ?? 0).padStart(2,'0')}`
    default: return 'regra não reconhecida'
  }
}

export function esperadas(campos, tz, inicio, fim) {
  const saida = []
  const t0 = new Date(inicio)
  t0.setUTCSeconds(0, 0)
  for (let t = t0.getTime(); t <= fim; t += 60000) {
    const d = new Date(t)
    if (casaCron(campos, partesNoFuso(d, tz))) saida.push(d)
  }
  return saida
}

// Extrai as regras de agendamento de um workflow.
export function gatilhosDe(wf) {
  const saida = []
  for (const no of wf.nodes || []) {
    const tipo = String(no.type || '')
    if (tipo === 'n8n-nodes-base.scheduleTrigger') {
      const itens = no.parameters?.rule?.interval || []
      for (const it of itens) {
        saida.push({ no: no.name, desativado: Boolean(no.disabled), item: it })
      }
    } else if (tipo === 'n8n-nodes-base.cron') {
      const itens = no.parameters?.triggerTimes?.item || []
      for (const it of itens) {
        // O no legado usa 'mode' em vez de 'field'
        const conv = { ...it, field: it.mode === 'custom' ? 'cronExpression' : it.mode,
          expression: it.cronExpression, triggerAtHour: it.hour, triggerAtMinute: it.minute }
        saida.push({ no: no.name, desativado: Boolean(no.disabled), item: conv })
      }
    } else if (tipo === 'n8n-nodes-base.interval') {
      const n = no.parameters?.interval ?? 1
      const unidade = no.parameters?.unit ?? 'minutes'
      saida.push({
        no: no.name, desativado: Boolean(no.disabled),
        item: unidade === 'hours' ? { field: 'hours', hoursInterval: n } : { field: 'minutes', minutesInterval: n },
      })
    }
  }
  return saida
}

// TOLERANCIA: o n8n nao dispara no segundo exato, e uma execucao pode demorar a
// ser registrada. Uma ocorrencia conta como cumprida se houver execucao dentro
// da janela de tolerancia depois do horario previsto.
export function comparar(ocorrencias, execucoes, toleranciaMin = 5) {
  const usadas = new Set()
  const cumpridas = []
  const perdidas = []
  for (const o of ocorrencias) {
    const alvo = o.getTime()
    let achou = null
    for (const e of execucoes) {
      if (usadas.has(e.id)) continue
      const dt = new Date(e.startedAt).getTime() - alvo
      if (dt >= -60000 && dt <= toleranciaMin * 60000) { achou = e; break }
    }
    if (achou) { usadas.add(achou.id); cumpridas.push({ previsto: o.toISOString(), execucao: achou.id, atrasoSeg: Math.round((new Date(achou.startedAt).getTime() - alvo) / 1000) }) }
    else perdidas.push(o.toISOString())
  }
  const extras = execucoes.filter((e) => !usadas.has(e.id)).map((e) => e.id)
  return { cumpridas, perdidas, extras }
}
