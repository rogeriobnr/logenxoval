# 03 — Fluxo de Autenticação

## 3.1 Cadastro e perfis

- Campos obrigatórios: nome, sobrenome, matrícula, senha, perfil, status.
- `matricula` = ID único do usuário (`UNIQUE`).
- Perfis: `MECANICO`, `LIDER`, `ADMIN`.
- Senha servidor: `bcrypt`. Senha local: `PBKDF2` com salt por usuário (armazenada somente no IndexedDB do device autenticado — nunca em localStorage).
- Operações de criação de usuário e definição de perfil: apenas `ADMIN`.

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
- Ações administrativas críticas permitem ainda **senha/PIN adicional** (`settings.adminPinHash`).
- A matrícula digitada é hasheada e gravada em `assinaturaMatricula` no movimento/log.

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