# Design decisions

> **Portuguese version:** [Decisões de projeto](decisoes.md)

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

## Secrets never return to the client

Empty password fields mean "keep the current value." Diagnostics recursively redact names associated with tokens, passwords, cookies, authorization, and credentials. External channels receive only the public alert contract.

## Kuma uses public interfaces

The project remains dependency-free. Integration uses Prometheus with an API key and public status pages as fallback. Internal Socket.IO is intentionally avoided because it is implementation-coupled and would require an external library.

## Domains require verifiable RDAP

The resolver uses IANA's DNS bootstrap and walks the monitor hostname until it finds the registered domain. Results are cached for 24 hours. A missing endpoint or expiration date is unknown, not a failure.

## Docker does not imply public exposure

The process listens on `0.0.0.0` inside the container for port mapping, while Compose publishes on `127.0.0.1`. The dashboard has no built-in login and must stay behind a VPN or authenticated proxy.
