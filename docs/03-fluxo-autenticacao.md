# 03 — Fluxo de Autenticação

## 3.1 Cadastro e perfis

- Campos obrigatórios: nome, sobrenome, matrícula, **e-mail**, senha, **PIN** (4–6 dígitos), perfil, status.
- `matricula` = ID único do usuário (`UNIQUE`); `email` também é `UNIQUE` (informado no cadastro e usado só para recuperação de senha — o login continua por matrícula).
- Perfis: `MECANICO`, `LIDER`, `ADMIN`.
- Senha servidor: `bcrypt`. Senha local: `PBKDF2` com salt por usuário (armazenada somente no IndexedDB do device autenticado — nunca em localStorage).
- Cadastro público (`POST /auth/register`, sem token) nasce `PENDENTE` e só é liberado após aprovação do admin; usuário escolhe o próprio PIN no cadastro.
- `ADMIN` pode criar usuários de qualquer perfil e redefinir o PIN de qualquer usuário. `LIDER` pode criar `MECANICO`/`LIDER` e ver a listagem de não-admins (sem o painel administrativo).

## 3.2 Sessão única por dispositivo

- Uma sessão por `deviceId` (`sessions.deviceId` UNIQUE).
- Trocar de usuário ⇒ **logout** do atual, **nunca** login simultâneo.
- `deviceId` é gerado no primeiro acesso (UUID persistido no IndexedDB).

## 3.3 Login online

```
1. Usuário informa matrícula + senha.
2. Servidor valida (bcrypt) e retorna accessToken (JWT, curto) + refreshToken.
3. Cliente deriva PBKDF2 local (salt retornado) p/ autenticação offline futura.
4. Cria sessions no servidor e sessions local (tokenHash).
5. Registra audit log LOGIN.
```

## 3.4 Login offline (primeira vez jamais offline)

- Primeiro login **exige** rede (para validar credenciais no servidor).
- Depois, com sessão local válida (token local não expirado + PBKDF2 hash), o login funciona offline.
- **Aviso claro na UI**: *"Autenticação offline limitada a este dispositivo. A confirmação definitiva ocorre na sincronização com o servidor."*
- Usuário bloqueado no servidor ⇒ na próxima sync, o token é revogado e o app bloqueia localmente.

## 3.5 Bloqueio automático por inatividade

- `lastActivityAt` atualizado a cada interação (gestos/teclado).
- Sem atividade por `X` min (configurável em settings, default 15 min) ⇒ sessão encerrada, volta para tela de login.
- Refresh/expiração de token online; no offline, bloqueio apenas local.

## 3.6 Confirmação crítica

- Operações críticas (baixa, publicação de versão, restauração, conversão, estorno, correção, edição de depósito) exigem **digitação da própria matrícula**.
- Essas ações exigem ainda o **PIN do próprio usuário logado** quando ele tiver PIN definido (`users.pin_hash`). Não há PIN global: cada usuário tem o seu (definido no cadastro, trocado em Configurações → Meu PIN ou redefinido pelo admin na tela Usuários).
- A matrícula digitada é hasheada e gravada em `assinaturaMatricula` no movimento/log.

## 3.7 Recuperação de senha

- `POST /auth/forgot-password` com o e-mail cadastrado; a resposta é sempre 200 (não revela se a conta existe).
- Se o e-mail existe, o servidor cria um token de uso único (hash SHA-256 em `password_resets`, expira em 30 min) e envia o link `${APP_URL}/?recuperar=<token>` por e-mail (**SMTP via env** `EMAIL_HOST`/`EMAIL_USER`/`EMAIL_PASS`; sem SMTP configurado, o link vai para o log do servidor, útil em dev).
- `POST /auth/reset-password` com `{ token, novaSenha }` redefine a senha (bcrypt), revoga sessões do usuário e o token não pode ser reutilizado.
- O PWA detecta `?recuperar=` na URL e mostra a tela de redefinição sem login.

## 3.7 Matriz de validação offline x servidor

| Verificação      | Local (device) | Servidor (sync) |
| ---------------- | -------------- | --------------- |
| Senha            | PBKDF2 hash local | bcrypt    |
| Perfil/permissão | tabela local (espelho) | **obrigatório** |
| Bloqueio         | status local espelhado | revoga token |
| Depósito autorizado | lista local | RLS + request validation |
| Matrícula confirmação | formato válido | verificação em operações críticas |

## 3.8 Logs

- `LOGIN`, `LOGOUT`, `BLOQUEIO_INATIVIDADE`, `TROCA_USUARIO` registrados em audit_logs.