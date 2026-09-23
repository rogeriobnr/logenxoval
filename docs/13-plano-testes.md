# 13 — Plano de Testes

## 13.1 Estratégia

- **unit**: regras de negócio (saldos, divergências, sugestões, transações) rodando rápido.
- **integration (servidor)**: Fastify + PostgreSQL (Docker `postgres:16`), requisições reais via `fastify.inject()`.
- **integration (PWA)**: lógica de domínio (repositórios Dexie com `fake-indexeddb`) + OCR pipeline.
- **e2e manual multi-dispositivo**: checklist para campo (fase final).

## 13.2 Os 35 testes obrigatórios (Seção 21) mapeados

| # | Teste | Nível |
| - | ----- | ----- |
| 1 | Login (online + offline pós-primeiro acesso) | integration |
| 2 | Troca de usuário no mesmo device exige logout | integration |
| 3 | Bloqueio por inatividade | unit/integration |
| 4 | Isolamento entre depósitos (operação 3216 não alcança 3217) | integration |
| 5 | Mesmo SAP em depósitos diferentes tem saldo independente | integration |
| 6 | Baixa online | integration |
| 7 | Baixa offline (gravada local, enfileirada) | integration PWA |
| 8 | Duas baixas offline no mesmo item → acumuladas | integration |
| 9 | Saldo negativo permitido | integration |
| 10 | Criação automática de divergência | integration |
| 11 | Conferência física | integration |
| 12 | Correção com peça avulsa (atômica) | integration |
| 13 | Recusa de sugestão de conversão (mantém histórico) | integration |
| 14 | Aceite de sugestão (débito+ajuste+vinculação+log) | integration |
| 15 | Estorno de correção (operação inversa, não apaga original) | integration |
| 16 | Importação de imagem (pipeline OCR) | unit/integration PWA |
| 17 | Importação de PDF (multi-página) | unit |
| 18 | Revisão de OCR (cores/validação/edição manual) | unit/PWA |
| 19 | Publicação de nova versão (matrícula obrigatória) | integration |
| 20 | Restauração de versão (preserva Goldbox/logs) | integration |
| 21 | Edição de conferência finalizada (nova revisão) | integration |
| 22 | Permissões de mecânico (nega ações proibidas) | integration |
| 23 | Permissões de líder | integration |
| 24 | Permissões de administrator | integration |
| 25 | Sincronização interrompida (retoma sem duplicar) | integration |
| 26 | Reenvio de operação (idempotente) | integration |
| 27 | Operação duplicada (processedOperations) | integration |
| 28 | Geração local de PDF | unit PWA |
| 29 | Geração local de PNG | unit PWA |
| 30 | Backup e restauração (JSON criptografado) | unit/integration |
| 31 | Uso sem internet (fila acumula) | PWA |
| 32 | Reconexão automática (online event → sync) | PWA |
| 33 | Fila de operações pendentes (ordem, retry) | PWA |
| 34 | Erro de servidor (backoff, não perde fila) | integration |
| 35 | Conflito entre dispositivos (A e B baixam ao mesmo item) | integration |

## 13.3 Ambiente

- `docker compose up -d db` → PostgreSQL local (:5432), database `logenxoval_test`.
- Comando por pacote: `npm test` (node:test). PWA testa domínio com `fake-indexeddb`.

## 13.4 CheckList de aceite por fase

Cada fase só passa se: build ok, typecheck ok, testes da fase ok, e a **regra de ouro** valida: `nenhuma movimentação sem depósito, usuário, data, quantidade e auditoria`.