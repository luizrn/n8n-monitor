# n8n-monitor 1.0.0

> **Portuguese:** [guia 1.0.0](README.md)

This folder describes the **1.0.0** line (Node `.mjs` process, JSON on disk, no login). Current `main` is **[2.0.0](../2.0/README.en.md)**.

- Release: [v1.0.0](https://github.com/luizrn/n8n-monitor/releases/tag/v1.0.0)
- Current README (2.0.0): [repository root](../../README.en.md)

## What 1.0.0 was

A unified n8n and Uptime Kuma dashboard with no user authentication. Anyone who could reach the port could use the panel. State lived in JSON files (`config.json`, `tarefas.json`, `reconhecimentos.json`, `webhook-estado.json`). One implicit environment per process.

## 1.0.0 features

| | Feature |
|---|---|
| 🚨 | Grouped alerts by instance, workflow, and node |
| ⏱️ | Stuck executions (timer and alert after 30 min) |
| 📅 | Schedule Trigger, Cron, and Interval auditing |
| 🏷️ | Multiple n8n instances |
| ✅ | Automatic resolution when the source confirms recovery |
| 📋 | Tasks in List and Kanban |
| 📊 | Dashboard (volume, failures, rate, median, p95) |
| 🔎 | Execution logs |
| 🔔 | Browser notifications |
| 🔊 | Sound on red alerts |
| 🪝 | HTTP webhook, WhatsApp/Evolution API, and Discord |
| 🟢 | Uptime Kuma (status, uptime, maintenance) |
| 🔐 | TLS certificate warnings |
| 🌐 | Domain expiration via RDAP |
| 🌍 | pt-BR and English UI |
| 🌓 | Light and dark themes |
| 🐳 | Docker and Compose |

It did not include: login, workspaces, SQLite, TypeScript in `src/`, first-run setup, or invites.

## Moving to 2.0.0

On the first 2.0.0 run, **setup** imports legacy JSON into the first workspace if those files exist in the data directory. Workspaces created later start empty. Guide: [docs/2.0](../2.0/README.en.md).
