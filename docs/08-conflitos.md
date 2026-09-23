# 08 — Conflitos de Baixas Offline

## 8.1 Princípio

**Nunca "última alteração vence".** Cada operação offline é um fato registrado e as operações **se acumulam**.

## 8.2 Exemplo da Seção 9

```
Saldo conhecido: 1
Usuário A baixa 1 offline  → movimento(op A)
Usuário B baixa 1 offline  → movimento(op B)
Sincronização: aplica A e B acumulados → saldo = 1 - 1 - 1 = -1
```

Coerente? Sim: saldo consolidado **-1**, duas operações aceitas como fatos.

## 8.3 Regras de consolidação

1. Aceitar as duas operações como fatos (não conflitam entre si; conflito existe contra o **saldo de referência** do servidor).
2. Nunca duplicar (idempotência por `operationId`).
3. Recalcular saldo por histórico (nunca "último").
4. Saldo negativo permitido.
5. Criar `divergences` (SALDO_NEGATIVO ou CONFERENCIA) automaticamente.
6. Notificar responsáveis (matrículas/depósito).
7. Exibir no dashboard e solicitar conferência física ou reposição.

## 8.4 Conflito real de edição (não acumulável)

Edições **aditivas não são sobrescritas**. Casos divergentes de decisão (ex.: correção da liderança + correção de mecânico no mesmo item na mesma janela) são resolvidos por:

1. **Prioridade explícita** de origem: `ACAO_LIDERANCA` > correção comum.
2. Registro das duas como **fatos** com `estadoAnterior/estadoPosterior`; a segunda aplicada gera `CONFLITO_PENDENTE` para revisão humana (dashboard + notificação).
3. Nunca descarta silenciosamente nenhuma das duas.

## 8.5 Fluxo de detecção

```
Servidor, ao processar batch:
  para cada operation:
    se operationId em processedOperations → ACK (já processado), skip
    senão aplica dentro de transação e grava processedOperations
  após lote: recalcular saldos por depósito
  comparar saldo previsto (cliente) vs recalculado (servidor)
  divergências → persiste + notifica
```

## 8.6 Duplicias detectadas no pull

- Se cliente reenviar operação já ack'd (`enviado`), a fila remove o item — reenvio só acontece em *não ack'd*.

## 8.7 Notas operacionais

- Divergências possuem status próprio e histórico de resolução (log `DIVERGENCIA`, `CORRECAO`, `REPOSICAO`).
- Conferência física é a ferramenta canônica para resolver divergência de saldo.