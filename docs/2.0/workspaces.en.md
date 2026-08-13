# Workspaces

> **Portuguese:** [Workspaces](workspaces.md)

A workspace is a Better Auth **organization**. The session stores `activeOrganizationId`. Everything the dashboard shows and writes is keyed by that id.

## What is isolated

- n8n instances and API keys
- Uptime Kuma
- alert destinations (webhook, Evolution, Discord)
- language, theme, stuck-execution limits
- tasks, acknowledgements, webhook anti-spam state
- cache and collector (`Map<organizationId, cache>`)
- n8n clients keyed by `orgId + instanciaId`

## Selector

The top bar on Monitor, Tasks, Dashboard, and Logs lists the user’s workspaces. Switching calls `POST /api/workspace/ativar`.

## Create

`POST /api/workspace` with `{ nome }`. The creator becomes owner. The session then points at the new workspace (empty, unless leftover JSON is imported because that org has no config yet).

## Roles

| Role | Can |
|---|---|
| owner / admin | create workspaces, register users, invite, list members, save config |
| member | use Monitor/Tasks/Dashboard/Logs of the active workspace |

With no active workspace, data APIs respond `403` with `motivo: "sem-workspace"`.
