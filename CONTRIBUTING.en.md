# Contributing

> **Portuguese version:** [Contribuindo](CONTRIBUTING.md)

Thank you for helping n8n-monitor.

Agents (Cursor, Codex, and similar) must read [`AGENTS.md`](AGENTS.md) **before** any other file in this repository.

## Local environment

Requirements: Node.js 22.5+ and Git. After cloning, install dependencies (`better-auth` at runtime; TypeScript and `tsx` in development).

```bash
git clone https://github.com/luizrn/n8n-monitor.git
cd n8n-monitor
npm install
npm test
npm run test:unit
npm run check
npm run dev
```

Open `http://127.0.0.1:8787` and create the first user at `/setup`. Use test credentials and never commit `n8n-monitor.sqlite`, `.env`, or execution dumps.

## Changes

1. Open an issue for large or incompatible changes.
2. Create a short-lived branch from `main`.
3. Preserve the TypeScript server, SQLite, and HTML pages without a frontend bundler unless there is a clear technical benefit.
4. Add tests proportional to the risk and update public documentation.
5. Run `npm test` and `npm run check` before the pull request. Isolated suites: `npm run test:unit`, `test:server`, `test:html`, `test:docs`. One file: `npm run test:file -- test/alertas.test.ts`. `npm run build` runs the fast suites and then `tsc`.

Keep UI text and public documentation in Brazilian Portuguese and English. Code, identifiers, and comments should follow the existing style. Do not reformat unrelated files.

## Pull requests

Describe the problem, solution, impact, compatibility, and verification performed. Visual changes should include desktop and mobile screenshots. Submitting a contribution means accepting the MIT license and the [Code of Conduct](CODE_OF_CONDUCT.en.md).

For vulnerabilities, follow [SECURITY.en.md](SECURITY.en.md) instead of opening a public issue.
