# Authentication

> **Portuguese:** [Autenticação](autenticacao.md)

Better Auth with `emailAndPassword`. Email verification is off. Public signup is off (`disableSignUp: true`). Plugins: `organization` (workspace) and `admin` (create users from inside the app).

## First access

If there are no users, `/setup` creates the administrator (admin role), the first workspace, and imports legacy JSON into that workspace. Setup then closes.

Fields: name, email, password (min 6), workspace name.

## Login

`POST /api/auth/sign-in/email` with `{ email, password }`. Session is an httpOnly cookie, 14 days, refreshed every 24 hours of use.

HTML without a cookie → redirect `/login`. APIs → `401`.

## Forced password change

Users created with “change password on first login” (`mustChangePassword`) can only reach `/trocar-senha` and `POST /api/conta/senha` until they change it.

## Internal registration

In **Settings > Workspace**, an admin/owner provides name, email, password, role (`admin` or `member`), and the first-login password-change checkbox. There is no public self-signup.

## Invite

Creates a Better Auth invitation and a copyable `/aceitar-convite?id=…` link (no SMTP). The recipient sets name and password and joins the workspace.

## Session secret

`BETTER_AUTH_SECRET` must be 32+ characters in production. Without it the process refuses to start (`NODE_ENV=production`). Development has a built-in local secret — do not use it in production.
