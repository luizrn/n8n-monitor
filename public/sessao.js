window.Sessao = (() => {
  let atual = null

  async function carregar() {
    const r = await fetch('/api/sessao', { cache: 'no-store' })
    if (r.status === 401) {
      location.href = '/login'
      return null
    }
    const d = await r.json().catch(() => ({}))
    if (r.status === 403 && d.motivo === 'trocar-senha') {
      location.href = '/trocar-senha'
      return null
    }
    atual = d
    return d
  }

  async function sair() {
    await fetch('/api/auth/sign-out', { method: 'POST' }).catch(() => {})
    location.href = '/login'
  }

  async function ativar(id) {
    const r = await fetch('/api/workspace/ativar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (r.ok) location.reload()
  }

  function montar(el, sessao) {
    if (!el || !sessao) return
    const ops = (sessao.workspaces || []).map((w) =>
      `<option value="${esc(w.id)}" ${w.id === sessao.ativo ? 'selected' : ''}>${esc(w.name)}</option>`
    ).join('')
    el.innerHTML = `${ops ? `<select id="wsAtivo" aria-label="Workspace">${ops}</select>` : ''}<span class="meta">${esc(sessao.usuario?.nome || sessao.usuario?.email || '')}</span><button type="button" id="btSair">Sair</button>`
    const sel = el.querySelector('#wsAtivo')
    if (sel) sel.onchange = () => ativar(sel.value)
    const bt = el.querySelector('#btSair')
    if (bt) bt.onclick = sair
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  return { carregar, montar, sair, atual: () => atual }
})()
