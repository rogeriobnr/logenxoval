# 15 — Plano de Restauração

## 15.1 Pontos de restauração (snapshots) por depósito

Geração automática ANTES e/ou DEPOIS de:

1. Criar depósito.
2. Editar depósito.
3. Desativar depósito.
4. Publicar novo enxoval.
5. Alteração de itens em lote.
6. Remoção de item da lista oficial.
7. Restaurar versão.
8. Aceitar conversão de peça avulsa.

`snapshot.payload` preserva: depósito, enxoval, peças avulsas, consumíveis, EPIs, configurações, versões, data, usuário, motivo.

## 15.2 Regras de restauração

- **Nunca apaga** logs do Goldbox, correções, versões, conferências já registradas.
- Restauração **cria nova versão** (não sobrescreve a atual) e preserva a atual.
- Requisitos: motivo + matrícula (e PIN do próprio usuário logado, se definido).

## 15.3 Fluxo da ação Restaurar

```
1. Selecionar ponto (lista de snapshots com data/motivo).
2. Mostrar comparação com estado atual (diff: itens/qtd/consumíveis/EPIs).
3. Solicitar motivo (obrigatório) + matrícula (confirmação crítica).
4. Criar nova depositVersions com conteúdo do snapshot.
5. Preservar versão atual anterior (status SUBSTITUIDA).
6. Gravar espelho DEPOIS + audit logs (RESTAURACAO).
7. Solicitar conferência após restauração (recomendado).
```

✅ **Fase 12**: implementado em `apps/server/src/services/restoreService.ts` + rotas `GET /deposits/:id/snapshots` e `POST /deposits/:id/snapshots/:s/restore`. O payload do snapshot preserva o `enxoval` com as quantidades do momento (não reinicia para `qtdOficial`). Registra `RESTAURACAO` (estadoAnterior = versão de origem) e um snapshot `DEPOIS` pós-restauração. A UI fica na seção "Restauração de versão" de `ConfiguracoesScreen`.

## 15.4 Restauração de débito/entregável

- Restauração do dispositivo: ver [14-plano-backup](14-plano-backup.md).
- Restauração do banco: ver seção 14.4.

## 15.5 Rastreabilidade

- Cada restauração aparece em logs + calendário.
- Diff antes/depois fica gravado no `estadoAnterior/estadoPosterior` do log.