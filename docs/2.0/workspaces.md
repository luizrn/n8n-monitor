# Workspaces

> **English:** [Workspaces](workspaces.en.md)

Um workspace é uma **organization** do Better Auth. A sessão guarda `activeOrganizationId`. Tudo que o painel mostra e grava fica preso a esse id.

## O que é isolado

- instâncias n8n e API keys
- Uptime Kuma
- destinos de alerta (webhook, Evolution, Discord)
- idioma, tema, limites de execução travada
- tarefas, reconhecimentos, estado anti-spam do webhook
- cache e coletor (`Map<organizationId, cache>`)
- clientes n8n chaveados por `orgId + instanciaId`

## Seletor

O topo de Monitor, Tarefas, Dashboard e Logs lista os workspaces do usuário. Trocar chama `POST /api/workspace/ativar`.

## Criar

`POST /api/workspace` com `{ nome }`. O criador vira owner. A sessão passa a apontar para o novo workspace, **vazio** (sem copiar instâncias, tokens nem destinos de outro workspace). JSON legado só entra no setup inicial.

## Renomear

`PATCH /api/workspace` com `{ nome }` altera o workspace **ativo**. Só owner/admin. O slug interno não muda.

## Papéis

| Papel | Pode |
|---|---|
| owner / admin | criar workspace, **renomear o ativo**, cadastrar, convidar, listar membros, salvar config |
| member | usar Monitor/Tarefas/Dashboard/Logs do workspace ativo |

Sem workspace ativo as APIs de dados respondem `403` com `motivo: "sem-workspace"`.
