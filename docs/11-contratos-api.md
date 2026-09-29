# 11 — Contratos da API (REST, HTTPS)

Base: `/api/v1`. Todos os responses JSON. Error: `{ error: { code, message, details? } }`.

Auth: `Authorization: Bearer <accessToken>` (JWT curto) + `X-Device-Id`. Refresh via `POST /auth/refresh`.
Todo request de estoque envia/valida `depositoId`. RLS no banco reforça o mesmo filtro.

## 11.1 Endpoints

### Auth
| Método | Rota | Descrição |
| ------ | ---- | --------- |
| POST | `/auth/login` | `{matricula, senha, deviceId}` → `{accessToken, refreshToken, user, saltLocal}` |
| POST | `/auth/register` | sem token — cadastro público `{nome, sobrenome, matricula, email, senha, perfil (MECANICO/LIDER), pin}` → usuário `PENDENTE` |
| POST | `/auth/forgot-password` | público — `{email}` → sempre 200; se o e-mail existe, envia link de recuperação |
| POST | `/auth/reset-password` | público — `{token, novaSenha}` (token 1 uso, expira 30 min; revoga sessões) |
| POST | `/auth/forgot-pin` | público — `{email}` → sempre 200; se o e-mail existe, envia link de recuperação do PIN |
| POST | `/auth/reset-pin` | público — `{token, novoPin}` (token 1 uso, expira 30 min; não revoga sessões) |
| POST | `/auth/change-pin` | `{pinAtual, novoPin}` — PIN do próprio usuário (`pinAtual` vazio permite criar o primeiro PIN) |
| POST | `/auth/logout` | encerra sessão do device |
| POST | `/auth/refresh` | `{refreshToken, deviceId}` → novo token |
| GET | `/auth/me` | usuário atual + depósitos autorizados + perfil |
| POST | `/auth/change-password` | troca senha (admin próprio) |

### Users (admin; líder com acesso parcial)
| Método | Rota | Descrição |
| ------ | ---- | --------- |
| GET | `/users` | listar — admin vê todos; líder vê somente não-admins (MECANICO/LIDER) |
| POST | `/users` | criar `{nome, sobrenome, matricula, email, senha, perfil, pin}` — líder cria MECANICO/LIDER; criar ADMIN é restrito ao admin (403) |
| PATCH | `/users/:id` | status/bloqueio/perfil (admin); `{novoPin}` redefine o PIN (admin) |
| DELETE | `/users/:id` | desativar (lógico) — admin |

### Depósitos
| Método | Rota | Descrição |
| ------ | ---- | --------- |
| GET | `/deposits` | autorizados ao usuário |
| POST | `/deposits` | criar (gera espelho + log + ponto de restauração) — matrícula obrigatória, **sem PIN** |
| GET | `/deposits/:depositoId` | detalhe + versão atual |
| PATCH | `/deposits/:depositoId` | editar (matrícula + PIN se admin) |
| POST | `/deposits/:depositoId/deactivate` | desativação lógica |

### Enxoval
| Método | Rota | Descrição |
| ------ | ---- | --------- |
| GET | `/deposits/:id/enxoval` | itens da versão atual |
| GET | `/deposits/:id/enxoval/versions` | versões antigas |
| GET | `/deposits/:id/enxoval/versions/:versionId` | itens de versão |
| POST | `/deposits/:id/enxoval/import` | cria publicação a partir de OCR/revisão (body itens + documentoId + motivo) — crítico, matrícula obrigatória |

### Goldbox
| Método | Rota | Descrição |
| ------ | ---- | --------- |
| GET | `/deposits/:id/goldbox` | histórico com filtros (dataIni, dataFim, codigoSap, usuario, reposicao, tipo) |
| POST | `/deposits/:id/goldbox/baixa` | baixa (usa `operationId`; idempotente) |
| POST | `/deposits/:id/goldbox/estorno` | estorno (líder/admin, motivo + matrícula) |

### Peças avulsas
| Método | Rota | Descrição |
| ------ | ---- | --------- |
| GET | `/deposits/:id/spare-parts` | listar |
| POST | `/deposits/:id/spare-parts` | entrada (origem, observação) |
| POST | `/deposits/:id/spare-parts/:partId/movements` | saída/uso/ajuste/descarte (tipos validados por perfil) |
| GET | `/deposits/:id/conversion-suggestions` | sugestões |
| POST | `/deposits/:id/conversion-suggestions/:sid/respond` | `{acao: ACEITA|RECUSADA, motivo}` — transação atômica |

