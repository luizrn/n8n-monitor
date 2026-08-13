(() => {
  const CHAVE = 'n8nmon.tema'
  const SUPORTADOS = new Set(['escuro', 'claro'])
  let tema = SUPORTADOS.has(localStorage.getItem(CHAVE)) ? localStorage.getItem(CHAVE) : 'escuro'

  function aplicar(novo, persistir = true) {
    tema = SUPORTADOS.has(novo) ? novo : 'escuro'
    document.documentElement.dataset.theme = tema
    if (persistir) localStorage.setItem(CHAVE, tema)
    dispatchEvent(new CustomEvent('temaalterado', { detail: tema }))
    return tema
  }

  aplicar(tema, false)
  window.Theme = { definir: aplicar, atual: () => tema }

  addEventListener('DOMContentLoaded', () => {
    fetch('/api/health', { cache: 'no-store' })
      .then((resposta) => resposta.json())
      .then((saude) => {
        if (!saude?.versao) return
        document.querySelectorAll('[data-versao]').forEach((el) => {
          el.textContent = `v${saude.versao}`
        })
      })
      .catch(() => {})
    fetch('/api/config', { cache: 'no-store' })
      .then((resposta) => resposta.json())
      .then((config) => aplicar(config.tema))
      .catch(() => {})
  }, { once: true })
})()
