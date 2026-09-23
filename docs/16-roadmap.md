# 16 — Roadmap por Fases (Desenvolvimento e Versionamento)

## Hosting definitivo (decidido)

- **GitHub**: repositório (você autentica `gh auth login`; eu commit por fase).
- **Vercel**: app PWA (static) + API (Fastify serverless) no mesmo projeto/monorepo, com seu domínio. **O servidor roda na nuvem da Vercel — seu notebook desligado não afeta nada.**
- **PostgreSQL**: postgres **gerenciado** na nuvem (Supabase ou Neon) com `DATABASE_URL` de pool (connection pooling) + RLS. Local: Docker na porta 5433.

## Estratégia git/github

- Repositório `main` (branch única de desenvolvimento), commits **convencionais por fase**:
  `feat(phase01): auth, users e depósitos` — mensagens claras para você acompanhar.
- One commit por fase + tags `v0.1.0 … v0.13.0`.
- Push para GitHub ao final de cada fase (quando `gh` autenticado).
- Deploy automático Vercel no push de `main`.

## Sequência de desenvolvimento (13 fases)

| Fase | Escopo | Commit sug. | Status |
| ---- | ------ | ----------- | ------ |
| 01 | Autenticação, usuários e depósitos (servidor + PWA) | `feat(phase01): auth, users e depósitos` | ✅ |
| 02 | Banco local (IndexedDB) e modo offline | `feat(phase02): banco local e modo offline` | ✅ |
| 03 | Cadastro e consulta do enxoval | `feat(phase03): enxoval` | ✅ |
| 04 | Baixa e Goldbox | `feat(phase04): baixa e goldbox` | ⏳ |
| 05 | Fila de sincronização | `feat(phase05): fila de sincronização` | ⏳ |
| 06 | Conferência física | `feat(phase06): conferência física` | ⏳ |
| 07 | Correções e peças avulsas | `feat(phase07): correções e peças avulsas` | ⏳ |
| 08 | Logs e calendário | `feat(phase08): logs e calendário` | ⏳ |
| 09 | Atualização por foto/PDF/OCR | `feat(phase09): ocr` | ⏳ |
| 10 | Consumíveis e EPIs | `feat(phase10): consumíveis e EPIs` | ⏳ |
| 11 | Relatórios PDF/PNG | `feat(phase11): relatórios` | ⏳ |
| 12 | Espelhos e restauração | `feat(phase12): espelhos e restauração` | ⏳ |
| 13 | Testes multi-dispositivo + deploy (GitHub/Vercel/domínio) | `feat(phase13): testes e deploy` | ⏳ |

## Critério de aceite de cada fase

A **regra de ouro**: *toda movimentação de estoque possui depósito, usuário (matrícula), data/hora, quantidade e registro de auditoria.* Fase não avança sem isso testado.

## Monorepo (visão)

```
#
#chcagemEnxoval/
├─ apps/
│  ├─ pwa/        # React+Vite+TS (Vercel)
│  └─ server/     # Fastify+TS (Vercel serverless / standalone)
├─ packages/
│  └─ contracts/  # tipos + Zod compartilhados
├─ docs/          # esta documentação (16 entregáveis)
├─ docker-compose.yml   # postgres local
└─ package.json   # npm workspaces
```