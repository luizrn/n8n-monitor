# Interface

> **Portuguese:** [Interface](interface.md)

Pages live in `public/`, with the same theme and i18n as the rest of the dashboard.

| Route | Screen |
|---|---|
| `/login` | email and password |
| `/setup` | first user + workspace (only if the database is empty) |
| `/aceitar-convite` | name and password from the invite id |
| `/trocar-senha` | required when `mustChangePassword` |
| `/` | Monitor and Settings |
| `/tarefas` | List and Kanban |
| `/dashboard` | metrics |
| `/logs` | executions |

## Version badge

All of these screens show `v2.0.0` (`.versao` class). The value comes from `GET /api/health` (`versao`).

## Authenticated top bar

Workspace selector, user name, and **Sign out**. Changing the selector reloads the page on the new workspace.

## Monitor

The top bar shows a state indicator carrying the most severe open level:

| Indicator | When |
|---|---|
| `all good` | no active alert |
| `attention` | only yellow alerts |
| `error` | at least one red alert |
| `collecting` | the workspace's first collection is still running |
| `dashboard offline` | reading `GET /api/state` failed |

With no active alerts, the center panel shows **All clear** with a badge, headline, and the connections (n8n instances and Uptime Kuma) highlighted for reading at a distance.

## Workspace tab (Settings)

Separate blocks: current workspace (rename), list + create, users, and invite.

- **rename** the active workspace (`PATCH /api/workspace` with `{ nome }`, owner/admin)
- create a workspace (name)
- list members
- register: name, email, password, role, first-login password-change checkbox
- invite: email + role → copy the link
