# 19 — Roteiro de Teste Multi-Dispositivo (passo a passo)

Companheiro do `docs/18`. Execute na ordem e marque as caixas do `18` ao final de cada
bloco. A cada bloco concluído, rode `npm run test -w @logenxoval/server` e `-w @logenxoval/pwa`
se quiser confirmação extra, e anote observações com `[NOTA]` nesta página.

Ambiente: `https://logenxoval.vercel.app` (produção). Dispositivo A = celular;
Dispositivo B = notebook. Duração estimada: 45–75 min.

> Senha base do seed: ver `docs/17` (var `SEED_ADMIN_SENHA`). Não commitar segredos.

---

## Preparo (10 min)

1. **A — celular**: abra `https://logenxoval.vercel.app` no Chrome (Android) → menu ⋮ →
   "Adicionar à tela inicial". No iOS/Safari:  → "Adicionar à tela de início".
   Abra pelo ícone criado.
2. **B — notebook**: acesse a mesma URL.
3. **Admin**: login no A com `ADMIN-001` e a senha do seed.
4. **Criar depósito**: tela **Depósitos** → novo depósito, número **1001**, nome **Galpão A**.
5. **Criar usuários** (tela **Usuários**), todos com senha definida por você:
   - Líder: matrícula `LID-1001`, nome "Líder A", perfil **LÍDER**.
   - Mecânico 1: matrícula `MEC-1002`, perfil **MECÂNICO**.
   - Mecânico 2: matrícula `MEC-1003`, perfil **MECÂNICO**.
6. **Criar itens**: no A, tela **Enxoval** → "Importar nova versão" → cole 3 linhas
   `codigoSap|textoBreve|qtdOficial|unidade` e publique:
   ```
   1002341|Camiseta Básica|20|UN
   1002342|Calça Sarja|15|UN
   1002343|Botina Couro|6|PAR
   ```
7. **Login nos dois aparelhos**: A e B com `MEC-1002`. Confira em **Logs** que o login
   de cada aparelho ficou registrado.

---

## Bloco 1 — Login e isolamento (`docs/18` §1)

- [x] (preparo) Primeiro acesso **online** nos dois aparelhos.
- [ ] **Login offline**: no A, ative modo avião → feche e reabra o app → login com `MEC-1002`
  deve funcionar (aviso "Autenticação offline é limitada a este dispositivo" é esperado).
- [ ] **Negativo**: com o avião ligado, tente logar com um manual qualquer (ex.: `MEC-0000`)
  → deve **falhar** (sem espelho local válido).
- [ ] **Isolamento**: com `MEC-1002` (depósito 1001) no A, a tela **Depósitos** deve listar
  apenas **Galpão A**. No admin (`ADMIN-001`), a mesma tela lista todos os depósitos.
- [ ] Marque as caixas §1 no `docs/18`.

> [NOTA] _________________________________________________________________

---

## Bloco 2 — Baixa online + audit (`docs/18` §2)

No A (`MEC-1002`, online):
- [ ] **Goldbox** → baixa `1002341` qtd **3** (Paris, olhar "Baixa").
- [ ] No B: **Dashboard** → "Sincronizar agora" → **Enxoval/Estoque** → o saldo de `1002341`
  passou de 20 para 17.
- [ ] **Auditoria**: **Logs** no B mostra a baixa com matrícula `MEC-1002`, data/hora,
  quantidade e o item; conferir caminho (GOLDBOX_BAIXA ou similar, sem lacunas).
- [ ] Marque `docs/18` §2.

> [NOTA] _________________________________________________________________

---

## Bloco 3 — Offline-first (fila) (`docs/18` §3)

No A, **modo avião**:
- [ ] **Goldbox** → 3 baixas: `1002341` (2), `1002342` (4), `1002343` (1). Cada aviso
  "Baixa registrada no dispositivo (offline)" = esperado.
