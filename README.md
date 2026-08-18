# n8n-monitor

> **English version:** [Read the project README in English.](README.en.md)

**Versão 2.0.0** (esta árvore). Linha anterior: [guia 1.0.0](docs/1.0/README.md) · [release v1.0.0](https://github.com/luizrn/n8n-monitor/releases/tag/v1.0.0).

[![MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![versão](https://img.shields.io/badge/versão-2.0.0-0ea5e9.svg)](docs/2.0/README.md)
[![Node 22+](https://img.shields.io/badge/node-22.5%2B-339933.svg)](https://nodejs.org/)

<img width="1902" height="909" alt="Monitor" src="https://github.com/user-attachments/assets/8d1e59fd-54e7-403b-a248-81fa63ee8441" />
<img width="1896" height="859" alt="Configurações" src="https://github.com/user-attachments/assets/40069a6b-ef2a-4ff4-9a1b-e2b1ba51e54a" />
<img width="1895" height="909" alt="Tarefas" src="https://github.com/user-attachments/assets/7175d343-5360-4abb-a34f-8fe6a446b5f7" />
<img width="1879" height="840" alt="Dashboard" src="https://github.com/user-attachments/assets/3142981c-b122-444a-b7ad-a999254a364b" />
<img width="1014" height="459" alt="Login" src="https://github.com/user-attachments/assets/78d50c58-c4d1-4407-bf48-b76f4e0cba2b" />

**Monitor unificado para n8n + Uptime Kuma.**

O projeto reúne em uma única interface a saúde das automações e a disponibilidade dos serviços. No n8n, detecta erros, execuções travadas e agendamentos perdidos em múltiplas instâncias. No Uptime Kuma, acompanha monitores online e offline, manutenção, tempo de resposta, uptime, certificados TLS e expiração de domínios. Os incidentes das duas fontes aparecem no mesmo Monitor e podem ser tratados em uma fila de Tarefas.

Servidor TypeScript (Node.js 22.5+), HTTP nativo, SQLite, Better Auth e páginas HTML sem bundler. Login obrigatório, workspaces isolados e signup público desligado.

## Funcionalidades

### Plataforma 2.0.0

| | Recurso | Como funciona |
|---|---|---|
| 🔐 | Login | Better Auth com e-mail e senha; cookie httpOnly; signup público desligado. |
| 🧭 | Setup inicial | Primeiro acesso em `/setup` cria administrador e o primeiro workspace. |
| 🔑 | Troca de senha | Cadastro interno pode exigir nova senha no primeiro login (`mustChangePassword`). |
| 🏢 | Workspaces | Cada organization isola instâncias, Kuma, destinos, tarefas e cache. Workspace novo nasce vazio. |
| 👤 | Usuários e papéis | Owner/admin cadastram membros; member usa o painel do workspace ativo. |
| ✉️ | Convites | Link copiável (sem SMTP); aceite em `/aceitar-convite`. |
| 💾 | SQLite | Fonte da verdade em `n8n-monitor.sqlite`; JSON antigo só no import do primeiro setup. |
| 🧱 | TypeScript | Código em `src/`, build `tsc` → `dist/`, ESM. |
| 🌐 | HTTP nativo | `node:http`, sem Express/Fastify. |
| ❤️ | Health check | `GET /api/health` público, sem segredos, com `versao` (Coolify e equivalentes). |
| 🛡️ | Segredos na API | `GET /api/config` não devolve chave, token nem URL secreta; campo vazio no POST mantém o valor. |
| 🐳 | Docker | Node 22 Alpine, volume `/data`, Compose em `127.0.0.1:8787`. |
| 🧪 | Testes | `node:test`: unit, HTTP+auth, HTML/i18n e pares de documentação pt/en. |

### n8n

| | Recurso | Como funciona |
|---|---|---|
| 🚨 | Alertas agrupados | Falhas repetidas por instância, workflow e nó, com magnitude e diagnóstico. |
| ⏱️ | Execuções travadas | Cronômetro ao vivo e alerta amarelo após 30 minutos. |
| 📅 | Auditoria de agendamentos | Compara Schedule Trigger, Cron e Interval com as execuções retidas pelo n8n. |
| 🏷️ | Múltiplas instâncias | Configuração, cache, links, tags e filtros isolados por instância. |
| ✅ | Resolução automática | Remove o alerta só quando uma execução posterior comprova recuperação. Sem falso positivo se a fonte sumir. |
| 📊 | Dashboard | Volume, falhas, taxa de erro, mediana e p95 até sete dias. |
| 🔎 | Logs | Busca por status, modo, período e instância; Detalhes no bloco N8N. |

### Uptime Kuma

| | Recurso | Como funciona |
|---|---|---|
| 🟢 | Monitores | Status, resposta, uptime, manutenção, pausa e seleção do que entra no Monitor. |
| 🔐 | TLS | Certificado próximo do vencimento, expirado ou inválido. |
| 🌐 | Domínios | Expiração via RDAP; TLD sem fonte confiável fica sem prazo. |

### Operação e alertas

| | Recurso | Como funciona |
|---|---|---|
| 📋 | Tarefas | Lista e Kanban com seis estados, notas e histórico. **Em análise** tira do Monitor. |
| 🔔 | Navegador | Notifica mudanças amarelas e vermelhas com o Monitor em segundo plano. |
| 🔊 | Som | Só em vermelho; volume, teste e cooldown anti-spam. |
| 🪝 | Canais externos | Vários destinos simultâneos: Webhook HTTP, WhatsApp/Evolution API e Discord (`opened`, `worsened`, `resolved`). |
| 🌍 | Idioma | Português (Brasil) e inglês em todas as telas, toasts e notificações. |
| 🌓 | Temas | Escuro padrão e claro suave, persistidos no workspace. |

## Início rápido

### Node.js

```bash
git clone https://github.com/luizrn/n8n-monitor.git
cd n8n-monitor
npm install
npm run build
npm start
```

Abra `http://127.0.0.1:8787`. Sem usuários, o painel leva a `/setup`. Depois entre em **Configurações**, adicione instâncias n8n e, se quiser, o Uptime Kuma (URL e API key).

### Docker Compose

```bash
docker compose up -d --build
docker compose ps
```

O Compose publica somente `127.0.0.1:8787` e guarda SQLite e estado no volume `n8n-monitor-data`. Em produção defina `BETTER_AUTH_SECRET` (32+ caracteres) e `BETTER_AUTH_URL` (URL pública deste painel, não a de outro ambiente).

```bash
docker compose logs -f monitor
docker compose down                 # preserva o volume
docker compose down --volumes       # remove também os dados persistidos
```

O painel exige login. Ainda assim, prefira VPN ou proxy quando o acesso for remoto.

## Configuração

Abas no Monitor:

- **Geral:** idioma e tema, persistidos no workspace.
- **Instâncias n8n:** nome, URL, API key, ativação e teste individual.
- **Notificações:** toast de 0 a 600 s, navegador, som e volume.
- **Uptime Kuma:** URL, API key, slug público opcional, antecedência TLS/domínio e seleção de monitores.
- **Envio de alertas:** destinos Webhook HTTP, WhatsApp/Evolution API e Discord.
- **Workspace:** nome do workspace ativo, criar workspaces, cadastrar usuários e gerar convite copiável.

A aba **Envio de alertas** começa vazia até **Adicionar destino**. **Documentação** abre os guias no GitHub.

Campos secretos chegam vazios ao navegador. Deixá-los vazios ao salvar preserva o valor atual.

| Variável | Padrão | Uso |
|---|---|---|
| `HOST` | `127.0.0.1` | Interface de rede do servidor. |
| `PORT` | `8787` | Porta HTTP. |
| `N8N_MONITOR_DATA_DIR` | diretório do usuário | Local do SQLite (e JSON legado, se houver). |
| `BETTER_AUTH_SECRET` | gerado em desenvolvimento | Segredo de sessão (obrigatório em produção, 32+). |
| `BETTER_AUTH_URL` | inferido do pedido | URL pública do painel, ex. `https://monitor.exemplo.com`. |
| `N8N_BASE_URL` | `http://localhost:5678` | Semeia a primeira instância só no import/setup inicial. |
| `N8N_API_KEY` | vazio | Semeia a chave só no import/setup inicial. |

Dados: `%LOCALAPPDATA%\n8n-monitor` no Windows, `$HOME/n8n-monitor` nos demais, `/data` no Docker. Arquivo: `n8n-monitor.sqlite`. Lista completa: [docs/2.0/variaveis.md](docs/2.0/variaveis.md).

## Rotas

| Rota | Tela |
|---|---|
| `/setup` | Primeiro usuário e workspace |
| `/login` | Entrar |
| `/aceitar-convite` | Aceitar convite |
| `/trocar-senha` | Senha obrigatória |
| `/` | Monitor e Configurações |
| `/tarefas` | Lista e Kanban |
| `/dashboard` | Métricas históricas |
| `/logs` | Busca de execuções |
| `/api/health` | Health check público |

## Semântica dos alertas

Cada problema tem uma chave estável. Toast, notificação e som disparam uma vez enquanto a chave estiver ativa. Recuperação só com confirmação da fonte. **Em análise** move para Tarefas; **Resolvido** reconhece a magnitude atual.

Cada destino externo tem máquina de estados própria (`opened`, `worsened`, `resolved`). Schema: [docs/arquitetura.md](docs/arquitetura.md).

### Cores por severidade

| | Severidade | Escuro | Claro | Token | Usada em |
|---|---|---|---|---|---|
| 🟥 | Erro | `#f0745c` | `#bd4337` | `--ruim` | instância inalcançável, erro de execução, monitor DOWN, TLS ou domínio expirado |
| 🟨 | Atenção | `#e8bc4e` | `#946307` | `--atencao` | execução travada, agendamento perdido, monitor PENDING, TLS ou domínio perto do limite |
| 🟩 | Tudo ok | `#5cbd8a` | `#287a54` | `--bom` | nenhum alerta ativo, instância alcançável, monitor UP |
| 🟦 | Informativo | `#6fa8f5` | `#2869b6` | `--calmo` | contagens neutras e barras de volume |

Os alertas usam só dois níveis: `ruim` e `atencao`. Verde e azul são estados da interface, não severidades. Os pontos de série temporal têm variantes de maior saturação (`--pontoRuim`, `--pontoAtencao`, `--pontoBom`). Definições em [public/base.css](public/base.css); o som toca somente para vermelho.

## Desenvolvimento

```bash
npm test                 # todas as suítes
npm run test:unit        # sem HTTP
npm run test:server      # login, workspaces, APIs
npm run test:html        # páginas + i18n
npm run test:docs        # pares pt/en
npm run check
npm run build            # testes rápidos + tsc
npm start
```

Veja [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) e [CHANGELOG.md](CHANGELOG.md).

## Documentação

- [Guia 2.0.0](docs/2.0/README.md): login, workspaces, SQLite, TypeScript e variáveis.
- [Guia 1.0.0](docs/1.0/README.md) e [release v1.0.0](https://github.com/luizrn/n8n-monitor/releases/tag/v1.0.0).
- [AGENTS.md](AGENTS.md): regras para quem altera o código.
- [Arquitetura](docs/arquitetura.md), [Decisões](docs/decisoes.md), [Operação](docs/operacao.md).

## Licença

[MIT](LICENSE) © 2026 Luiz Fernando Riva Nekel.
