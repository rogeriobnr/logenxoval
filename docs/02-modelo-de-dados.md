# 02 — Modelo de Dados

Convenções: PK `id` UUID(v7) em todas as entidades. `operationId` UUID gerado no device é a chave de **idempotência** exclusiva de entidades com escritas distribuídas. Datas UTC ISO-8601. Estado em `estado*` (json) preserva snapshots.

Status genéricos: `ATIVO | INATIVO | BLOQUEADO`, `ABERTA | CONCLUIDA | CANCELADA`.

## 2.1 Índice das entidades (bancos local e servidor espelham)

| # | Local (IndexedDB) | Servidor (PostgreSQL) | Nota |
| - | ------------------ | ---------------------- | ---- |
| 1 | users | users | hash local separado |
| 2 | sessions | sessions | sessão por device |
| 3 | deposits | deposits | único número por depósito |
| 4 | depositVersions | deposit_versions | versões do enxoval |
| 5 | inventoryItems | inventory_items | enxoval |
| 6 | goldboxMovements | goldbox_movements | baixas |
| 7 | spareParts | spare_parts | peças avulsas |
| 8 | sparePartMovements | spare_part_movements | movimentações |
| 9 | consumables | consumables | consumíveis |
| 10 | consumableMovements | consumable_movements | |
| 11 | ppeItems | ppe_items | EPIs |
| 12 | ppeMovements | ppe_movements | |
| 13 | inspections | inspections | conferências |
| 14 | inspectionItems | inspection_items | itens de conferência |
| 15 | conversionSuggestions | conversion_suggestions | sugestões |
| 16 | auditLogs | audit_logs | logs imutáveis |
| 17 | snapshots | snapshots | espelhos/pontos de restauração |
| 18 | documents | documents | foto/PDF original |
| 19 | syncQueue | (não existe) | fila offline só no device |
| 20 | processedOperations | processed_operations | idempotência |
| 21 | settings | settings | configuração (por depósito opcional) |
| 22 | divergences | divergences | divergências automáticas |
| 23 | unusedParts (consumableRequests/ppeRequests) | consumable_requests, consumable_request_items, ppe_requests, ppe_request_items | solicitações |

## 2.2 Entidades principais

### users
```
id, matricula UNIQUE, email UNIQUE (optional; usado só na recuperação), nome, sobrenome,
perfil (MECANICO|LIDER|ADMIN), senhaHash (servidor: bcrypt),
pinHash (PIN do próprio usuário, 4-6 dígitos), status (ATIVO|BLOQUEADO|PENDENTE),
criadoEm, atualizadoEm
```
Cadastro público cria `PENDENTE` até aprovação do admin. Não há mais PIN global em `settings` (removido; `settings` segue para outras chaves).

### password_resets
```
id, userId (ref users), tokenHash (sha256 do token), expiraEm, criadoEm, usadoEm
```
Token de uso único para recuperação de senha (validade 30 min).

### sessions
```
id, userId, deviceId, tokenHash, criadoEm, expiresAt, lastActivityAt
```
Uma sessão ativa por device (troca exige logout).

### deposits
```
id, numero UNIQUE, nome, status (ATIVO|INATIVO), criadoPor, criadoEm,
alteradoPor, alteradoEm, versaoAtualEnxoval (ref depositVersions)
```
Desativação é lógica. Sempre gera log + espelho + ponto de restauração.

### depositVersions
```
id, depositoId, versao (int), dataEm, usuarioId, matricula,
documentoId (foto/PDF original), alteracoes (json), motivo, refFolha,
hashDocumento, status (PUBLICADA|SUBSTITUIDA|RESTAURADA)
```

### inventoryItems (ENXOVAL)
```
id, depositoId, codigoSap, materialId (opcional), textoBreve, foto (doc ref),
qtdOficial, qtdAtual (saldo operacional), utilizacaoLivre (bool),
valorUnitario, valorTotal, unidadeMedida, estoqueMinimo (opcional),
status (ATIVO|INATIVO|REMOVIDO_DA_LISTA_OFICIAL|ALTERADO|PENDENTE_DE_REVISAO),
versao (depositVersionId), criadoEm, atualizadoEm, usuarioResponsavel
UNIQUE (depositoId, codigoSap, versao)
qtdAtual pode ser negativo.
```

### goldboxMovements (BAIXAS)
```
id, operationId UNIQUE, depositoId, codigoSap, materialId, descricao,
quantidade (>0 na baixa; sinal negativo em estorno), dataHora,
usuarioId, nomeCompleto, matricula, reposicao (bool),
origem (ONLINE|OFFLINE), dispositivo (deviceId), statusSync,
assinaturaMatricula (hash da confirmação), estornoDe (operationId opcional)
```

