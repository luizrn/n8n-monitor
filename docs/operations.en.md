# Operations

> **Portuguese version:** [Operação](operacao.md)

**2.0.0** guide: [docs/2.0](2.0/README.en.md). **1.0.0** line: [docs/1.0](1.0/README.en.md) · [release](https://github.com/luizrn/n8n-monitor/releases/tag/v1.0.0).

## Startup

Direct:

```bash
npm install
npm run build
npm start
```

On first access, open `/setup` and create the administrator and initial workspace. In production, set `BETTER_AUTH_SECRET` (32+ characters) and `BETTER_AUTH_URL`.

Docker:

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:8787/api/health
```

The health check confirms process liveness; it does not test every integration. Detailed status appears in Monitor.

## Configuring n8n

Create an API key in **Settings > n8n API**. For each instance, provide a name, a URL without `/api/v1`, and the key. The test reads one workflow and responds without saving the values.

Disabling an instance stops collection without deleting configuration. Removing an instance keeps historical tasks with their recorded instance name.

Short retention limits Dashboard and schedule auditing. Set n8n retention according to the period you need to inspect; Monitor reports the actual available coverage.

When no problems are active, the dashboard shows the number of active, reachable n8n instances. Select **Details** in the n8n panel to open `/logs` with collected executions.

## Uptime Kuma

Create an API key with access to `/metrics` and provide the base URL. When Settings opens, the saved credential loads the monitor list automatically. Each item says **In Monitor** or **Outside Monitor** according to its selection. New monitors are selected by default. Use **Test and list monitors** after changing the URL, key, or slug. The optional public-page slug is only a fallback for 24-hour uptime.

States:

- DOWN: red;
- PENDING/unknown: yellow;
- MAINTENANCE and paused: informational;
- TLS/domain inside the threshold: yellow;
- expired or invalid TLS/domain: red.

An RDAP failure does not take Kuma down. A TLD without an official service or published date appears without an expiration estimate.

## Notifications

Browser permission is requested when the option is enabled. If permanently denied, allow the site in browser settings. Notification API requires a secure context, but modern browsers accept `localhost`.

Audio requires a user gesture. Select **Test** after opening Settings. Sound plays only for red alerts and respects the cooldown.

## Language

In **Settings > General**, select **Portuguese (Brazil)** or **English**. The value is persisted in the workspace SQLite database, returned by `GET /api/config`, and applied to Monitor, Settings, Tasks, Dashboard, Logs, dialogs, toasts, and system notifications. Dates and numbers use the matching locale. The preference is mirrored in `localStorage` to prevent a language flash during navigation.

## Theme

In **Settings > General**, choose **Dark** or **Light**. Dark is the default and preserves the original visual identity; Light uses a low-glare cool gray surface. The value is persisted in the workspace SQLite database and mirrored in `localStorage`. `public/theme.js` applies it before CSS across Monitor, Tasks, Dashboard, and Logs.

## External channels

In **Settings > Alert delivery**, add one or more destinations. Every item has an independent name, mode, switch, credentials, test button, and latest result. Active destinations receive the same event lifecycle simultaneously. Disabling one destination does not affect the others; enabling it again sends currently open alerts once.

With no saved destinations, the tab remains empty and shows only **Add destination**. No sample configuration is created automatically. The **Documentation** shortcut opens the public `docs/` directory on GitHub.

- **HTTP Webhook:** provide a URL and `POST`, `PUT`, or `PATCH`. Bearer and one custom header pair are optional.
- **WhatsApp (Evolution API):** provide base URL, instance name, API key, and a number with country and area codes. The dashboard uses `/message/sendText/{instanceName}`.
- **Discord:** provide the channel webhook URL and an optional display name.

Use **Send test** before enabling a destination. It must return HTTP 2xx within 10 seconds. Removing an item deletes its configuration on the next save; leaving a secret field blank preserves the saved value.

On failure, inspect the item result, process logs, DNS, destination certificate, and proxy/firewall rules. Every destination has independent deduplication, so one failed channel does not cause another to repeat accepted events.

## Backup

Back up the data directory or Docker volume:

```bash
docker run --rm -v n8n-monitor_n8n-monitor-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/n8n-monitor-backup.tgz -C /data .
```

The backup contains secrets. Encrypt it and restrict access.

## Diagnostics

```bash
npm run check
npm test
npm run diag -- ID
npm run dump -- WORKFLOW_ID
```

On Windows, the scripts use `N8N_API_KEY` from the environment or user registry. On Linux/macOS, export `N8N_API_KEY` and, when needed, `N8N_BASE_URL`. Their output applies the same automatic secret redaction as the dashboard.

| Symptom | Check |
|---|---|
| `HTTP 401/403` | API key, expiration, and permissions |
| `HTTP 404` | base URL without an extra path |
| timeout | DNS, proxy, firewall, and reachability from the host/container |
| lower counts | retention and the pagination limit shown in the UI |
| repeated webhook | write permission on the data directory |
| Kuma without uptime | unavailable metric and missing public slug |

## Login and workspaces

The dashboard blocks Monitor, Tasks, Dashboard, Logs, and the APIs without a session. `GET /api/health` stays public for the Coolify health check.

Public signup is disabled. The first user is created at `/setup`. Afterwards, in **Settings > Workspace**, an admin creates workspaces, registers users (optionally requiring a password change on first login), or generates a copyable invite link.

## Security

- The dashboard requires login; still prefer a VPN or proxy for remote access.
- Write endpoints only accept `Content-Type: application/json`, limit bodies to 1 MB, and reject browser origins that differ from the dashboard host.
- Configured URLs must use HTTP/HTTPS and cannot include embedded credentials. HTTP destinations cannot override reserved headers.
- Configuration, tasks, acknowledgements, and deduplication live in SQLite per workspace. The API does not disclose the host path.
- A task or acknowledgement is cleared only after its source responds and confirms the alert disappeared. n8n or Kuma unavailability is not recovery.
- HTTP and Discord webhook URLs, tokens, and keys are never returned by `GET /api/config`; an empty secret field preserves its saved value.
- Do not mount the data directory inside the repository.
- Immediately revoke any key exposed in logs or an issue.
- Review diagnostics before sharing, even with automatic redaction.
- Regularly update Node, the base image, and Uptime Kuma.

`compose.yaml` drops Linux capabilities, blocks privilege escalation, and uses a read-only filesystem except for the `/data` volume and `/tmp` tmpfs.
