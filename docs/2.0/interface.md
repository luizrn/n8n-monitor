# Interface

> **English:** [Interface](interface.en.md)

Páginas em `public/`, tema e i18n iguais ao restante do painel.

| Rota | Tela |
|---|---|
| `/login` | e-mail e senha |
| `/setup` | primeiro usuário + workspace (só se o banco estiver vazio) |
| `/aceitar-convite` | nome e senha a partir do id do convite |
| `/trocar-senha` | obrigatória quando `mustChangePassword` |
| `/` | Monitor e Configurações |
| `/tarefas` | Lista e Kanban |
| `/dashboard` | métricas |
| `/logs` | execuções |

## Badge de versão

Todas essas telas mostram `v2.0.0` (classe `.versao`). O valor vem de `GET /api/health` (`versao`).

## Topo autenticado

Seletor de workspace, nome do usuário e **Sair**. Trocar o seletor recarrega a página no workspace novo.

## Aba Workspace (Configurações)

Blocos separados: workspace atual (renomear), lista + criar, usuários e convite.

- **renomear** o workspace ativo (`PATCH /api/workspace` com `{ nome }`, owner/admin)
- criar workspace (nome)
- listar membros
- cadastrar: nome, e-mail, senha, papel, checkbox de troca no primeiro login
- convidar: e-mail + papel → copiar o link
