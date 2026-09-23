# 11 — Contratos da API (REST, HTTPS)

Base: `/api/v1`. Todos os responses JSON. Error: `{ error: { code, message, details? } }`.

Auth: `Authorization: Bearer <accessToken>` (JWT curto) + `X-Device-Id`. Refresh via `POST /auth/refresh`.
Todo request de estoque envia/valida `depositoId`. RLS no banco reforça o mesmo filtro.

## 11.1 Endpoints

### Auth
| Método | Rota | Descrição |
| ------ | ---- | --------- |
| POST | `/auth/login` | `{matricula, senha, deviceId}` → `{accessToken, refreshToken, user, saltLocal}` |
| POST | `/auth/logout` | encerra sessão do device |
| POST | `/auth/refresh` | `{refreshToken, deviceId}` → novo token |
| GET | `/auth/me` | usuário atual + depósitos autorizados + perfil |
| POST | `/auth/change-password` | troca senha (admin próprio) |

### Users (admin)
| Método | Rota | Descrição |
| ------ | ---- | --------- |
| GET | `/users` | listar |
| POST | `/users` | criar (nome, sobrenome, matrícula, senha, perfil) |
| PATCH | `/users/:id` | status/bloqueio/perfil |
| DELETE | `/users/:id` | desativar (lógico) |

### Depósitos
| Método | Rota | Descrição |
| ------ | ---- | --------- |
| GET | `/deposits` | autorizados ao usuário |
| POST | `/deposits` | criar (gera espelho + log + ponto de restauração) |
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
| GET | `/deposits/:id/consumables`, `/deposits/:id/consumables/:c/movements` | idem `ppe` |
| GET/POST | `/deposits/:id/consumable-requests`, `/ppe-requests` | solicitações + transição de status |

### Conferências
| Método | Rota | Descrição |
| ------ | ---- | --------- |
| POST | `/deposits/:id/inspections` | criar conferência (volume) |
| GET | `/deposits/:id/inspections` | listar/histórico |
| POST | `/deposits/:id/inspections/:i/revision` | criar revisão (edição de finalizada) |
| POST | `/deposits/:id/inspections/:i/items/:itemId/correction` | correção (tipo; atômico com peça avulsa) |
| POST | `/deposits/:id/inspections/:i/items/:itemId/revert-correction` | estorno |

### Divergências
| Método | Rota | Descrição |
| ------ | ---- | --------- |
| GET | `/deposits/:id/divergences` | abertas (dashboard) |
| POST | `/deposits/:id/divergences/:d/resolve` | resolver (matrícula + motivo) |

### Docs
| Método | Rota | Descrição |
| ------ | ---- | --------- |
| POST | `/documents` | upload foto/PDF → `{id, hash}` |
| GET | `/documents/:id` | recuperar (byte range ok) |

### Logs / Snapshots
| Método | Rota | Descrição |
| ------ | ---- | --------- |
| GET | `/deposits/:id/logs` | filtros (tipo, data, usuário) |
| GET | `/deposits/:id/snapshots` | pontos de restauração |
| POST | `/deposits/:id/snapshots/:s/restore` | restaurar (matrícula + motivo; nunca apaga Goldbox) |

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