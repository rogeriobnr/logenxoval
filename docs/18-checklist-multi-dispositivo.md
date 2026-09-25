# 18 — Checklist de Teste Multi-Dispositivo (fase 13)

Objetivo: validar o app **deployado** (`https://logenxoval.vercel.app`) em 2+ aparelhos (celular + notebook), cobrindo offline, fila, conflito e restauração.

## Preparo

- [x] Admin criado pelo seed (`SEED_ADMIN_MATRICULA`/`SEED_ADMIN_SENHA`) — `ADMIN-001`, login validado em produção.
- [x] API deployada responde: `health`, `login`, `me`, `refresh`, criar/listar/desativar depósito, erros JSON e CORS (smoke via `node fetch` — ver `docs/17`).
- [ ] No admin: criar depósito e usuários (1 líder, 2 mecânicos).
- [ ] Dispositivo A = celular; Dispositivo B = notebook. Instalar o PWA (Adicionar à tela inicial) nos dois, se possível.

## Fluxos principais (por dispositivo)

### 1. Login e isolamento
- [ ] Login offline (segundo acesso, sem internet) funciona nos dois.
- [ ] Mecânico do depósito 1 não vê depósito 2; admin vê todos.

### 2. Baixa online + audit
- [ ] Baixa no A → some do saldo no B (após pull).
- [ ] Log registrado com usuário/matrícula, data, quantidade e auditoria (regra de ouro).

### 3. Offline-first (teste #31/#32/#33)
- [ ] Celular em modo avião: registrar 3 baixas sem publicar (fila cresce).
- [ ] Religar: reconexão automática envia a fila; saldos batem nos dois aparelhos; nenhuma duplicação (operationId).

### 4. Conflito entre dispositivos (teste #35)
- [ ] A e B baixam o mesmo item em quantidades que deixam saldo negativo → divergência sinalizada; ambos veem o saldo final consistente.

### 5. Erro de servidor (teste #34)
- [ ] Com fila pendente, derrubar/resetar função (ou deixar o banco pausado do Neon) — fila não se perde; backoff e retry.

### 6. Fase 12 (backup/restauração) no deploy
- [ ] Backup `.lxb` numa máquina → import na outra (operationIds preservados).
- [ ] Restaurar snapshot de versão do servidor cria nova versão; Goldbox/logs preservados.

### 7. OCR/documentos
- [ ] Upload de foto no deploy (multipart via serverless) retorna documento e publica versão.

## Critérios de aceite

- [x] Build/typecheck/testes locais verdes (server 128, PWA 72) + `curl /health` = `ok`.
- [x] Nenhuma movimentação sem depósito, usuário, data, quantidade e auditoria (regra de ouro) — coberto pelos testes de servidor (fases 01–12) que seguem verdes.
- [ ] Fila nunca perde operação em queda de rede/função — pendente teste com 2 dispositivos físicos.