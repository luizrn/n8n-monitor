# Changelog

> **Portuguese version:** [Changelog](CHANGELOG.md)

All notable changes will be recorded here. The project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and will adopt semantic versioning with its first tag.

## Unreleased

### Added

- multiple n8n instances with source filters;
- Uptime Kuma integration, TLS, and domain expiration through RDAP;
- Tasks in List and Kanban views with automatic recovery;
- browser notifications, sound, and continuous delivery through HTTP Webhook, WhatsApp/Evolution API, or Discord;
- simultaneous external destinations with independent activation, testing, results, and deduplication;
- a complete Brazilian Portuguese and English interface selectable in Settings;
- complete technical and community documentation in Brazilian Portuguese and English;
- n8n/Kuma connection summary in the empty state and direct access from the n8n panel to Logs;
- Docker, Compose, and local automated tests;
- documentation and community files for the open source project.
- persistent selection between the default dark theme and a soft light theme.

### Changed

- atomic private persistence for every state file;
- automatic recovery now requires source confirmation;
- scrollbars aligned with light and dark themes;
- hardened Docker Compose with a read-only filesystem and minimal privileges.

### Security

- secret redaction in diagnostic URLs, messages, and stacks;
- HTTP/HTTPS validation, reserved-header blocking, and prototype-pollution protection;
- JSON-only write APIs with body limits, origin checks, and internal-detail-free errors;
- local paths and secret webhook URLs removed from configuration responses.
