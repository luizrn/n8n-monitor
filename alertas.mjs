const duracao = (minutos) => {
  if (minutos == null) return 'tempo desconhecido'
  const total = Math.max(0, Math.round(minutos * 60))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

export function montarAlertas(estado = {}, cron = {}, uptime = {}) {
  const alertas = []
  const instancias = new Map((estado.instancias || []).map((i) => [i.id, i]))
  const base = (id) => instancias.get(id)?.baseUrl || ''

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
      detalhe: [g.no ? `nó ${g.no}` : null, g.total > 1 ? `${g.total} ocorrências` : null]
        .filter(Boolean).join(' · '),
      mensagem: g.mensagem || null, magnitude: Number(g.total || 1),
      instanciaId: g.instanciaId, instancia: g.instancia,
      workflowId: g.workflowId, executionId: g.idExemplo,
      link: `${base(g.instanciaId)}/workflow/${g.workflowId}/executions/${g.idExemplo}`,
      copiarGrupo: (estado.erros || []).indexOf(g),
    })
  }

  for (const e of (estado.rodando || []).filter((x) => (x.minutos ?? 0) >= (estado.limiteTravadaMin || 30))) {
    alertas.push({
      chave: `travada:${e.instanciaId}:${e.id}`, origem: 'n8n', nivel: 'atencao',
      tipo: 'execução travada', titulo: e.fluxo,
      resumo: `${e.fluxo}: ${duracao(e.minutos)} rodando`,
      detalhe: `em execução há ${duracao(e.minutos)}; limite ${estado.limiteTravadaMin || 30} min`,
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
          link: uptime.baseUrl,
        })
      }
      if (m.certDias != null && (m.certDias <= uptime.limiteCertDias || m.certValido === false)) {
        alertas.push({
          chave: `tls:${m.id || m.chave}`, origem: 'tls',
          nivel: m.certDias <= 0 || m.certValido === false ? 'ruim' : 'atencao',
          tipo: 'certificado TLS', titulo: m.nome,
          resumo: `${m.nome}: TLS ${m.certDias <= 0 ? 'expirado' : `vence em ${m.certDias} dias`}`,
          detalhe: m.alvo || '', magnitude: Math.max(1, uptime.limiteCertDias - m.certDias + 1),
          link: m.url || uptime.baseUrl,
        })
      }
    }
    for (const d of uptime.dominios || []) {
      if (d.dias == null || d.dias > uptime.limiteCertDias) continue
      alertas.push({
        chave: `dominio:${d.dominio}`, origem: 'rdap',
        nivel: d.dias <= 0 ? 'ruim' : 'atencao', tipo: 'expiração de domínio',
        titulo: d.dominio,
        resumo: `${d.dominio}: ${d.dias <= 0 ? 'expirado' : `vence em ${d.dias} dias`}`,
        detalhe: d.expiraEm || '', magnitude: Math.max(1, uptime.limiteCertDias - d.dias + 1),
        link: `https://${d.dominio}`,
      })
    }
  }

  const peso = { ruim: 0, atencao: 1 }
  return alertas.sort((a, b) => (peso[a.nivel] ?? 9) - (peso[b.nivel] ?? 9) || a.titulo.localeCompare(b.titulo))
}

export function assinaturaAlerta(a) {
  return `${a.nivel}|${Number(a.magnitude || 1)}`
}
