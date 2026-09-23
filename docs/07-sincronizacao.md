# 07 — Sincronização (offline-first)

## 7.1 Gatilhos

- Ao detectar rede (`online` / `visibilitychange`).
- Ao abrir o app.
- Ao voltar ao app (`focus`).
- Botão manual **Sincronizar agora**.

## 7.2 Direção e lote

- **Push**: cliente envia lote `POST /sync` (baixas, conferências, correções, sugestões, solicitações, logs) com `deviceId` + `depositoId`.
- **Pull**: servidor retorna delta (`updatedAt` a partir de `lastSyncAt` do device) para depósitos autorizados: enxoval, versões, peças, consumíveis, EPIs, configurações, divergências, status de permissões.
- Rota única de sync agrega push+pull para reduzir idas de rede.

## 7.3 Modal de progresso

```
* Verificando conexão
* Enviando baixas
* Enviando conferências
* Enviando correções
* Enviando solicitações
* Enviando logs
* Baixando atualizações
* Recalculando saldos
* Verificando conflitos
* Finalizando
```
Exibe progresso, quantidade processada e erros.

## 7.4 Sem sinal

- Alerta "Sem conexão — operações mantidas pendentes".
- Nada é descartado; a fila permanece.
- Orienta usuário a ir a área com sinal; oferece botão *Tentar novamente*.

## 7.5 Estados do dashboard

| Estado | Condição |
| ------ | -------- |
| `SINCRONIZADO` | online, fila vazia |
| `OFFLINE_SEM_PENDENCIA` | offline, fila vazia |
| `OFFLINE_COM_PENDENCIA` | offline, fila não vazia |
| `SINCRONIZANDO` | sync em andamento |
| `ERRO_SINCRONIZACAO` | erro de rede/servidor na última tentativa |
| `CONFLITO_PENDENTE` | divergência de sincronização aguardando ação |

## 7.6 Idempotência e reinício

- Cada operação tem `operationId`; quando a sync é interrompida, o reenvio não duplica (servidor consulta `processedOperations`).
- Retry com backoff exponencial (`proximaTentativaEm`).

## 7.7 Recalculo de saldos

- Após push/pull, o cliente e o servidor **recalculam** `qtdAtual` a partir do histórico de movimentações do depósito (`sum(movements)` + versão atual) — nunca por sobrescrita direta de opiniões locais.

## 7.8 Notificações

- Divergências novas → badge no dashboard e (quando viável) notificação local.
- Sem push externo obrigatório; o modelo é pull/ativo.