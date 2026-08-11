# n8n-monitor

> **Portuguese version:** [Read the project README in Portuguese.](README.md)

[![MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node 20+](https://img.shields.io/badge/node-20%2B-339933.svg)](https://nodejs.org/)

<img width="1621" height="760" alt="n8n Monitor" src="https://github.com/user-attachments/assets/c7f639e0-6f10-44f6-8da6-00cf63a49c07" />

An operational dashboard for quickly detecting errors, stuck executions, missed schedules, and service outages. It supports multiple n8n instances, integrates with Uptime Kuma, and keeps incident handling organized in a Tasks queue.

Built with plain Node.js, with no npm dependencies, framework, or build step.

## Features

| | Feature | How it works |
|---|---|---|
| 🚨 | Grouped alerts | Groups repeated failures by instance, workflow, and node while preserving magnitude and diagnostics. |
| ⏱️ | Stuck executions | Live timer and yellow alert after 30 minutes. |
| 📅 | Schedule auditing | Compares Schedule Trigger, Cron, and Interval definitions with the executions actually retained by n8n. |
| 🏷️ | Multiple instances | Configuration, cache, links, tags, and filters isolated by n8n instance. |
| ✅ | Automatic resolution | Removes an alert when a later execution confirms recovery. |
| 📋 | Tasks | Moves alerts to List or Kanban views with six statuses, notes, and history. |
| 📊 | Dashboard | Volume, failures, error rate, median, and p95 for periods of up to seven days. |
| 🔎 | Logs | Search and filters by status, mode, period, and instance, with redacted diagnostics. |
| 🔔 | Browser notifications | Reports yellow and red changes while the Monitor is open in the background. |
| 🔊 | Sound | Plays only for red alerts, with volume, test control, and an anti-spam cooldown. |
| 🪝 | External channels | Sends opened, worsened, and resolved events simultaneously to multiple HTTP Webhooks, WhatsApp/Evolution API, and Discord destinations. |
| 🟢 | Uptime Kuma | Displays status, response time, uptime, maintenance, paused state, and selectable monitors. |
| 🔐 | TLS | Warns about certificates that are close to expiration, expired, or invalid. |
| 🌐 | Domains | Checks domain expiration through RDAP and ignores TLDs without a reliable source. |
| 🐳 | Docker | Non-root image, health check, persistent volume, and Compose bound to loopback. |
| 🧪 | Automated tests | `node:test`, server smoke tests, and local syntax checks. |

## Quick Start

### Node.js

```bash
git clone https://github.com/luizrn/n8n-monitor.git
cd n8n-monitor
npm start
```

Open `http://127.0.0.1:8787`, go to **Settings**, and add an n8n instance.

### Docker Compose

```bash
docker compose up -d --build
docker compose ps
```

Compose publishes only `127.0.0.1:8787` and keeps configuration, tasks, and state in the `n8n-monitor-data` volume.

```bash
docker compose logs -f monitor
docker compose down                 # preserves the volume
docker compose down --volumes       # also removes persisted data
```

Do not expose the dashboard directly to the internet. It is an administrative tool without built-in authentication. Use a VPN or authenticated proxy when remote access is required.

## Configuration

The Monitor contains four settings tabs:

- **n8n Instances:** name, URL, API key, activation, and individual connection test.
- **Notifications:** toast duration from 0 to 600 seconds, browser notifications, sound, and volume.
- **Uptime Kuma:** URL, API key, optional public-page slug, expiration warning threshold, and monitor selection.
- **Webhook:** a list of HTTP Webhook, WhatsApp/Evolution API, and Discord destinations, each with its own name, activation switch, credentials, test action, and latest result. Multiple destinations can run simultaneously. HTTP mode supports `POST`, `PUT`, or `PATCH`, Bearer authentication, and one optional custom header.

Secret fields are always returned empty to the browser. Leaving them empty when saving preserves the current value.

Available environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Server network interface. |
| `PORT` | `8787` | HTTP port. |
| `N8N_MONITOR_DATA_DIR` | user directory | Location of persisted files. |
| `N8N_BASE_URL` | `http://localhost:5678` | Seeds the first instance. |
| `N8N_API_KEY` | empty | Seeds the first instance API key. |

Data is stored in `%LOCALAPPDATA%\n8n-monitor` on Windows, `$HOME/n8n-monitor` on other systems, or the directory selected through the environment variable. Sensitive files use `0600` permissions.

## Routes

| Route | Screen |
|---|---|
| `/` | Monitor and Settings |
| `/tarefas` | Task List and Kanban |
| `/dashboard` | Historical metrics |
| `/logs` | Execution search |
| `/api/health` | Health check without sensitive data |

## Alert Semantics

Each problem has a stable key. Toasts, browser notifications, and sounds are emitted only once while that key remains active, even if its magnitude increases or the page is reloaded. When the problem disappears, the key is released and a future recurrence may notify again. **Under analysis** moves the item to Tasks and removes it from the Monitor; **Resolved** acknowledges the current magnitude.

Each external destination maintains its own state machine and receives `opened`, `worsened`, and `resolved` events. See [docs/arquitetura.md](docs/arquitetura.md) for the schema.

## Development

```bash
npm test
npm run check
npm start
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CHANGELOG.md](CHANGELOG.md).

## Documentation

- [Architecture](docs/arquitetura.md): components, data, APIs, and payloads.
- [Decisions](docs/decisoes.md): reliability and anti-spam criteria.
- [Operations](docs/operacao.md): installation, security, and troubleshooting.

## License

[MIT](LICENSE) © 2026 Luiz Fernando Riva Nekel.
