# Autenticação

> **English:** [Authentication](autenticacao.en.md)

Better Auth com `emailAndPassword`. Verificação de e-mail desligada. Signup público desligado (`disableSignUp: true`). Plugins: `organization` (workspace) e `admin` (criar usuário por dentro).

## Primeiro acesso

Se não houver usuários, `/setup` cria o administrador (role admin), o primeiro workspace e importa JSON legado para esse workspace. Depois o setup fecha.

Campos: nome, e-mail, senha (mínimo 6), nome do workspace.

## Login

`POST /api/auth/sign-in/email` com `{ email, password }`. Sessão em cookie httpOnly, 14 dias, renovada a cada 24h de uso.

HTML sem cookie → redirect `/login`. APIs → `401`.

## Troca obrigatória de senha

Usuários criados com “trocar senha no primeiro login” (`mustChangePassword`) só acessam `/trocar-senha` e `POST /api/conta/senha` até trocarem.

## Cadastro interno

Em **Configurações > Workspace**, um admin/owner informa nome, e-mail, senha, papel (`admin` ou `member`) e o checkbox de troca no primeiro login. Não existe auto-cadastro público.

## Convite

Gera um convite Better Auth e um link copiável `/aceitar-convite?id=…` (sem SMTP). Quem abre o link define nome e senha e entra no workspace.

## Segredo de sessão

`BETTER_AUTH_SECRET` precisa ter 32+ caracteres em produção. Sem isso o processo recusa subir (`NODE_ENV=production`). Em desenvolvimento há um secret local padrão — não use em produção.
