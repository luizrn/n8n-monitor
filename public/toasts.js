/* Alertas: toast na tela, notificação do sistema e som.
   Desenvolvido por Luiz Fernando Riva Nekel

   A regra que define este módulo: um alerta por PROBLEMA, não por ocorrência.
   O painel consulta a API a cada 10s; sem acumulação, um único fluxo quebrado
   produziria seis alertas por minuto e ninguém leria nenhum. Aqui, cada problema
   tem uma chave estável, persistida no navegador:

     • chave inédita          -> abre
     • mesma chave ativa      -> ignora, mesmo que a magnitude aumente
     • chave desapareceu      -> libera; se retornar, abre um novo alerta

   Assim, um problema contínuo gera exatamente um aviso.

   Os TRÊS canais compartilham esse mesmo portão. Isso é o ponto central do
   desenho: uma notificação de sistema que repetisse a cada consulta seria
   desligada pelo usuário no primeiro dia, e aí o canal mais útil — o que alcança
   quem não está com a aba aberta — estaria perdido para sempre.

   O som tem um freio EXTRA (cooldown), porque dez problemas distintos surgindo
   no mesmo instante são dez toasts legíveis, mas dez bipes sobrepostos são só
   barulho. */

window.Toaster = (() => {
  const MAXVIS = 3
  const COOLDOWN_SOM_MS = 8000

  // Padrões enquanto a configuração do servidor não chega. `navegador` e `som`
  // começam desligados de propósito: pedir permissão de notificação sem o
  // usuário ter optado é o caminho mais rápido para o "bloquear" permanente.
  let cfg = { toastSeg: 60, navegador: false, som: false, volume: 0.5 }

  const vivos = new Map()   // chave -> { el, timer, magnitude }
  const CHAVE_AVISADOS = 'n8nmon.alertas.avisados'
  const avisados = new Set(carregarAvisados())
  let ultimoSom = 0
  let audio = null
  const tr = (s) => window.I18n?.t(s) || s

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

  function carregarAvisados() {
    try {
      const x = JSON.parse(localStorage.getItem(CHAVE_AVISADOS) || '[]')
      return Array.isArray(x) ? x.filter((k) => typeof k === 'string') : []
    } catch { return [] }
  }

  function salvarAvisados() {
    try { localStorage.setItem(CHAVE_AVISADOS, JSON.stringify([...avisados])) } catch { /* armazenamento opcional */ }
  }

  const raiz = document.createElement('div')
  raiz.className = 'toasts'
  raiz.setAttribute('role', 'status')
  raiz.setAttribute('aria-live', 'polite')

  document.addEventListener('DOMContentLoaded', montar)
  if (document.readyState !== 'loading') montar()
  function montar() {
    if (!raiz.isConnected) document.body.appendChild(raiz)
  }

  // ------------------------------------------------------------------ som
  //
  // Sintetizado, sem arquivo: um .mp3 no repositório é peso morto e mais uma
  // requisição para falhar. Dois tons descendentes soam como alarme sem soar
  // como brinquedo.
  function contexto() {
    if (audio) return audio
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    audio = new AC()
    return audio
  }

  // Navegador só permite áudio depois de um gesto do usuário. Em vez de tentar
  // adivinhar quando isso aconteceu, destravamos no primeiro clique/tecla da
  // página — e o botão de teste na configuração serve como gesto explícito.
  const destravar = () => { const c = contexto(); if (c?.state === 'suspended') c.resume() }
  addEventListener('pointerdown', destravar, { once: true })
  addEventListener('keydown', destravar, { once: true })

  function tocar(volume = cfg.volume) {
    const c = contexto()
    if (!c) return false
    if (c.state === 'suspended') c.resume()
    const t0 = c.currentTime
    const ganho = c.createGain()
    ganho.connect(c.destination)
    // envelope curto: ataque rápido, cauda que não se arrasta
    const v = Math.max(0, Math.min(1, Number(volume) || 0)) * 0.28
    ganho.gain.setValueAtTime(0, t0)
    ganho.gain.linearRampToValueAtTime(v, t0 + 0.012)
    ganho.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.52)

    for (const [hz, atraso] of [[880, 0], [620, 0.16]]) {
      const osc = c.createOscillator()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(hz, t0 + atraso)
      osc.connect(ganho)
      osc.start(t0 + atraso)
      osc.stop(t0 + atraso + 0.24)
    }
    return true
  }

  // ------------------------------------------------- notificação do sistema
  function notificar(a, magnitude) {
    if (!cfg.navegador) return
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    // Aba em foco já mostra o toast; duplicar em notificação de sistema é ruído.
    if (document.visibilityState === 'visible') return
    try {
      const n = new Notification(`${a.nivel === 'ruim' ? '🔴' : '🟡'} ${tr(a.tipo || 'alerta')}`, {
        body: [a.titulo, magnitude > 1 ? `${magnitude} ${tr('ocorrências')}` : null]
          .filter(Boolean).join(' — '),
        // `tag` faz o sistema SUBSTITUIR a notificação anterior do mesmo
        // problema em vez de empilhar uma pilha de avisos idênticos.
        tag: a.chave,
        renotify: false,
        silent: true,   // o som é nosso, com cooldown próprio
      })
      n.onclick = () => { window.focus(); if (a.link) window.open(a.link, '_blank') }
    } catch { /* notificação é acessório: falhar aqui não pode quebrar o painel */ }
  }

  async function pedirPermissao() {
    if (!('Notification' in window)) return 'indisponivel'
    if (Notification.permission !== 'default') return Notification.permission
    try { return await Notification.requestPermission() } catch { return 'denied' }
  }

  // ---------------------------------------------------------------- toasts
  function fechar(chave) {
    const v = vivos.get(chave)
    if (!v) return
    clearTimeout(v.timer)
    v.el.classList.add('saindo')
    setTimeout(() => v.el.remove(), 200)
    vivos.delete(chave)
  }

  // toastSeg = 0 significa "não fecha sozinho": sem barra de progresso e sem
  // temporizador. Útil para quem quer o alerta parado na tela até ler.
  function agendar(chave, v) {
    clearTimeout(v.timer)
    const barra = v.el.querySelector('.prog')
    if (!cfg.toastSeg) { if (barra) barra.remove(); return }
    const nova = document.createElement('div')
    nova.className = 'prog'
    nova.style.animationDuration = cfg.toastSeg + 's'
    if (barra) barra.replaceWith(nova)
    else v.el.appendChild(nova)
    v.timer = setTimeout(() => fechar(chave), cfg.toastSeg * 1000)
  }

  function podar() {
    const chaves = [...vivos.keys()]
    while (chaves.length > MAXVIS) fechar(chaves.shift())
  }

  /**
   * @param {object} a
   * @param {string} a.chave      identidade estável do problema
   * @param {'ruim'|'atencao'} a.nivel
   * @param {string} a.tipo       rótulo curto ("erro de execução")
   * @param {string} a.titulo     normalmente o nome do fluxo
   * @param {string} [a.det]      uma linha de contexto (aceita HTML já escapado)
   * @param {string} [a.marca]    instância de origem, exibida como etiqueta
   * @param {number} [a.magnitude=1] quantas ocorrências, apenas para exibição
   * @param {string} [a.link]     URL para abrir no n8n
   */
  function alertar(a) {
    if (!a?.chave || (a.nivel !== 'ruim' && a.nivel !== 'atencao')) return
    const magnitude = Number(a.magnitude ?? 1)
    const existente = vivos.get(a.chave)

    if (avisados.has(a.chave)) {
      // A quantidade pode subir enquanto o problema continua aberto. Atualizamos
      // apenas o contador visível, sem prolongar, pulsar, notificar ou tocar.
      if (!existente || magnitude <= existente.magnitude) return
      existente.magnitude = magnitude
      const vezes = existente.el.querySelector('.vezes')
      if (vezes) { vezes.textContent = '×' + magnitude; vezes.hidden = magnitude <= 1 }
      return
    }

    avisados.add(a.chave)
    salvarAvisados()

    const el = document.createElement('div')
    el.className = 'toast ' + a.nivel
    el.innerHTML =
      `<div class="lin1">
         <span class="tipo">${esc(a.tipo || '')}</span>
         ${a.marca ? `<span class="marca">${esc(a.marca)}</span>` : ''}
         <span class="vezes"${magnitude > 1 ? '' : ' hidden'}>×${magnitude}</span>
         <button class="x" type="button" aria-label="${tr('fechar')}">×</button>
       </div>
       <div class="tit">${esc(a.titulo || '')}</div>
       ${a.det ? `<div class="det">${a.det}</div>` : ''}
       ${a.link ? `<div class="det"><a href="${esc(a.link)}" target="_blank">${tr('abrir no n8n →')}</a></div>` : ''}`

    el.querySelector('.x').addEventListener('click', () => fechar(a.chave))

    // passar o mouse segura o alerta: ninguém consegue ler algo que foge
    el.addEventListener('mouseenter', () => {
      const v = vivos.get(a.chave); if (!v) return
      clearTimeout(v.timer)
      const p = el.querySelector('.prog')
      if (p) p.style.animationPlayState = 'paused'
    })
    el.addEventListener('mouseleave', () => {
      const v = vivos.get(a.chave); if (!v || !cfg.toastSeg) return
      const p = el.querySelector('.prog')
      if (p) p.style.animationPlayState = 'running'
      v.timer = setTimeout(() => fechar(a.chave), cfg.toastSeg * 1000)
    })

    raiz.appendChild(el)
    const v = { el, magnitude, timer: null }
    vivos.set(a.chave, v)
    agendar(a.chave, v)
    podar()
    manifestar(a, magnitude)
  }

  function sincronizar(chavesAtivas = []) {
    const ativas = new Set(chavesAtivas)
    let mudou = false
    for (const chave of [...avisados]) {
      if (ativas.has(chave)) continue
      avisados.delete(chave)
      mudou = true
    }
    for (const chave of [...vivos.keys()]) if (!ativas.has(chave)) fechar(chave)
    if (mudou) salvarAvisados()
  }

  // Canais externos, atravessados só quando algo mudou de verdade.
  function manifestar(a, magnitude) {
    notificar(a, magnitude)
    // som apenas para vermelho: amarelo é "olhe quando puder", e apitar por isso
    // treina o time a ignorar o apito que importa
    if (cfg.som && a.nivel === 'ruim' && Date.now() - ultimoSom > COOLDOWN_SOM_MS) {
      if (tocar()) ultimoSom = Date.now()
    }
  }

  function configurar(novo) {
    const antes = cfg.toastSeg
    cfg = { ...cfg, ...(novo || {}) }
    cfg.toastSeg = Math.max(0, Math.min(600, Number(cfg.toastSeg) || 0))
    cfg.volume = Math.max(0, Math.min(1, Number(cfg.volume ?? 0.5)))
    if (cfg.toastSeg !== antes) for (const [k, v] of vivos) agendar(k, v)
    if (cfg.navegador) pedirPermissao()
    return cfg
  }

  return {
    alertar, fechar, sincronizar, configurar, pedirPermissao,
    testarSom: (v) => tocar(v),
    estado: () => ({ ...cfg }),
    limpar: () => { for (const k of [...vivos.keys()]) fechar(k) },
  }
})()
