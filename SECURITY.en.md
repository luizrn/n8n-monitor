# Security policy

> **Portuguese version:** [Política de segurança](SECURITY.md)

## Supported versions

The project publishes version **2.0.0**. The `main` branch and that tag are the supported versions.

## Reporting a vulnerability

Do not open a public issue with vulnerability details. Use **Security > Report a vulnerability** on GitHub to create a private report.

When possible, include:

- affected version, commit, and environment;
- minimal reproduction steps;
- observed or potential impact;
- a suggested fix, if available.

The maintainer will acknowledge the report within seven days. Accepted fixes will be prepared privately and disclosed after a corrected version is available.

## Sensitive data

Monitor accesses n8n keys, Uptime Kuma keys, and external delivery credentials. Never include these values, the SQLite database, real configuration files, or unreviewed diagnostics in a public report.