### spareParts
```
id, depositoId, foto (doc ref), codigoSap, descricao, quantidadeAtual,
origem (BACKLOG|OUTRA_FRENTE|COMPRA_DEBITO_DIRETO|LIDERANCA|OUTRO),
dataEntrada, responsavel, observacao, status
```

### sparePartMovements
```
id, depositoId, sparePartId, operationId, tipo
(ENTRADA|SAIDA|USO_CORRECAO|TRANSFERENCIA_INFORMATIVA|CONVERSAO_ACEITA|DESCARTE|AJUSTE_AUTORIZADO),
quantidade, dataHora, usuarioId, matricula, motivo, estadoAnterior, estadoPosterior
```

### consumables / ppeItems
```
id, depositoId, foto, codigo, descricao, quantidade, unidade,
estoqueAtual, estoqueMinimo
```
movements análogos a sparePartMovements.

### consumable_requests / ppe_requests
```
id, depositoId, solicitanteId, matricula, status
(RASCUNHO|PRONTA_PARA_ENVIO|ENVIADA|RECEBIDA_PELA_LIDERANCA|APROVADA|ATENDIDA|CANCELADA),
dataEm, itens (json: [{qtd,descricao,codigo}] )
```

### inspections (CONFERÊNCIAS)
```
id, depositoId, versaoEnxoval, autorId, matricula, dataEm, hora,
status (EM_ANDAMENTO|CONCLUIDA|REVISADA), observacao, tipoCorrecao
```

### inspection_items
```
id, inspectionId, depositoId, codigoSap, materialId, qtdSistema, qtdFisica,
diferenca, status (OK|DIVERGENTE|PENDENTE), observacao,
ultimaBaixaGoldbox (operationId/data), reposicaoPosterior (bool),
reposicaoPendente (bool), corregido (bool), correcaoRef (operationId)
```
Edição de conferência finalizada **não apaga** a anterior: cria nova revisão + novo log.

### divergences
```
id, depositoId, codigoSap, tipo (SALDO_NEGATIVO|CONFERENCIA|REPOSICAO), 
quantidade, status (ABERTA|EM_ANALISE|RESOLVIDA|CANCELADA),
origemOperationId, inspecaoId, criadoEm, criadoPor, resolvidoEm, resolvidoPor
```

### conversionSuggestions
```
id, depositoId, codigoSap, descricao, qtdDisponivelPecas, qtdPrevistaLista,
qtdSugerida, status (PENDENTE|ACEITA|RECUSADA|CANCELADA|EXPIRADA),
motivo, criadoPor, versaoEnxoval, processadaOperationId
```
Recusada mantém registro. Aceita debita peça avulsa, ajusta enxoval, vincula versão, loga.

### auditLogs
```
id, tipo, dataHora, usuarioId, matricula, depositoId, entidade, operacaoId,
estadoAnterior (json), estadoPosterior (json), motivo, origem (ONLINE|OFFLINE),
dispositivo, hash (sha256 do payload para imutabilidade)
```

### snapshots (ESPELHOS / PONTOS DE RESTAURAÇÃO)
```
id, depositoId, titulo, tipo (ANTES|DEPOIS), motivo, usuarioId, matricula,
dataEm, payload (json: enxoval + peças + consumíveis + EPIs + configurações + versões),
```
Restauração **nunca** apaga logs do Goldbox.

### processedOperations (SERVIDOR)
```
operationId UNIQUE, entidade, acao, payloadHash (sha256), processadoEm, resultado (json)
```
Base da idempotência distribuída.

### documents
```
id, depositoId, tipo (FOTO|PDF), nome, mime, tamanho, hashDocumento (sha256),
bytes (blob/binary), criadoEm, usuarioId, matricula
```

### syncQueue (LOCAL)
```
id, operationId, entidade, acao, payload (json no formato da operação), criadoEm,
tentativas, proximaTentativaEm, status (PENDENTE|ENVIANDO|ERRO|ENVIADO), erro
```

## 2.3 Transações atômicas (obrigatórias no servidor)

1. **Correção com peça avulsa**: `BEGIN → débito spare_part → ajuste inventory_item → insert spare_part_movement → insert audit_log → associa inspection_item → COMMIT`. Qualquer falha faz ROLLBACK total.
2. **Conversão de sugestão aceita**: débito peça avulsa + entrada/associação no enxoval + vínculo com versão + log de conversão.
3. **Publicação de versão**: nova `deposit_versions` + itens da nova versão + atualização de `qtdOficial` + espelho + logs.

## 2.4 Validações de integridade

- `UNIQUE(depositoId, codigoSap)` por versão de enxoval (permitido em versões distintas).
- `UNIQUE(depositoId, numero)` em deposits; `UNIQUE(matricula)` em users.
- FK `depositoId` em todas as tabelas de estoque/operação.
- RLS no PostgreSQL: cada requisição autenticada filtra por `depositoId` autorizado (ver plano de segurança).