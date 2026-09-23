# 12 — Plano de Segurança

## 12.1 Autenticação

- Senha **nunca** em texto puro. Servidor: `bcrypt` (cost 12). Device: PBKDF2-HMAC-SHA256 (salt por usuário) no IndexedDB.
- Senha **nunca** em localStorage/sessionStorage/document.cookie (IndexedDB apenas).
- JWT access curto (15 min) + refresh token opaco rotável, revogável por device (`sessions`).
- Uma sessão por `deviceId`; trocar usuário exige logout.
- Bloqueio por inatividade (default 15 min, configurável).
- `Authorization` + `X-Device-Id` em toda rota.
- Rate limiting por IP/matrícula (login, sync).

## 12.2 Autorização (nunca confiar só no local)

- Perfil no token; rotas checam permissão (ver matriz).
- `depositoId` validado contra os depósitos do usuário em **todas** as requisições.
- RLS no PostgreSQL: políticas por `depositoId` e autorização denegada por padrão.
- Operações críticas validam `matricula` no corpo (assinatura) — servidor confere que é o usuário logado e ativo.
- PIN administrativo (hash) para ações críticas de admin/líder quando configurado.
- Usuário bloqueado ⇒ revoga tokens + na sync o app local é bloqueado.

## 12.3 Transporte

- HTTPS obrigatório (Vercel/TLS).
- HSTS, CSP (com service worker/fonts/indexedDB permitidos), `X-Content-Type-Options`, `Referrer-Policy`, permissões de câmera/geolocation pedidas em runtime.

## 12.4 Dados

- Chat: segredos via variável de ambiente (`DATABASE_URL`, `JWT_SECRET`, `ADMIN_PIN`). Nunca no repositório.
- `.env*` no .gitignore; `.env.example` documentado.
- Dados sensíveis AES-GCM quando aplicável (ex.: senha não é armazenada, então hash é suficiente; observações/motivos sensíveis podem ser criptografados).
- Criptografia no repouso do banco (responsabilidade do provedor, documentado).

## 12.5 Integridade / Imutabilidade

- Logs imutáveis: novos apenas, `audit_logs` sem UPDATE/DELETE no banco (triggers de bloqueio).
- Cada log tem `hash` (sha256 do payload canônico) — opcional cadeia (hash do anterior) como tabela `auditChains` para auditoria avançada.
- `processedOperations` impede reexecução de `operationId` (proteção contra duplicidade).

## 12.6 Validação de entrada

- Zod em todas as rotas (contratos em `packages/contracts`, compartilhadado com PWA).
- Tiny-Int: quantidade >0; saldo pode ser negativo mas baixa no body é >0.
- Sanitização de HTML nos textos de observação/motivo.
- Limites de tamanho de upload (ex.: 20 MB), validação de tipo MIME.

## 12.7 Sessão/device

- `X-Device-Id` (UUID por instalação) permite revogar sessão por device.
- Não guardar token em cluster compartilhado; IndexedDB é isolado por origin.

## 12.8 Backup seguro

- Backup criptografado (gzip + AES) antes de sair do servidor; restauração requer chave.
- Backup do dispositivo: export local (JSON criptografado com chave derivada da senha do usuário) + instrução de armazenar a chave.

## 12.9 Checklist de lançamento

- [ ] HTTPS ativo e redirecionando HTTP→HTTPS
- [ ] `.env` nunca versionado
- [ ] RLS ativado e testado em produção
- [ ] Rate limit ativo
- [ ] Cabeçalhos de segurança aplicados
- [ ] Testes de permissão dos 3 perfis passando
- [ ] RevoG de token em logout/bloqueio testado
- [ ] Aviso de autenticação offline visível na tela de login