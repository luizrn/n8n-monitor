/* Toasts de alerta, acumulativos.
   Desenvolvido por Luiz Fernando Riva Nekel

   A regra que define este módulo: um toast por PROBLEMA, não por ocorrência.
   O painel consulta a API a cada 10s; sem acumulação, um único fluxo quebrado
   produziria seis toasts por minuto e ninguém leria nenhum. Aqui, cada problema
   tem uma chave estável — e reaparecer não cria toast novo:

     • chave inédita          -> abre um toast
     • mesma chave, mesma     -> ignora (nada muda na tela)
       magnitude
     • mesma chave, magnitude -> atualiza o contador, reinicia o tempo e dá um
       maior (o erro piorou)     pulso, porque a situação piorou de verdade

   Assim o silêncio significa "estável" e o movimento significa "mudou". */

window.Toaster = (() => {
  const CHAVE_LS = 'n8nmon.toastSeg'
  const MIN = 5, MAX = 60, MAXVIS = 5

  let duracao = Math.min(MAX, Math.max(MIN, Number(localStorage.getItem(CHAVE_LS) || 20)))
  const vivos = new Map()   // chave -> { el, timer, magnitude }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

  const raiz = document.createElement('div')
  raiz.className = 'toasts'
  raiz.setAttribute('role', 'status')
  raiz.setAttribute('aria-live', 'polite')

  const ctrl = document.createElement('div')
  ctrl.className = 'toast-ctrl'
  ctrl.innerHTML =
    `<span>fechar em</span>
     <input type="range" min="${MIN}" max="${MAX}" step="5" value="${duracao}"
            aria-label="segundos até o alerta fechar">
     <b id="toastSegVal">${duracao}s</b>
     <button type="button" id="toastLimpar" title="fechar todos">limpar</button>`

  const faixa = ctrl.querySelector('input')
  const rotulo = ctrl.querySelector('#toastSegVal')

  faixa.addEventListener('input', () => {
    duracao = Number(faixa.value)
    rotulo.textContent = duracao + 's'
    localStorage.setItem(CHAVE_LS, String(duracao))
    // reinicia o que está na tela, para o novo tempo valer de imediato
    for (const [chave, v] of vivos) reiniciar(chave, v)
  })
  ctrl.querySelector('#toastLimpar').addEventListener('click', () => {
    for (const chave of [...vivos.keys()]) fechar(chave)
  })

  document.addEventListener('DOMContentLoaded', montar)
  if (document.readyState !== 'loading') montar()
  function montar() {
    if (raiz.isConnected) return
    document.body.appendChild(raiz)
    raiz.appendChild(ctrl)
  }

  function fechar(chave) {
    const v = vivos.get(chave)
    if (!v) return
    clearTimeout(v.timer)
    v.el.classList.add('saindo')
    setTimeout(() => v.el.remove(), 200)
    vivos.delete(chave)
  }

  function reiniciar(chave, v) {
    clearTimeout(v.timer)
    // recria a barra para a animação começar do zero: reiniciar animação CSS
    // sem trocar o nó exige forçar reflow, e trocar é mais previsível
    const antiga = v.el.querySelector('.prog')
    const nova = document.createElement('div')
    nova.className = 'prog'
    nova.style.animationDuration = duracao + 's'
    antiga.replaceWith(nova)
    v.timer = setTimeout(() => fechar(chave), duracao * 1000)
  }

  function podar() {
    // mantém a tela legível: além do teto, some com os mais antigos
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
   * @param {number} [a.magnitude=1] quantas ocorrências; só cresce é que alerta
   * @param {string} [a.link]     URL para abrir no n8n
   */
  function alertar(a) {
    if (!a?.chave || (a.nivel !== 'ruim' && a.nivel !== 'atencao')) return
    const magnitude = Number(a.magnitude ?? 1)
    const existente = vivos.get(a.chave)

    if (existente) {
      if (magnitude <= existente.magnitude) return   // estável: silêncio
      existente.magnitude = magnitude
      const vezes = existente.el.querySelector('.vezes')
      if (vezes) { vezes.textContent = '×' + magnitude; vezes.hidden = magnitude <= 1 }
      existente.el.classList.remove('pulsou')
      void existente.el.offsetWidth
      existente.el.classList.add('pulsou')
      reiniciar(a.chave, existente)
      return
    }

    const el = document.createElement('div')
    el.className = 'toast ' + a.nivel
    el.innerHTML =
      `<div class="lin1">
         <span class="tipo">${esc(a.tipo || '')}</span>
         <span class="vezes"${magnitude > 1 ? '' : ' hidden'}>×${magnitude}</span>
         <button class="x" type="button" aria-label="fechar">×</button>
       </div>
       <div class="tit">${esc(a.titulo || '')}</div>
       ${a.det ? `<div class="det">${a.det}</div>` : ''}
       ${a.link ? `<div class="det"><a href="${esc(a.link)}" target="_blank">abrir no n8n →</a></div>` : ''}
       <div class="prog" style="animation-duration:${duracao}s"></div>`

    el.querySelector('.x').addEventListener('click', () => fechar(a.chave))

    // passar o mouse segura o alerta: ninguém consegue ler algo que foge
    el.addEventListener('mouseenter', () => {
      const v = vivos.get(a.chave); if (!v) return
      clearTimeout(v.timer)
      const p = el.querySelector('.prog')
      if (p) p.style.animationPlayState = 'paused'
    })
    el.addEventListener('mouseleave', () => {
      const v = vivos.get(a.chave); if (!v) return
      const p = el.querySelector('.prog')
      if (p) p.style.animationPlayState = 'running'
      v.timer = setTimeout(() => fechar(a.chave), duracao * 1000)
    })

    raiz.insertBefore(el, ctrl.nextSibling)
    const v = { el, magnitude, timer: setTimeout(() => fechar(a.chave), duracao * 1000) }
    vivos.set(a.chave, v)
    podar()
  }

  return { alertar, fechar, limpar: () => { for (const k of [...vivos.keys()]) fechar(k) } }
})()