- [ ] **Dashboard** no A: "Pendências na fila" = 3; status "Sincronizando/offline".
- [ ] **Religue** o A (desligar modo avião) e aguarde/aperte "Sincronizar agora".
- [ ] No B: sincronize e confira saldos: `1002341` = 15, `1002342` = 11, `1002343` = 5.
- [ ] **Sem duplicação**: em **Logs** (ou relatório), exatamente uma movimentação por baixa
  feita offline (operação com `operationId`; mesmo que o A tenha ficado sem rede durante o envio).
- [ ] Marque `docs/18` §3.

> [NOTA] _________________________________________________________________

---

## Bloco 4 — Conflito entre dispositivos (`docs/18` §4)

Use um item de saldo baixo (`1002343`, saldo 6):
- [ ] B (online): baixa `1002343` qtd **5** → saldo 1.
- [ ] A (modo avião): baixa `1002343` qtd **2** → local vira −1 (permite negativo offline).
- [ ] A sincroniza → **Dashboard**: "Divergências" > 0 (saldo negativo/divergente sinalizado).
- [ ] Saldo final **consistente** nos dois aparelhos após ambos sincronizarem (mesmo valor,
  negativo sinalizado). Nenhum dos dois "salta" baixas silenciosamente.
- [ ] Marque `docs/18` §4.

> [NOTA] _________________________________________________________________

---

## Bloco 5 — Erro de servidor / backoff (`docs/18` §5)

- [ ] No A, deixe 2 baixas **pendentes** (modo avião).
- [ ] **Pause o banco Neon** (Neon console → projeto → *Pause*), deixe ~1 min.
- [ ] Religue o A e sincronize → a fila deve **não se perder**: Dashboard mostra "Erros na
   fila de sincronização" e o retry em backoff (não travou nem descartou).
- [ ] **Resume** o Neon e aguarde o retry automático (ou "Sincronizar agora") → fila zera,
   saldos batem com o B.
- [ ] Alternativa sem pausar Neon: desligue o Wi-Fi do celular no meio do sync (pull ainda
   em vôo) e verifique que a operação não sumiu após religar.
- [ ] Marque `docs/18` §5.

> [NOTA] _________________________________________________________________

---

## Bloco 6 — Backup/restauração (`docs/18` §6)

- [ ] No B: **Configurações** → "Backup do dispositivo" → defina uma senha → **Exportar .lxb**.
- [ ] Transfira o `.lxb` para o A (cloud/USB/cabo).
- [ ] No A: **Configurações** → **Importar backup** → informe a senha do backup.
- [ ] Sincronize o A → saldos e fila voltam **sem duplicação** (operationIds preservados).
- [ ] **Restauração de versão** (perfil LÍDER/ADMIN, online): no A com `LID-1001`,
  **Configurações** → lista de pontos de restauração → **Restaurar** → informe motivo +
  matrícula de confirmação (`ADMIN-001`, por exemplo) → nova versão publicada; o enxoval
  mostra a versão restaurada; **Goldbox e logs preservados**.
- [ ] Marque `docs/18` §6.

> [NOTA] _________________________________________________________________

---

## Bloco 7 — OCR/documentos (`docs/18` §7)

- [ ] No B: tela **Revisão OCR** → envie 1 foto (JPEG/PNG/WebP) ou PDF com 1–2 itens
  (textar com o texto `1002341` bem visível), máx. 20 MB.
- [ ] Confira as linhas extraídas, corrija se preciso, e publique.
- [ ] **Documento salvo** (na tela de documentos/enxoval) e **nova versão** do enxoval publicada;
  saldo do item reconhecido refletido nos dois aparelhos.
- [ ] Marque `docs/18` §7.

> [NOTA] _________________________________________________________________

---

## Conclusão

- [ ] Todas as caixas de `docs/18` preenchidas (exceto "pendente teste com 2 dispositivos").
- [ ] Suítes locais re-rodadas verdes após os ajustes (se houver).
- [ ] Commit das observações/ajustes (git commit + push → CI verde).

Se algo **falhou**: registre aqui o passo, o esperado vs. obtido, e o trecho do log/console.
Corrija com a ajuda deste repositório e re-teste.