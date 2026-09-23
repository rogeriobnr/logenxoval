# 01 — Arquitetura Geral

## 1. Visão

```
┌────────────────────────────── CELULAR (PWA) ──────────────────────────────┐
│  React UI ──→ Domain/Stores (Zustand) ──→ Services ──→ Repositories      │
│                                                    │                      │
│                         IndexedDB (Dexie) ──────────┘                     │
│                         Service Worker (Workbox)                          │
│                         SyncEngine (fila + conflito)                      │
│                         Tesseract.js (OCR local)                          │
│                         Relatório local (jsPDF/canvas)                    │
└───────────────────────────────────────────────────────────────────────────┘
                                   │ HTTPS + JWT
                                   ▼
┌────────────────────────────── SERVIDOR ──────────────────────────────────┐
│  Fastify API ──→ Middleware auth/perfil → Rota → UseCase → Repository    │
│                     │                                                    │
│                     ├── PostgreSQL (RLS por depositoId, transactions)    │
│                     ├── sync engine (idempotência por operationId)       │
│                     └── processedOperations (log de processamento)       │
└───────────────────────────────────────────────────────────────────────────┘
```

## 2. Princípios

1. **Offline-first**: toda operação é gravada no IndexedDB e registrada no dispositivo primeiro; o servidor **nunca** é requisito para operar.
2. **Depósito é a unidade de isolamento**: todo registro de estoque carrega `depositoId`; o servidor valida em **todas** as requisições e via RLS no PostgreSQL.
3. **Idempotência**: cada operação tem `operationId` UUID gerado no device; o servidor registra em `processedOperations` e nunca aplica duas vezes.
4. **Imutabilidade**: logs, correções, versões e conferências finais nunca são apagados; correções criam operações inversas.
5. **Saldo pode ser negativo**: sistema registra o fato e gera divergência, nunca bloqueia a operação.
6. **Autenticação local + autorização central**: login offline validado contra hash local restrito ao device; a confirmação definitiva acontece na sincronização (senha/hash validados no servidor).

## 3. Camadas do PWA

```
UI (telas React) ─→ Stores (estado) ─→ Services (baixa, conferencia, ocr, sync)
                                       │
                            Repositories (Dexie / HTTP)  ← a "porta de dados"
                                       │
                     IndexedDB      HTTP Client (fetch com token)
```

- **Repositories**: única camada que toca IndexedDB ou a API. Regras de negócio ficam nos Services (UseCases).
- **SyncEngine**: consome a fila `syncQueue` e envia operações ao servidor via `POST /sync` (lote), aplicando resposta idempotente.
- **AuthService**: senha com hash (PBKDF2/session local), sessão única por device, bloqueio por inatividade, troca de usuário exige logout.

## 4. Processo de sincronização (resumo)

```
Enviar fila → servidor valida auth/perfil/depósito → processa por operationId
             (persiste em processedOperations) → retorna acks/erros/novos dados
Baixar delta → server revision tracking (updatedAt/version) → aplica no IndexedDB
Recalcular saldos → avaliar divergências/notificações
```

Detalhe em [07-sincronizacao](07-sincronizacao.md).

## 5. Módulos do domínio

- **Identidade**: users, sessions, perfil, permissões.
- **Depósito**: deposits, depositVersions, enxoval (inventoryItems), espelhos (snapshots).
- **Operação**: goldboxMovements (baixas), fila offline.
- **Estoque paralelo**: spareParts (peças avulsas), consumables, ppeItems.
- **Verificação**: inspections (conferência), inspectionItems, divergences.
- **Sugestão**: conversionSuggestions (peça avulsa → enxoval).
- **Registro**: auditLogs.
- **Docs**: documents (foto/PDF original + hash).

## 6. Ambientes e deploy

- PWA estático (Vite build) servido em CDN/servidor HTTPS com `manifest.webmanifest`, service worker, ícones.
- API Fastify atrás de reverse proxy com TLS, rate limiting, validação Zod em todas as rotas.
- PostgreSQL com usuário segregado por ambiente (`LOGENXOVAL_DB_*`) e backups programados.

## 7. Decisões de arquitetura registradas

| Decisão | Escolha | Motivo |
| ------- | ------- | ------ |
| Banco local | IndexedDB/Dexie | offline-first, sem dependência de plugin |
| Banco servidor | PostgreSQL | ACID, transações multi-estoque, RLS |
| Chave de estoque | `depositoId + codigoSap` | regra central da Seção 1 |
| Conflito de baixas | acumulação (soma), nunca "último vence" | Seção 9 |
| OCR | Tesseract.js local | funciona sem internet (Seção 6) |
| Relatórios | jsPDF + canvas | geração 100% local (Seção 8/19) |
| Senha | PBKDF2 (local) / bcrypt (servidor) | nunca texto puro; local limitado ao device |