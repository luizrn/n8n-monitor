# Workspaces

> **Portuguese:** [Workspaces](workspaces.md)

A workspace is a Better Auth **organization**. The session stores `activeOrganizationId`. Everything the dashboard shows and writes is keyed by that id.

## What is isolated

- n8n instances and API keys
- Uptime Kuma
- alert destinations (webhook, Evolution, Discord)
- language, theme, stuck-execution limits
- tasks, acknowledgements, webhook anti-spam state
- cache and collector (`Map<organizationId, cache>`), each workspace on its own cadence
- n8n clients keyed by `orgId + instanciaId`

## Selector

The top bar on Monitor, Tasks, Dashboard, and Logs lists the user’s workspaces. Switching calls `POST /api/workspace/ativar`.

Workspaces are collected independently and none waits on another: a slow n8n in one workspace does not delay switching to or reading the others. The active workspace is collected every 15s; those nobody has opened in the last 5 minutes every 60s — enough to keep alerts and webhooks running. When entering an idle workspace, the first read may come back flagged partial while the collection finishes.

## Create

`POST /api/workspace` with `{ nome }`. The creator becomes owner. The session then points at the new workspace, which starts **empty** (no instances, tokens, or destinations copied from another workspace). Legacy JSON is imported only on initial setup.

## Rename

`PATCH /api/workspace` with `{ nome }` changes the **active** workspace. Owner/admin only. The internal slug does not change.

## Roles

| Role | Can |
|---|---|
| owner / admin | create workspaces, **rename the active one**, register users, invite, list members, save config |
| member | use Monitor/Tasks/Dashboard/Logs of the active workspace |

With no active workspace, data APIs respond `403` with `motivo: "sem-workspace"`.
