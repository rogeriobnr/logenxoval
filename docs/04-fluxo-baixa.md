# 04 — Fluxo de Baixa (Goldbox)

## 4.1 Regras

- Baixa afeta **sempre o depósito ativo** do usuário. Tu nunca escolhe outro depósito na baixa.
- Isolamento: `depositoId` é fixo na operação; servidor valida contra depósito autorizado.
- **Saldo pode ficar negativo.** Se ficar `< 0`:
  1. cria `divergences` (tipo `SALDO_NEGATIVO`);
  2. alerta no dashboard;
  3. audit log;
  4. pendência de conferência/reposição.
- `reposicao` (sim/não) é campo obrigatório da baixa.

## 4.2 Passos (tela única com etapas)

```
1. Seleciona item do enxoval (busca por código/descrição).
2. Informa quantidade (>=1).
3. Informa se precisa reposição (sim/não).
4. Visualiza resumo: código, descrição, qtd, depósito, saldo após.
5. Digita a própria matrícula (confirmação crítica).
6. Valida matrícula local (e servidor na sync).
7. Registra baixa no IndexedDB → atualiza saldo local (qtdAtual -= qtd).
8. Gera evento goldbox (origem ONLINE|OFFLINE conforme rede).
9. Coloca operação na fila syncQueue se offline.
10. Log BAIXA.
```

## 4.3 Idempotência

- `operationId` UUID criado no device no passo 7 (antes de qualquer rede).
- Se o usuário reenviar, o servidor detecta `operationId` em `processedOperations` e **não aplica novamente**; responde ACK já processado.

## 4.4 Estorno

- Operação inversa: novo `goldboxMovements` com `estornoDe = operationId original` e quantidade positiva (ou sinal invertido no cálculo).
- Nunca apaga a original; gera audit log `ESTORNO`.
- Só liderança/administrador podem estornar (ver matriz de permissões). Estorno exige matrícula + motivo.

## 4.5 Histórico e exportação

- Filtros: data inicial/final, código SAP, usuário, depósito, reposição, tipo de movimentação.
- Exportação PDF/PNG gerada **localmente** (jsPDF/canvas), sem rede.
- JSON/CSV para backup técnico.