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
6. **Designar depósito** (tela **Usuários** → expandir cada usuário → "Designar depósitos"):
   marque **Galpão A** para `LID-1001`, `MEC-1002` e `MEC-1003` (o admin `ADMIN-001` já
   tem acesso a todos). Sem essa concessão, o usuário não vê o depósito nem consegue baixar (403).
7. **Criar itens**: no A, tela **Enxoval** → "Importar nova versão" → cole 3 linhas
   `codigoSap|textoBreve|qtdOficial|unidade` e publique:
   ```
   1002341|Camiseta Básica|20|UN
   1002342|Calça Sarja|15|UN
   1002343|Botina Couro|6|PAR
   ```
8. **Login nos dois aparelhos**: A e B com `MEC-1002`. Confira em **Logs** que o login
   de cada aparelho ficou registrado.

---

## Bloco 1 — Login e isolamento (`docs/18` §1)

- [x] (preparo) Primeiro acesso **online** nos dois aparelhos.
- [ ] **Login offline**: no A, ative modo avião → feche e reabra o app → login com `MEC-1002`
  deve funcionar (aviso "Autenticação offline é limitada a este dispositivo" é esperado).
  A sessão ativa também é restaurada sozinha, mesmo havendo mais de um usuário salvo no aparelho.
- [ ] **Negativo**: com o avião ligado, tente logar com uma matrícula que **nunca** logou
  online neste aparelho (ex.: `MEC-0000`) → deve **falhar** com "nunca autenticou online
  neste aparelho".
- [ ] **Troca de usuário offline**: ainda sem conexão, faça logout do `MEC-1002` e entre com
  outro usuário que já logou neste aparelho (ex.: `MEC-1003`) → deve funcionar; o logout
  **não apaga** a credencial, só encerra a sessão.
- [ ] **Isolamento**: com `MEC-1002` (depósito 1001) no A, a tela **Depósitos** deve listar
  apenas **Galpão A**. No admin (`ADMIN-001`), a mesma tela lista todos os depósitos.
- [ ] Marque as caixas §1 no `docs/18`.

> [NOTA] _________________________________________________________________

---

## Bloco 2 — Baixa online + audit (`docs/18` §2)

No A (`MEC-1002`, online):
- [ ] **Goldbox** → baixa `1002341` qtd **3** (Paris, olhar "Baixa").
- [ ] **UX do saldo**: ao digitar a quantidade, o app mostra "Disponível: 20 · Após a baixa: 17"
  para o item selecionado. Digite qtd **30** e confira o aviso de **negativação**; volte para
  **3** (o aviso some) e registre.
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

Objetivo: simular uma falha do servidor e confirmar que as operações da fila **não se perdem**.

**Preparo (no A):**
- [ ] Entre com `MEC-1002`, abra o **Goldbox** e registre **2 baixas** (ex.: `1002341` qtd 2
  e `1002342` qtd 3) com o **modo avião ligado**. Cada uma mostra "Baixa registrada no
  dispositivo (offline)".

**Opção A — pausar o banco Neon (mais fiel):**
1. No **computador**, abra o [Neon Console](https://console.neon.tech) → projeto usado na
   `DATABASE_URL` (ver `docs/17`) → menu **Settings** → seção **Pause & Resume** → botão
   **Pause project**. Espere a confirmação.
2. No A, **desligue o modo avião** e abra o app. Toque **Sincronizar agora**.
3. Verifique que a fila **não perdeu** nada: no **Dashboard**, as 2 pendências continuam lá,
   com status de erro/retry ("Erros na fila de sincronização") e o **backoff** aguardando
   (~30s, 1min…). Nenhuma operação foi descartada.
4. Volte ao Neon → **Resume project**. Atenção: o banco leva **dezenas de segundos para
   reativar**; se o app ainda mostrar erro, aguarde 1–2 min e toque **Sincronizar agora** de novo.
5. A fila zera e os saldos batem com o B.

**Opção B — sem mexer no Neon (rede do celular):**
1. Deixe as **2 baixas pendentes** (modo avião) no A.
2. Desligue o modo avião e toque **Sincronizar agora** e, **em seguida**, apague a rede do
   celular (Wi-Fi) *no meio* da sincronização — o envio falhará no meio do vôo.
3. Aguarde ~30s com o app aberto e observe o **backoff**; as operações continuam na fila
   (Dashboard mostra erro de sincronização, sem descartar).
4. Religue o Wi-Fi e toque **Sincronizar agora** → fila zera, saldos + logs conferem com o B
   (uma movimentação por baixa, mesmo com o envio tendo falhado no meio).

**Em qualquer opção:**
- [ ] A fila permaneceu íntegra; ao sincronizar com sucesso, **não há duplicação** em **Logs**.
- [ ] Marque `docs/18` §5.

> [NOTA] _________________________________________________________________

---

## Bloco 6 — Backup/restauração (`docs/18` §6)

- [ ] No B: **Configurações** → "Backup do dispositivo" → defina uma senha → **Exportar .lxb**.
  No navegador pode aparecer a **caixa de diálogo nativa** para escolher onde salvar; em aparelhos
  que só baixam, confira a **barra de notificações / pasta Downloads**. Use **Compartilhar arquivo**
  se quiser enviar direto para o A via WhatsApp/e-mail.
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

- [ ] No B: tela **Atualizar enxoval por foto/PDF** → envie 1 foto (JPEG/PNG/WebP) ou PDF com
  1–2 itens (testar com o texto `1002341` bem visível), máx. 5 MB na rota de IA.
- [ ] **Online**, o reconhecimento usa IA (Google Gemini) se configurada (ver `docs/17`,
  var `GEMINI_API_KEY`); sem a chave, o app cai **sozinho** para o reconhecimento local
  (Tesseract) e avisa qual caminho usou.
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