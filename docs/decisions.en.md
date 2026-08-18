# Design decisions

> **Portuguese version:** [Decisões de projeto](decisoes.md)

Version **2.0.0**. 1.0.0 line: [docs/1.0](1.0/README.en.md) · [release](https://github.com/luizrn/n8n-monitor/releases/tag/v1.0.0).

## Reliability before volume

The absence of a retained execution does not prove that a schedule failed. The comparator evaluates only periods covered by real data and reports `no-data` when retention cannot support a conclusion.

An offline instance does not produce zeroes either. It creates a red alert with its name and reason while collection continues for other instances.

## Identity includes the instance

Workflow and execution IDs may repeat across servers. Keys, caches, diagnostics, and links include `instanciaId`, keeping workflows with the same name isolated.

## Anti-spam follows the problem lifecycle

Polling is not an event. Toasts, browser notifications, and sound use the problem's stable key persisted in `localStorage`:

- a new key notifies once;
- the same active key remains silent, including magnitude increases;
- an absent key releases deduplication;
- a key that returns after disappearing may notify again.

Closing a toast or reloading the page does not clear deduplication. Sound also has a global eight-second cooldown. System notifications are silent because audio is controlled separately.

Each external destination has its own persisted server state and preserves worsened events based on severity or magnitude. Webhook, WhatsApp, and Discord can therefore run simultaneously without one channel's failure or deduplication affecting another.

## Under analysis moves instead of hiding

Acknowledgement without a queue would remove work from the operator's routine. **Under analysis** removes the alert from Monitor and creates a task with history. Confirmed recovery moves the task to Resolved. A recurrence returns to Monitor and reuses the task only after another human action.

## Collection belongs to the server

External delivery must work without a browser. The process collects continuously while screens only read snapshots. This also prevents multiple tabs from multiplying n8n API traffic.

## Responses never wait on collection

One workspace pointing at a slow n8n contaminated every other one: the `GET /api/state` response had no deadline, the browser exhausted its six connections per origin, and the dashboard froze. Three rules prevent that:

- **Every wait has a deadline.** The response gives up on the collection after 20s and returns the previous snapshot; the collection keeps running in the background.
- **A stale cache beats a wait.** Schedules are served from the last result while a fresh sweep runs alongside. Only an instance's very first sweep blocks, and even then within a 15s budget.
- **Immutable work is not repeated.** The detail of a failed execution cannot change once it has finished, so it is cached by `executionId`. Previously ten full execution payloads were downloaded every cycle — making the workspace with the most errors the slowest one.

## Collection follows usage

The collector must run without a browser for webhooks to work, but it does not need the same cadence for everyone. A workspace touched in the last 5 minutes is collected every 15s; the rest every 60s. Alerts stay alive in all of them, and continuous load on the n8n API drops in proportion to the number of idle workspaces.

## Secrets never return to the client

Empty password fields mean "keep the current value." Diagnostics recursively redact names associated with tokens, passwords, cookies, authorization, and credentials. External channels receive only the public alert contract.

## Kuma uses public interfaces

Kuma integration uses Prometheus with an API key and public status pages as fallback. Internal Socket.IO is intentionally avoided because it is implementation-coupled and would require another library. Better Auth is the intentional runtime dependency.

## Domains require verifiable RDAP

The resolver uses IANA's DNS bootstrap and walks the monitor hostname until it finds the registered domain. Results are cached for 24 hours. A missing endpoint or expiration date is unknown, not a failure.

## Login and per-workspace isolation

Every administrative screen requires a session. Better Auth covers email/password, organizations as workspaces, and the admin plugin for internal user creation. Public signup stays off; the first user is created at `/setup`. Configuration, tasks, and the collector are keyed by `organization_id`.

## Docker does not imply public exposure

The process listens on `0.0.0.0` inside the container for port mapping, while Compose publishes on `127.0.0.1`. The dashboard requires login (Better Auth, isolated workspaces); still prefer a VPN or proxy for remote access.

## The stuck-execution limit is per workflow, not global

There is a default limit (30 min) and per-workflow exceptions stored as `"<instanciaId>|<workflowId>" -> minutes`. The server resolves the limit for each execution and returns `limiteMin` with it; the dashboard, toasts, and delivery destinations all use that same number.

**Why:** `Base CX - Contrato BI` takes ~42 minutes on every run — 41.4 to 42.4 min across seven consecutive runs — and finishes successfully. A single 30-minute limit flagged it as stuck every time. Acknowledging in the UI did not help: the alert key includes the execution id, so each new run created a new alert.

An alert that fires in the same place every day with nothing wrong is worse than no alert — it trains the team to ignore the whole dashboard, including when it is right. That is the same reason we group errors by cause and why the toast only appears when something changes.

The key joins instance and workflow because n8n workflow ids are local to the instance: without the prefix, an exception for one workflow would silence a namesake with the same id on another instance.

## Saving poorly is better than not saving

Configuration writes to a temporary file and renames it so a half-written file never remains. When `rename` fails, it falls back to a direct write.

**Why:** on some Windows environments — redirected folders, cloud sync, antivirus — `rename` fails with `EXDEV` even when source and destination are in the same directory. The UI response came from memory and looked saved while disk kept the old value. The loss only showed up on the next restart.

SQLite is now the source of truth for workspace config; the same idea applies if a write is interrupted. Direct write has a window where a crash could leave an incomplete file. That risk is smaller than silently losing configuration.

