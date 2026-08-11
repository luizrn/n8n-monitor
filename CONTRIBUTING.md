# Contribuindo

Obrigado por ajudar o n8n-monitor.

## Ambiente local

Requisitos: Node.js 20 ou 22 e Git. O projeto não possui dependências npm.

```bash
git clone https://github.com/luizrn/n8n-monitor.git
cd n8n-monitor
npm test
npm run check
npm start
```

Abra `http://127.0.0.1:8787`. Use credenciais de teste e nunca versione `config.json`, `.env` ou dumps de execução.

## Mudanças

1. Abra uma issue para alterações grandes ou incompatíveis.
2. Crie uma branch curta a partir de `main`.
3. Preserve a arquitetura sem build e sem dependências, salvo quando houver benefício técnico claro.
4. Inclua testes proporcionais ao risco e atualize a documentação pública.
5. Execute `npm test` e `npm run check` antes do pull request.

Use português claro nas telas e documentação. Código, identificadores e comentários devem seguir o estilo já existente. Não reformate arquivos sem relação com a mudança.

## Pull requests

Descreva problema, solução, impacto, compatibilidade e verificações executadas. Mudanças visuais devem incluir captura desktop e mobile. O envio de uma contribuição implica concordância com a licença MIT e o [Código de Conduta](CODE_OF_CONDUCT.md).

Para vulnerabilidades, siga [SECURITY.md](SECURITY.md), sem abrir issue pública.
