/* Interface translations shared by Monitor, Tasks, Dashboard, Logs and toasts. */
window.I18n = (() => {
  const SUPORTADOS = new Set(['pt-BR', 'en'])
  const CHAVE = 'n8nmon.idioma'
  let idioma = SUPORTADOS.has(localStorage.getItem(CHAVE)) ? localStorage.getItem(CHAVE) : 'pt-BR'

  const en = {
    'Monitor': 'Monitor', 'Tarefas': 'Tasks', 'Dashboard': 'Dashboard', 'Logs': 'Logs',
    'Tarefas — Monitor n8n': 'Tasks — n8n Monitor', 'Dashboard — Monitor n8n': 'Dashboard — n8n Monitor',
    'Logs — Monitor n8n': 'Logs — n8n Monitor',
    'carregando': 'loading', 'carregando…': 'loading…', 'conectando': 'connecting',
    'conectado': 'connected', 'painel offline': 'dashboard offline', 'não configurado': 'not configured',
    'sem dados': 'no data', 'tudo ok': 'all good', 'erro': 'error', 'atenção': 'attention',
    'precisa de atenção': 'needs attention', 'precisam de atenção': 'need attention', 'Tudo em ordem': 'All clear',
    'Pausar': 'Pause', 'Retomar': 'Resume', 'Configurações': 'Settings',
    'O que precisa de atenção': 'What needs attention', 'Em andamento': 'In progress',
    'Agendamentos': 'Schedules', 'Tabela': 'Table', 'Detalhes': 'Details',
    'Instâncias': 'Instances', 'Instância': 'Instance', 'Status': 'Status', 'Modo': 'Mode',
    'Período': 'Period', 'Atualizar': 'Refresh', 'Salvar': 'Save', 'Salvando…': 'Saving…',
    'Fechar': 'Close', 'Testar': 'Test', 'Falhou': 'Failed', 'Copiado ✓': 'Copied ✓',
    'Copiar diagnóstico': 'Copy diagnostics', 'Copiar resumo': 'Copy summary', 'Copiar lista': 'Copy list',
    'Abrir origem': 'Open source', 'abrir origem →': 'open source →', 'abrir no n8n →': 'open in n8n →',
    'abrir →': 'open →',
    'Resolvido': 'Resolved', 'Em análise': 'Under analysis', 'Aguardando': 'Waiting',
    'Corrigindo': 'Fixing', 'Corrigido': 'Fixed', 'Em produção': 'In production',
    'Lista': 'List', 'Kanban': 'Kanban', 'Nota': 'Note', 'Atualizada': 'Updated',
    'Tarefa': 'Task', 'Nenhuma tarefa': 'No tasks', 'Histórico': 'History',
    'Contexto, responsável, próxima ação...': 'Context, owner, next action...',
    'Execuções ao longo do período': 'Executions over time', 'concluídas': 'completed',
    'com erro': 'with errors', 'Maior volume': 'Highest volume', 'Mais falhas': 'Most failures',
    'Mais lentos': 'Slowest', 'Nada no período.': 'Nothing in this period.', 'agora': 'now',
    'execuções': 'executions', 'erros': 'errors', 'taxa de erro': 'error rate',
    'fluxos ativos': 'active workflows', 'duração mediana': 'median duration', 'duração p95': 'p95 duration',
    'Fluxo': 'Workflow', 'Exec.': 'Exec.', 'Erro': 'Error', 'Erros': 'Errors', 'Taxa': 'Rate', 'Mediana': 'Median',
    'Execução': 'Execution', 'Início': 'Started', 'Duração': 'Duration', 'Carregar mais': 'Load more',
    'tudo que há': 'all available', 'Nada encontrado com esses filtros.': 'Nothing matched these filters.',
    'Sem dados do n8n.': 'No n8n data.', 'Abrir no n8n →': 'Open in n8n →',
    'não foi possível montar o diagnóstico: ': 'could not build diagnostics: ',
    'Geral': 'General', 'Idioma': 'Language', 'Português (Brasil)': 'Portuguese (Brazil)', 'Inglês': 'English', 'Documentação': 'Documentation',
    'Instâncias n8n': 'n8n instances', 'Notificações': 'Notifications', 'Adicionar instância': 'Add instance',
    'Fechar toast automaticamente': 'Close toast automatically', 'Notificações do navegador': 'Browser notifications',
    'Som em alertas vermelhos': 'Sound for red alerts', 'Volume': 'Volume', 'manual': 'manual',
    'Ativar Uptime Kuma': 'Enable Uptime Kuma', 'Ativada no Monitor': 'Enabled in Monitor', 'Desativada': 'Disabled',
    'URL base': 'Base URL', 'deixe vazio para manter': 'leave blank to keep current value',
    'Slug da página pública': 'Public status page slug', 'opcional, fallback de uptime 24h': 'optional, 24h uptime fallback',
    'Avisar expiração com antecedência (dias)': 'Warn before expiration (days)',
    'Testar e listar monitores': 'Test and list monitors', 'Monitores exibidos no Monitor': 'Monitors shown in Monitor',
    'Marque para exibir ou desmarque para remover do painel.': 'Check to show or uncheck to remove from the dashboard.',
    'Destinos de envio contínuo': 'Continuous delivery destinations',
    'Cada destino ativo recebe automaticamente alertas abertos, agravados e resolvidos, mesmo sem o Monitor aberto.': 'Each active destination automatically receives opened, worsened, and resolved alerts, even when Monitor is not open.',
    'Adicionar destino': 'Add destination', 'Novo destino': 'New destination', 'Nome do destino': 'Destination name',
    'Ativar destino': 'Enable destination', 'Remover destino': 'Remove destination', 'URL de destino': 'Destination URL',
    'Método': 'Method', 'opcional': 'optional', 'Nome do header': 'Header name', 'Valor do header': 'Header value',
    'token salvo; vazio mantém': 'token saved; blank keeps it', 'valor salvo; vazio mantém': 'value saved; blank keeps it',
    'chave salva; vazio mantém': 'key saved; blank keeps it', 'URL salva; vazio mantém': 'URL saved; blank keeps it',
    'URL base da Evolution API': 'Evolution API base URL', 'Número de destino': 'Destination number',
    'país + DDD + número': 'country code + area code + number', 'URL do webhook Discord': 'Discord webhook URL',
    'Nome exibido': 'Display name', 'Enviar teste': 'Send test', 'Entregue com sucesso ✓': 'Delivered successfully ✓',
    'Serviços monitorados': 'Monitored services', 'Serviço': 'Service', 'Uptime 24h': '24h uptime',
    'Resposta': 'Response', 'Domínio': 'Domain', 'Agendamentos: configurado × executou': 'Schedules: configured vs. executed',
    'Fluxo / nó': 'Workflow / node', 'Regra': 'Rule', 'Prev.': 'Expected', 'Cumpr.': 'Met', 'Situação': 'Status',
    'Ligado': 'Up', 'Desligado': 'Down', 'Manutenção': 'Maintenance', 'Desconhecido': 'Unknown', 'Pausado': 'Paused',
    'Integração desativada.': 'Integration disabled.', 'Sem dados do Uptime Kuma.': 'No Uptime Kuma data.',
    'Nenhum problema ativo.': 'No active problems.', 'Nada em execução agora.': 'Nothing running now.',
    'Sem dados.': 'No data.', 'No Monitor': 'In Monitor', 'Fora do Monitor': 'Outside Monitor',
    'Nenhum monitor encontrado.': 'No monitors found.', 'Carregando monitores…': 'Loading monitors…',
    'Não foi possível carregar os monitores.': 'Could not load monitors.',
    'Configure URL e API key para listar os monitores.': 'Configure the URL and API key to list monitors.',
    'Dados protegidos em': 'Protected data at', 'Nome': 'Name', 'Remover': 'Remove',
    'serviço offline': 'service offline', 'status desconhecido': 'unknown status',
    'instância offline': 'instance offline', 'erro de execução': 'execution error', 'execução travada': 'stuck execution',
    'agendamento não executou': 'schedule did not run', 'agendamento com falhas': 'schedule failures',
    'certificado TLS': 'TLS certificate', 'expiração de domínio': 'domain expiration',
    'nunca-executou': 'never ran', 'com-falhas': 'with failures', 'sem-dados': 'no data', 'ok': 'ok', 'inativo': 'inactive',
    'criada': 'created', 'vista': 'seen', 'sem instância': 'no instance',
    'movido manualmente': 'moved manually', 'recuperação confirmada': 'recovery confirmed', 'recorrência detectada': 'recurrence detected',
    'fechar': 'close', 'alerta': 'alert', 'ocorrências': 'occurrences',
    'Tudo': 'All', 'todos': 'all', 'todas': 'all', 'sem busca': 'no search',
    'Dados protegidos em {path}': 'Protected data at {path}',
    'a configuração não foi persistida': 'the configuration was not persisted',
    'Não foi possível salvar: {erro}': 'Could not save: {erro}',
    'Período pedido: {pedido}h. O banco só guarda': 'Requested period: {pedido}h. The database only retains',
    'de execuções': 'of executions',
    'os números abaixo cobrem esse intervalo, não o período inteiro.': 'the numbers below cover this interval, not the entire requested period.',
    'Aumente EXECUTIONS_DATA_PRUNE_MAX_COUNT para enxergar mais longe.': 'Increase EXECUTIONS_DATA_PRUNE_MAX_COUNT to see further back.',
    'Cobertura real do banco': 'Actual database coverage', 'últimas': 'last', 'nenhum': 'none',
    'Maior volume': 'Highest volume', 'Mais falhas': 'Most failures', 'Mais lentos': 'Slowest',
    'execução': 'execution', 'fluxo': 'workflow', 'instância': 'instance', 'modo': 'mode', 'início': 'started', 'duração': 'duration',
    'filtro': 'filter', 'instâncias': 'instances', 'período': 'period', 'tudo': 'all',
    '# Execuções n8n': '# n8n Executions', '(sem busca)': '(no search)',
    '| execução | fluxo | instância | status | modo | início | duração |': '| execution | workflow | instance | status | mode | started | duration |',
  }

  const padroes = [
    [/^(\d+) item\(ns\)$/, '$1 item(s)'],
    [/^Dados protegidos em (.*)$/, 'Protected data at $1'],
    [/^Não foi possível salvar: (.*)$/, 'Could not save: $1'],
    [/^(\d+) tarefa\(s\) · (\d+) aberta\(s\)$/, '$1 task(s) · $2 open'],
    [/^(\d+) monitores encontrados$/, '$1 monitors found'],
    [/^(\d+) ativos · expiração avisada em (\d+) dias$/, '$1 active · expiration warning at $2 days'],
    [/^(\d+) de (\d+) execuções$/, '$1 of $2 executions'],
    [/^(\d+) em memória$/, '$1 in memory'],
    [/^(\d+) em memória \(há mais no servidor\)$/, '$1 in memory (more on server)'],
    [/^(.*) · criada (.*) · vista (.*)$/, '$1 · created $2 · seen $3'],
    [/^por (\d+) min$/, 'per $1 min'],
    [/^por hora$/, 'per hour'],
    [/^Execução #(\d+)$/, 'Execution #$1'],
    [/^Destino (\d+)$/, 'Destination $1'],
    [/^n8n (\d+)$/, 'n8n $1'],
    [/^(.*): (\d+)x erro$/, '$1: $2x error'],
    [/^(.*): (\d+) ocorrência\(s\) perdida\(s\)$/, '$1: $2 missed occurrence(s)'],
    [/^(.*): desligado$/, '$1: down'],
    [/^(.*): desconhecido$/, '$1: unknown'],
    [/^(.*): TLS vence em (\d+) dias$/, '$1: TLS expires in $2 days'],
    [/^(.*): TLS expirado$/, '$1: TLS expired'],
    [/^(.*): vence em (\d+) dias$/, '$1: expires in $2 days'],
    [/^(.*): expirado$/, '$1: expired'],
    [/^(\d+) ocorrências$/, '$1 occurrences'],
    [/^(.*) · verificado (.*)h$/, '$1 · checked $2h'],
    [/^em execução há (.*); limite (\d+) min$/, 'running for $1; limit $2 min'],
  ]

  const originais = new WeakMap()
  const atributos = new WeakMap()

  function traduzir(texto) {
    if (idioma === 'pt-BR') return texto
    if (Object.hasOwn(en, texto)) return en[texto]
    for (const [re, troca] of padroes) if (re.test(texto)) return texto.replace(re, troca)
    return texto
  }

  function t(texto, vars = {}) {
    let saida = traduzir(String(texto))
    for (const [k, v] of Object.entries(vars)) saida = saida.replaceAll(`{${k}}`, v)
    return saida
  }

  function textoNo(no) {
    if (no.parentElement?.closest('script,style')) return
    if (!originais.has(no)) originais.set(no, no.nodeValue)
    const original = originais.get(no)
    const limpo = original.trim()
    if (!limpo) return
    no.nodeValue = original.replace(limpo, traduzir(limpo))
  }

  function elemento(el) {
    if (!(el instanceof Element) || el.matches('script,style')) return
    let salvos = atributos.get(el)
    if (!salvos) { salvos = {}; atributos.set(el, salvos) }
    for (const nome of ['placeholder', 'title', 'aria-label']) {
      if (!el.hasAttribute(nome)) continue
      if (!(nome in salvos)) salvos[nome] = el.getAttribute(nome)
      el.setAttribute(nome, traduzir(salvos[nome]))
    }
  }

  function aplicar(raiz = document) {
    if (raiz.nodeType === Node.TEXT_NODE) { textoNo(raiz); return }
    if (raiz.nodeType !== Node.DOCUMENT_NODE && raiz.nodeType !== Node.ELEMENT_NODE) return
    if (raiz.nodeType === Node.ELEMENT_NODE) elemento(raiz)
    const walker = document.createTreeWalker(raiz, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
    let no
    while ((no = walker.nextNode())) no.nodeType === Node.TEXT_NODE ? textoNo(no) : elemento(no)
    document.documentElement.lang = idioma
  }

  function definir(novo) {
    idioma = SUPORTADOS.has(novo) ? novo : 'pt-BR'
    localStorage.setItem(CHAVE, idioma)
    aplicar(document)
    dispatchEvent(new CustomEvent('idiomaalterado', { detail: idioma }))
  }

  const observer = new MutationObserver((mudancas) => {
    for (const m of mudancas) for (const no of m.addedNodes) aplicar(no)
  })

  function iniciar() {
    aplicar(document)
    observer.observe(document.documentElement, { childList: true, subtree: true })
    fetch('/api/config', { cache: 'no-store' }).then((r) => r.json()).then((c) => definir(c.idioma)).catch(() => {})
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar)
  else iniciar()

  return { t, aplicar, definir, idioma: () => idioma, locale: () => idioma === 'en' ? 'en-US' : 'pt-BR' }
})()
