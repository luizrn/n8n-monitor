# Contribuindo

> **English version:** [Contributing](CONTRIBUTING.en.md)

Obrigado por ajudar o n8n-monitor.

Agentes (Cursor, Codex e equivalentes) devem ler [`AGENTS.md`](AGENTS.md) **antes** de qualquer arquivo do repositório.

## Ambiente local

Requisitos: Node.js 22.5+ e Git. Após clonar, instale as dependências (`better-auth` em runtime; TypeScript e `tsx` em desenvolvimento).

```bash
git clone https://github.com/luizrn/n8n-monitor.git
cd n8n-monitor
npm install
npm test
npm run test:unit
npm run check
npm run dev
```

Abra `http://127.0.0.1:8787` e crie o primeiro usuário em `/setup`. Use credenciais de teste e nunca versione `n8n-monitor.sqlite`, `.env` ou dumps de execução.

## Mudanças

1. Abra uma issue para alterações grandes ou incompatíveis.
2. Crie uma branch curta a partir de `main`.
3. Preserve o servidor TypeScript, SQLite e as páginas HTML sem bundler de frontend, salvo quando houver benefício técnico claro.
4. Inclua testes proporcionais ao risco e atualize a documentação pública.
5. Execute `npm test` e `npm run check` antes do pull request. Suítes isoladas: `npm run test:unit`, `test:server`, `test:html`, `test:docs`. Um arquivo: `npm run test:file -- test/alertas.test.ts`. `npm run build` roda as suítes rápidas e em seguida o `tsc`.

Mantenha textos de interface e documentação pública em Português (Brasil) e inglês. Código, identificadores e comentários devem seguir o estilo já existente. Não reformate arquivos sem relação com a mudança.

## Pull requests

Descreva problema, solução, impacto, compatibilidade e verificações executadas. Mudanças visuais devem incluir captura desktop e mobile. O envio de uma contribuição implica concordância com a licença MIT e o [Código de Conduta](CODE_OF_CONDUCT.md).

Para vulnerabilidades, siga [SECURITY.md](SECURITY.md), sem abrir issue pública.
