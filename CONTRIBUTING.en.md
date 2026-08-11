# Contributing

> **Portuguese version:** [Contribuindo](CONTRIBUTING.md)

Thank you for helping n8n-monitor.

## Local environment

Requirements: Node.js 20 or 22 and Git. The project has no npm dependencies.

```bash
git clone https://github.com/luizrn/n8n-monitor.git
cd n8n-monitor
npm test
npm run check
npm start
```

Open `http://127.0.0.1:8787`. Use test credentials and never commit `config.json`, `.env`, or execution dumps.

## Changes

1. Open an issue for large or incompatible changes.
2. Create a short-lived branch from `main`.
3. Preserve the dependency-free, no-build architecture unless there is a clear technical benefit.
4. Add tests proportional to the risk and update public documentation.
5. Run `npm test` and `npm run check` before the pull request.

Keep UI text and public documentation in Brazilian Portuguese and English. Code, identifiers, and comments should follow the existing style. Do not reformat unrelated files.

## Pull requests

Describe the problem, solution, impact, compatibility, and verification performed. Visual changes should include desktop and mobile screenshots. Submitting a contribution means accepting the MIT license and the [Code of Conduct](CODE_OF_CONDUCT.en.md).

For vulnerabilities, follow [SECURITY.en.md](SECURITY.en.md) instead of opening a public issue.
