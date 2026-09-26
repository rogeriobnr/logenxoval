# 17 — Plano de Deploy (Vercel + Neon, 100% gratuito)

## 17.1 Arquitetura de produção

- **Frontend (PWA)**: build Vite em `apps/pwa/dist` servido pelo Vercel no `https://logenxoval.vercel.app` (HTTPS obrigatório p/ service worker).
- **API (Fastify)**: função serverless `api/index.ts` (Vercel Node runtime, Hobby). Um único Fastify fica em cache entre invocações (`apps/server/src/serverlessApp.ts` via `app.inject`/light-my-request).
- **Banco**: PostgreSQL gerenciado **Neon** (tier gratuito, 0,5 GB, pausável). Conexão **pooled** (`-pooler.neon.tech`, porta 5432, SSL).
- **Migrations + seed** rodam no build do deploy (idempotentes): `migrate:cloud` e `seed:cloud`.

### Rotas `vercel.json`

| Origem | Destino |
| ------ | ------- |
| `/auth/:p*`, `/users/:p*`, `/deposits/:p*`, `/documents/:p*` | `/api` (função) |
| `/sync`, `/health` | `/api` (função) |
| demais (`/`, assets, sw.js, manifest) | estáticos do PWA |

A função recebe a URL original; o adaptador normaliza `req.url` (remove prefixo `/api`/`/api/index.ts` se o Vercel repassar).

## 17.2 Variáveis de ambiente

| Var | Onde | Nota |
| --- | ---- | ---- |
| `DATABASE_URL` | Neon pooled (`.neon.tech` + `-pooler`, `?sslmode=require`) | build + função |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | build + função |
| `SEED_ADMIN_MATRICULA` | ex. `ADMIN-001` | build |
| `SEED_ADMIN_SENHA` | senha do primeiro admin | build |
| `SEED_ADMIN_NOME` / `SEED_ADMIN_SOBRENOME` | opcionais | build |
| `GEMINI_API_KEY` | chave da API Google Gemini (gerada em aistudio.google.com/apikey) — **opcional** | função |
| `EMAIL_HOST` / `EMAIL_PORT` | SMTP (ex.: AWS SES ou qualquer gateway) — **opcional** | função |
| `EMAIL_USER` / `EMAIL_PASS` | credenciais SMTP — **opcional** | função |
| `EMAIL_FROM` | remetente exibido no e-mail de recuperação — **opcional** | função |
| `APP_URL` | base pública (ex.: `https://logenxoval.vercel.app`) usada no link de recuperação — **opcional** | função |

`vercel env add NOME VALOR production` para cada uma.

Sem `GEMINI_API_KEY`, a rota `POST /ocr/ai` responde `501 IA_NAO_CONFIGURADA` e o PWA cai
automaticamente para o reconhecimento local (Tesseract.js), com aviso no app.

Sem `EMAIL_*` (SMTP não configurado), `POST /auth/forgot-password` continua respondendo 200 e o
link de recuperação vai para o **log da função** (útil em dev); em produção, configurar `EMAIL_*`
para entrega real ao e-mail do usuário.

## 17.3 Fluxo do deploy (CLI)

```powershell
npx vercel login                      # ou token: vercel.com/account/tokens
$env:VERCEL_TOKEN = "…"               # se usar token, do terminal
npx vercel link --yes --project logenxoval
npx vercel env add DATABASE_URL  …  production
npx vercel env add JWT_SECRET     …  production
npx vercel env add SEED_ADMIN_MATRICULA … production
npx vercel env add SEED_ADMIN_SENHA     … production
npx vercel --prod
```

O build executa `build:cloud`:
`contracts → typecheck(server+api) → build(pwa) → migrate → seed`.

## 17.4 Limites do plano gratuito (o que vigiar)

- **Vercel Hobby**: 100 GB/h de funções/mês; função `maxDuration` 60 s; `*.vercel.app` sem custo.
- **Neon Free**: 0,5 GB de storage e 5 GB/10 h/mês de computação; pausa automática quando ocioso (primeiro acesso após pausa demora ~1–2 s e a Neon reaquece).
- Banco pausado + primeira requisição ⇒ latência extra; aceitável para uso de campo.

## 17.5 Ajustes necessários no Vercel (lições do deploy)

1. **Deployment Protection vinha LIGADO** (padrão novo do Vercel): sem desativar, todo o app (inclusive a API) retorna `401 Protected deployment` / `400` vazio. Desativar por API:

   ```powershell
   # body em arquivo (PowerShell distorce JSON inline no curl.exe)
   # sso-null.json  ->  {"ssoProtection": null}
   curl.exe -X PATCH https://api.vercel.com/v9/projects/logenxoval `
     -H "Authorization: Bearer $env:VERCEL_TOKEN" -H "content-type: application/json" `
     --data-binary "@sso-null.json"
   ```

2. **`req.body` não é confiável no runtime Rust do Vercel**: acessá-lo (é um getter interno) lança `Invalid JSON` mesmo com corpo válido. O adaptador `api/index.ts` lê o corpo **sempre do stream cru** (`for await (const chunk of req)`).

3. **Testar POST/JSON no Windows**: `curl.exe -d '{"a":1}'` vindo do PowerShell 5.1 **trunca/corrompe o JSON** (aspas são refeitas) e faz a API `400`/`Invalid JSON`. Usar `--data-binary "@arquivo.json"` ou um script `node` com `fetch`.

4. **Vercel anexa o grupo de captura do rewrite como query** (`/auth/login?path=login`) — inofensivo; o Fastify ignora query nas rotas.

## 17.6 Pós-deploy (verificação — executado e passando)

```
curl https://logenxoval.vercel.app/health                 # 200 {"status":"ok","db":true}
# login com corpo via arquivo (Windows):
curl -X POST https://logenxoval.vercel.app/auth/login -H "content-type: application/json" `
  -H "x-device-id: check1" --data-binary "@login.json"    # 200 → tokens
```

Teste de fumaça automatizado (`node` `fetch`) validado em produção:

| Fluxo | Resultado |
| ----- | --------- |
| `GET /health` | 200 `ok` + `db:true` |
| `POST /auth/login` (senha certa / errada) | 200 tokens / 401 `UNAUTHORIZED` |
| `GET /auth/me` (com e sem token) | 200 usuário / 401 |
| `POST /auth/refresh` | 200 novos tokens |
| `POST /deposits` criar + `GET /deposits` + `POST /:id/deactivate` | 200 (depósito criado e desativado) |
| Erros do Fastify (`VALIDATION_FAILED`, 404, 401) | passam íntegros pelo adaptador |
| `OPTIONS` preflight (origem `*.vercel.app`) | 204 + `access-control-allow-origin` |

Login criando depósito, importação, baixa offline + reconexão e multi-dispositivo → `docs/18-checklist-multi-dispositivo.md`.