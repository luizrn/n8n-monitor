# n8n-monitor

> **Portuguese version:** [Read the project README in Portuguese.](README.md)

**Version 2.0.0** (this tree). Previous line: [1.0.0 guide](docs/1.0/README.en.md) · [v1.0.0 release](https://github.com/luizrn/n8n-monitor/releases/tag/v1.0.0).

[![MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![version](https://img.shields.io/badge/version-2.0.0-0ea5e9.svg)](docs/2.0/README.en.md)
[![Node 22+](https://img.shields.io/badge/node-22.5%2B-339933.svg)](https://nodejs.org/)

<img width="1902" height="909" alt="Monitor" src="https://github.com/user-attachments/assets/8d1e59fd-54e7-403b-a248-81fa63ee8441" />
<img width="1896" height="859" alt="Settings" src="https://github.com/user-attachments/assets/40069a6b-ef2a-4ff4-9a1b-e2b1ba51e54a" />
<img width="1895" height="909" alt="Tasks" src="https://github.com/user-attachments/assets/7175d343-5360-4abb-a34f-8fe6a446b5f7" />
<img width="1879" height="840" alt="Dashboard" src="https://github.com/user-attachments/assets/3142981c-b122-444a-b7ad-a999254a364b" />
<img width="1014" height="459" alt="Login" src="https://github.com/user-attachments/assets/78d50c58-c4d1-4407-bf48-b76f4e0cba2b" />

**Unified monitoring for n8n + Uptime Kuma.**

The project brings automation health and service availability into one interface. For n8n, it detects errors, stuck executions, and missed schedules across multiple instances. For Uptime Kuma, it tracks online and offline monitors, maintenance, response time, uptime, TLS certificates, and domain expiration. Incidents from both sources appear in the same Monitor and can be handled through a Tasks queue.

TypeScript server (Node.js 22.5+), native HTTP, SQLite, Better Auth, and HTML pages with no bundler. Login is required, workspaces are isolated, and public signup stays off.

## Features

### 2.0.0 platform

| | Feature | How it works |
|---|---|---|
| 🔐 | Login | Better Auth with email/password; httpOnly cookie; public signup disabled. |
| 🧭 | First-run setup | `/setup` creates the administrator and the first workspace. |
| 🔑 | Password change | Internal signup can require a new password on first login (`mustChangePassword`). |
| 🏢 | Workspaces | Each organization isolates instances, Kuma, destinations, tasks, and cache. A new workspace starts empty. |
| 👤 | Users and roles | Owners/admins register members; members use the active workspace. |
| ✉️ | Invites | Copiable link (no SMTP); accept at `/aceitar-convite`. |
| 💾 | SQLite | Source of truth in `n8n-monitor.sqlite`; legacy JSON only on first-setup import. |
| 🧱 | TypeScript | Code in `src/`, `tsc` → `dist/`, ESM. |
| 🌐 | Native HTTP | `node:http`, no Express/Fastify. |
| ❤️ | Health check | Public `GET /api/health` with `versao` and no secrets (Coolify and similar). |
| 🛡️ | API secrets | `GET /api/config` never returns keys, tokens, or secret URLs; empty POST fields keep stored values. |
| 🐳 | Docker | Node 22 Alpine, `/data` volume, Compose on `127.0.0.1:8787`. |
| 🧪 | Tests | `node:test`: unit, HTTP+auth, HTML/i18n, and pt/en doc pairs. |

### n8n

| | Feature | How it works |
|---|---|---|
| 🚨 | Grouped alerts | Repeated failures by instance, workflow, and node, with magnitude and diagnostics. |
| ⏱️ | Stuck executions | Live timer and yellow alert after 30 minutes. |
| 📅 | Schedule auditing | Compares Schedule Trigger, Cron, and Interval with executions retained by n8n. |
| 🏷️ | Multiple instances | Configuration, cache, links, tags, and filters isolated per instance. |
| ✅ | Automatic resolution | Drops an alert only when a later execution confirms recovery. Source outage is not a false recovery. |
| 📊 | Dashboard | Volume, failures, error rate, median, and p95 for up to seven days. |
| 🔎 | Logs | Search by status, mode, period, and instance; Details on the n8n block. |

### Uptime Kuma

| | Feature | How it works |
|---|---|---|
| 🟢 | Monitors | Status, response, uptime, maintenance, pause, and which monitors appear. |
| 🔐 | TLS | Certificates near expiry, expired, or invalid. |
| 🌐 | Domains | Expiration via RDAP; TLDs without a reliable source have no deadline. |

### Operations and alerts

| | Feature | How it works |
|---|---|---|
| 📋 | Tasks | List and Kanban with six statuses, notes, and history. **Under analysis** leaves the Monitor. |
| 🔔 | Browser | Yellow and red changes while the Monitor is in the background. |
| 🔊 | Sound | Red only; volume, test, and anti-spam cooldown. |
| 🪝 | External channels | Multiple destinations at once: HTTP webhook, WhatsApp/Evolution API, and Discord (`opened`, `worsened`, `resolved`). |
| 🌍 | Language | Brazilian Portuguese and English on every screen, toast, and notification. |
| 🌓 | Themes | Default dark and soft light, persisted on the workspace. |

## Quick start

### Node.js

```bash
git clone https://github.com/luizrn/n8n-monitor.git
cd n8n-monitor
npm install
npm run build
npm start
```

Open `http://127.0.0.1:8787`. With no users, the app sends you to `/setup`. Then open **Settings**, add n8n instances, and optionally Uptime Kuma (URL and API key).

### Docker Compose

```bash
docker compose up -d --build
docker compose ps
```

Compose publishes only `127.0.0.1:8787` and stores SQLite and state in `n8n-monitor-data`. In production set `BETTER_AUTH_SECRET` (32+ characters) and `BETTER_AUTH_URL` (this dashboard’s public URL, not another environment).

```bash
docker compose logs -f monitor
docker compose down                 # preserves the volume
docker compose down --volumes       # also removes persisted data
```

The dashboard requires login. Prefer a VPN or proxy for remote access.

## Configuration

Monitor tabs:

- **General:** language and theme, persisted on the workspace.
- **n8n instances:** name, URL, API key, activation, and per-instance test.
- **Notifications:** toast 0–600 s, browser, sound, and volume.
- **Uptime Kuma:** URL, API key, optional public slug, TLS/domain lead time, and monitor selection.
- **Alert delivery:** HTTP webhook, WhatsApp/Evolution API, and Discord destinations.
- **Workspace:** rename the active workspace, create workspaces, register users, and copy invite links.

**Alert delivery** stays empty until **Add destination**. **Documentation** opens the GitHub guides.

Secret fields are always empty in the browser. Leaving them empty on save keeps the stored value.

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Server bind address. |
| `PORT` | `8787` | HTTP port. |
| `N8N_MONITOR_DATA_DIR` | user directory | SQLite (and legacy JSON, if any). |
| `BETTER_AUTH_SECRET` | generated in development | Session secret (required in production, 32+). |
| `BETTER_AUTH_URL` | inferred from the request | Public dashboard URL, e.g. `https://monitor.example.com`. |
| `N8N_BASE_URL` | `http://localhost:5678` | Seeds the first instance only on first-setup import. |
| `N8N_API_KEY` | empty | Seeds the key only on first-setup import. |

Data: `%LOCALAPPDATA%\n8n-monitor` on Windows, `$HOME/n8n-monitor` elsewhere, `/data` in Docker. File: `n8n-monitor.sqlite`. Full list: [docs/2.0/variaveis.en.md](docs/2.0/variaveis.en.md).

## Routes

| Route | Screen |
|---|---|
| `/setup` | First user and workspace |
| `/login` | Sign in |
| `/aceitar-convite` | Accept invite |
| `/trocar-senha` | Required password change |
| `/` | Monitor and Settings |
| `/tarefas` | List and Kanban |
| `/dashboard` | Historical metrics |
| `/logs` | Execution search |
| `/api/health` | Public health check |

## Alert semantics

Each problem has a stable key. Toast, notification, and sound fire once while that key is active. Recovery requires source confirmation. **Under analysis** moves to Tasks; **Resolved** acknowledges the current magnitude.

Each external destination has its own state machine (`opened`, `worsened`, `resolved`). Schema: [docs/architecture.en.md](docs/architecture.en.md).

### Severity colors

| | Severity | Dark | Light | Token | Used for |
|---|---|---|---|---|---|
| 🟥 | Error | `#f0745c` | `#bd4337` | `--ruim` | unreachable instance, execution error, monitor DOWN, expired TLS or domain |
| 🟨 | Attention | `#e8bc4e` | `#946307` | `--atencao` | stuck execution, missed schedule, monitor PENDING, TLS or domain near the limit |
| 🟩 | All good | `#5cbd8a` | `#287a54` | `--bom` | no active alert, reachable instance, monitor UP |
| 🟦 | Informational | `#6fa8f5` | `#2869b6` | `--calmo` | neutral counts and volume bars |

Alerts use only two levels: `ruim` and `atencao`. Green and blue are interface states, not severities. Time-series dots use higher-saturation variants (`--pontoRuim`, `--pontoAtencao`, `--pontoBom`). Definitions in [public/base.css](public/base.css); sound plays for red only.

## Development

```bash
npm test                 # all suites
npm run test:unit        # no HTTP
npm run test:server      # login, workspaces, APIs
npm run test:html        # pages + i18n
npm run test:docs        # pt/en pairs
npm run check
npm run build            # fast tests + tsc
npm start
```

See [CONTRIBUTING.en.md](CONTRIBUTING.en.md), [SECURITY.en.md](SECURITY.en.md), and [CHANGELOG.en.md](CHANGELOG.en.md).

## Documentation

- [2.0.0 guide](docs/2.0/README.en.md): login, workspaces, SQLite, TypeScript, and variables.
- [1.0.0 guide](docs/1.0/README.en.md) and [v1.0.0 release](https://github.com/luizrn/n8n-monitor/releases/tag/v1.0.0).
- [AGENTS.en.md](AGENTS.en.md): rules for anyone changing the code.
- [Architecture](docs/architecture.en.md), [Decisions](docs/decisions.en.md), [Operations](docs/operations.en.md).

## License

[MIT](LICENSE) © 2026 Luiz Fernando Riva Nekel.