### Consumíveis / EPIs
| Método | Rota | Descrição |
| ------ | ---- | --------- |
| GET | `/deposits/:id/consumables` | lista consumíveis |
| GET | `/deposits/:id/consumables/:c/movements` | movimentos do consumível |
| GET | `/deposits/:id/ppe` | lista EPIs |
| GET | `/deposits/:id/ppe/:p/movements` | movimentos do EPI |
| GET | `/deposits/:id/requests` | solicitações (mecânico vê as próprias; líder vê todas) |
| POST | `/deposits/:id/requests` | criar solicitação (`{operationId, tipo: CONSUMIVEL\|EPI, itens[], enviar?, assinaturaMatricula}`) — `enviar: true` (fase 21) já nasce `ENVIADA`; sem `enviar` continua `RASCUNHO` (backcompat) |
| POST | `/deposits/:id/requests/:rid/transition` | transição de status (`{operationId, para: ENVIADA\|RECEBIDA\|EXCLUIDA, naoRecebidos?, motivo?, assinaturaMatricula}`) — **RECEBIDA só pela liderança** (LIDER/ADMIN) e apenas a partir de `RASCUNHO`/`ENVIADA`, com `naoRecebidos[]` (códigos não recebidos); **EXCLUIDA só pelo dono** da solicitação (inclusive quando o dono é líder); transição fora do estado esperado → 409 `CONFLITO`, sem permissão → 403; **não exige PIN** |
| POST | `/deposits/:id/estoque/:tipo` | cadastrar consumível/EPI direto no catálogo (`{codigo, descricao, unidade?, estoqueMinimo?, assinaturaMatricula, matriculaConfirmacao?}`) — qualquer usuário com acesso; código duplicado → 409; auditoria `CRIACAO_ITEM_ESTOQUE` (fase 21) |
| PUT | `/deposits/:id/estoque/:tipo/:itemId` | editar consumível/EPI (mesmo payload; `codigo` editável) — qualquer usuário; código já existente → 409; item inexistente → 404; auditoria `EDICAO_ITEM_ESTOQUE` (fase 21) |
| POST | `/deposits/:id/estoque/:tipo/:itemId/excluir` | excluir consumível/EPI do catálogo (`{motivo, assinaturaMatricula, matriculaConfirmacao?}`) — qualquer usuário com acesso (mecânico incluído, fase 21); remove item + movimentos, encerra solicitações abertas (RASCUNHO/ENVIADA) que referenciam o código; auditoria `EXCLUSAO_ESTOQUE` + `SOLICITACAO_EXCLUIDA` |

### Conferências
| Método | Rota | Descrição |
| ------ | ---- | --------- |
| POST | `/deposits/:id/inspections` | criar conferência (volume). `concluir: true` (fase 20) conclui na hora (`CONCLUIDA`) e cria divergências automaticamente — falta → `REPOSICAO` (qtd = diferença), sobra → `CONFERENCIA` (qtd = diferença) — retorna `{inspecao, itens, divergencias}` |
| GET | `/deposits/:id/inspections` | listar/histórico (somente leitura — fase 20) |
| POST | `/deposits/:id/inspections/:i/revision` | criar revisão (edição de finalizada) — mantido p/ compatibilidade |
| POST | `/deposits/:id/inspections/:i/items/:itemId/correction` | correção (tipo; atômico com peça avulsa) — mantido p/ compatibilidade |
| POST | `/deposits/:id/inspections/:i/items/:itemId/revert-correction` | estorno — mantido p/ compatibilidade |

### Divergências
| Método | Rota | Descrição |
| ------ | ---- | --------- |
| GET | `/deposits/:id/divergences` | lista do depósito — `?status=` (ABERTA\|RESOLVIDA\|…), `?tipo=` (REPOSICAO\|SALDO_NEGATIVO\|CONFERENCIA), `?limit=` — inclui `descricao` via join no enxoval corrente, mais recentes primeiro. Puxada para o espelho local de todos os dispositivos do depósito (fase 19). |

> **Fechamento de pendência REPOSICAO**: apenas pela entrada de material (`POST /goldbox/entrada`). Divergências `CONFERENCIA` criadas no registro (`concluir: true`) também aparecem no dashboard.

### Docs
| Método | Rota | Descrição |
| ------ | ---- | --------- |
| POST | `/documents` | upload foto/PDF → `{id, hash}` |
| GET | `/documents/:id` | recuperar (byte range ok) |

### Logs / Snapshots
| Método | Rota | Descrição |
| ------ | ---- | --------- |
| GET | `/deposits/:id/logs` | filtros (tipo, data, usuário) |
| GET | `/deposits/:id/snapshots` | pontos de restauração (metadados + versão de origem) |
| POST | `/deposits/:id/snapshots/:s/restore` | restaurar `{motivo, matriculaConfirmacao, pin?}` → `{versao, itens}` — cria nova versão, nunca apaga Goldbox/logs (perfil líder/admin) |

### Sincronização (Núcleo)
| Método | Rota | Descrição |
| ------ | ---- | --------- |
| POST | `/sync` | push batch + pull delta. Body: `{deviceId, depositoId, lastSyncAt, operations:[...]}` → `{acks, conflicts:[], errors:[], changed:{...}}` |

Prioridade por nó: `depositoId` validado; `operationId` idempotência; `processedOperations` registra tudo.

## 11.2 Exemplos de payload

Baixa:
```json
{ "operationId": "uuid", "depositoId": "3216", "codigoSap": "1002341",
  "materialId": "…", "descricao": "Parafuso M8x20", "quantidade": 2,
  "dataHora": "2026-09-22T10:00:00.000Z", "usuarioId": "…", "nomeCompleto": "João S.",
  "matricula": "MAT-001", "reposicao": true, "origem": "OFFLINE",
  "dispositivo": "device-id", "assinaturaMatricula": "hash" }
```

Sync request:
```json
{ "deviceId": "d1", "depositoId": "3216", "lastSyncAt": "ISO",
  "operations": [ { "entidade": "BAIXA", "acao": "CREATE", "payload": {…} } ] }
```
Response:
```json
{ "acks": [ { "operationId": "…", "status": "OK" } ],
  "conflicts": [ { "operationId": "…", "tipo": "CONFLITO_PENDENTE", "detalhe": "…" } ],
  "errors": [ { "operationId": "…", "code": "DEPOSITO_NAO_AUTORIZADO" } ],
  "changed": { "inventoryItems": [ … ], "goldboxMovements": [ … ], "divergences": […], "settings": […] } }
```

## 11.3 Códigos de erro comuns

`UNAUTHORIZED`, `DEPOSITO_NAO_AUTORIZADO`, `MATRICULA_INVALIDA`, `OPERATION_DUPLICADA` (ack), `ITEM_INDISPONIVEL`, `PERMISSAO_NEGADA`, `VALIDATION_FAILED`, `SALDO_CONFLITO`, `CONFLITO_PENDENTE`.