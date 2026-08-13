const duracao = (minutos: number | null | undefined) => {
  if (minutos == null) return 'tempo desconhecido'
  const total = Math.max(0, Math.round(minutos * 60))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

type InstanciaEstado = { id: string; nome?: string; baseUrl?: string; alcancavel?: boolean }
type ErroGrupo = {
  chave?: string; instanciaId?: string; instancia?: string; workflowId?: string
  fluxo?: string; no?: string; total?: number; idExemplo?: string; mensagem?: string
}
type Rodando = {
  id: string; instanciaId?: string; instancia?: string; workflowId?: string
  fluxo?: string; minutos?: number; limiteMin?: number
}
type CronLinha = {
  veredito?: string; instanciaId?: string; workflowId?: string; no?: string
  fluxo?: string; totalPerdidas?: number; regra?: string; janelaVerificadaHoras?: number
  perdidas?: string[]; instancia?: string
}
type MonitorUptime = {
  ativo?: boolean; situacao?: string; id?: string; chave?: string; nome?: string
  alvo?: string; tipo?: string; certDias?: number | null; certValido?: boolean
  url?: string
}
type DominioUptime = { dias?: number | null; dominio?: string; expiraEm?: string }

export function montarAlertas(
  estado: {
    instancias?: InstanciaEstado[]
    inalcancaveis?: { id: string; nome: string; motivo?: string }[]
    erros?: ErroGrupo[]
    rodando?: Rodando[]
    limiteTravadaMin?: number
  } = {},
  cron: { linhas?: CronLinha[] } = {},
  uptime: {
    ok?: boolean; monitores?: MonitorUptime[]; limiteCertDias?: number
    baseUrl?: string; dominios?: DominioUptime[]
  } = {},
) {
  const alertas: Record<string, unknown>[] = []
  const instancias = new Map((estado.instancias || []).map((i) => [i.id, i]))
  const base = (id?: string) => instancias.get(id || '')?.baseUrl || ''

  for (const i of estado.inalcancaveis || []) {
    alertas.push({
      chave: `instancia:${i.id}:offline`, origem: 'n8n', nivel: 'ruim',
      tipo: 'instância offline', titulo: i.nome, resumo: `${i.nome}: offline`,
      detalhe: i.motivo || 'não foi possível acessar a API do n8n', magnitude: 1,
      instanciaId: i.id, instancia: i.nome,
    })
  }

  for (const g of estado.erros || []) {
    alertas.push({
      chave: g.chave || `erro:${g.instanciaId}:${g.workflowId}:${g.no || ''}`,
      origem: 'n8n', nivel: 'ruim', tipo: 'erro de execução',
      titulo: g.fluxo, resumo: `${g.fluxo}: ${g.total}x erro`,
      detalhe: [g.no ? `nó ${g.no}` : null, (g.total || 0) > 1 ? `${g.total} ocorrências` : null]
        .filter(Boolean).join(' · '),
      mensagem: g.mensagem || null, magnitude: Number(g.total || 1),
      instanciaId: g.instanciaId, instancia: g.instancia,
      workflowId: g.workflowId, executionId: g.idExemplo,
      link: `${base(g.instanciaId)}/workflow/${g.workflowId}/executions/${g.idExemplo}`,
      copiarGrupo: (estado.erros || []).indexOf(g),
    })
  }

  const limiteDe = (x: Rodando) => x.limiteMin ?? estado.limiteTravadaMin ?? 30

  for (const e of (estado.rodando || []).filter((x) => (x.minutos ?? 0) >= limiteDe(x))) {
    alertas.push({
      chave: `travada:${e.instanciaId}:${e.id}`, origem: 'n8n', nivel: 'atencao',
      tipo: 'execução travada', titulo: e.fluxo,
      resumo: `${e.fluxo}: ${duracao(e.minutos)} rodando`,
      detalhe: `em execução há ${duracao(e.minutos)}; limite ${limiteDe(e)} min`,
      magnitude: Math.max(1, Math.floor(e.minutos || 1)),
      instanciaId: e.instanciaId, instancia: e.instancia,
      workflowId: e.workflowId, executionId: e.id,
      link: `${base(e.instanciaId)}/workflow/${e.workflowId}/executions/${e.id}`,
    })
  }

  for (const l of (cron.linhas || []).filter((x) => x.veredito === 'nunca-executou' || x.veredito === 'com-falhas')) {
    const vermelho = l.veredito === 'nunca-executou'
    alertas.push({
      chave: `cron:${l.instanciaId}:${l.workflowId}:${l.no}`, origem: 'cron',
      nivel: vermelho ? 'ruim' : 'atencao',
      tipo: vermelho ? 'agendamento não executou' : 'agendamento com falhas',
      titulo: `${l.fluxo} — nó ${l.no}`,
      resumo: `${l.fluxo}: ${l.totalPerdidas || 1} ocorrência(s) perdida(s)`,
      detalhe: `${l.regra} · verificado ${l.janelaVerificadaHoras ?? 0}h`,
      mensagem: l.perdidas?.length ? `previstos sem execução: ${l.perdidas.join(', ')}` : null,
      magnitude: Number(l.totalPerdidas || 1), instanciaId: l.instanciaId,
      instancia: l.instancia, workflowId: l.workflowId,
      link: `${base(l.instanciaId)}/workflow/${l.workflowId}`,
    })
  }

  if (uptime.ok) {
    for (const m of uptime.monitores || []) {
      if (!m.ativo) continue
      if (m.situacao === 'desligado' || m.situacao === 'desconhecido') {
        alertas.push({
          chave: `kuma:${m.id || m.chave}`, origem: 'uptime-kuma',
          nivel: m.situacao === 'desligado' ? 'ruim' : 'atencao',
          tipo: m.situacao === 'desligado' ? 'serviço offline' : 'status desconhecido',
          titulo: m.nome, resumo: `${m.nome}: ${m.situacao}`,
          detalhe: m.alvo || m.tipo || 'monitor do Uptime Kuma', magnitude: 1,
          instancia: 'Uptime Kuma',
          link: uptime.baseUrl,
        })
      }
      if (m.certDias != null && (m.certDias <= (uptime.limiteCertDias || 0) || m.certValido === false)) {
        alertas.push({
          chave: `tls:${m.id || m.chave}`, origem: 'tls',
          nivel: m.certDias <= 0 || m.certValido === false ? 'ruim' : 'atencao',
          tipo: 'certificado TLS', titulo: m.nome,
          resumo: `${m.nome}: TLS ${m.certDias <= 0 ? 'expirado' : `vence em ${m.certDias} dias`}`,
          detalhe: m.alvo || '', magnitude: Math.max(1, (uptime.limiteCertDias || 0) - m.certDias + 1),
          link: m.url || uptime.baseUrl,
        })
      }
    }
    for (const d of uptime.dominios || []) {
      if (d.dias == null || d.dias > (uptime.limiteCertDias || 0)) continue
      alertas.push({
        chave: `dominio:${d.dominio}`, origem: 'rdap',
        nivel: d.dias <= 0 ? 'ruim' : 'atencao', tipo: 'expiração de domínio',
        titulo: d.dominio,
        resumo: `${d.dominio}: ${d.dias <= 0 ? 'expirado' : `vence em ${d.dias} dias`}`,
        detalhe: d.expiraEm || '', magnitude: Math.max(1, (uptime.limiteCertDias || 0) - d.dias + 1),
        link: `https://${d.dominio}`,
      })
    }
  }

  const peso: Record<string, number> = { ruim: 0, atencao: 1 }
  return alertas.sort((a, b) => (peso[String(a.nivel)] ?? 9) - (peso[String(b.nivel)] ?? 9) || String(a.titulo).localeCompare(String(b.titulo)))
}

export function assinaturaAlerta(a: { nivel?: string; magnitude?: number }) {
  return `${a.nivel}|${Number(a.magnitude || 1)}`
}

export function podeConfirmarRecuperacao(
  item: { chave?: string; origem?: string; instanciaId?: string } = {},
  estado: { instancias?: InstanciaEstado[] } = {},
  uptime: { ok?: boolean } = {},
) {
  const chave = String(item.chave || '')
  const origem = item.origem || (chave.startsWith('kuma:') ? 'uptime-kuma'
    : chave.startsWith('tls:') ? 'tls'
      : chave.startsWith('dominio:') ? 'rdap' : 'n8n')

  if (['uptime-kuma', 'tls', 'rdap'].includes(origem)) return uptime.ok === true

  const instanciaId = item.instanciaId
    || (/^(?:instancia|erro|travada|cron):([^:]+)/.exec(chave)?.[1])
  if (!instanciaId) return false
  return (estado.instancias || []).some((instancia) => instancia.id === instanciaId && instancia.alcancavel === true)
}
