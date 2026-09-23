# 05 — Fluxo de Conferência do Enxoval

## 5.1 Tela otimizada para contagem física

Por item exibe:

- Código SAP + descrição.
- Quantidade no sistema (`qtdAtual`).
- Campo de quantidade física.
- Diferença (computada ao vivo).
- Status (OK / DIVERGENTE / PENDENTE).
- Última baixa do Goldbox (data + qtd).
- Se houve reposição depois da baixa.
- Se há reposição pendente.

## 5.2 Interações

- **Toque simples**: seleciona/percorre item (contagem rápida).
- **Toque longo**: abre modal de detalhe/correção.
- **Busca** por código ou descrição.
- **Filtros**: pendentes | divergentes | conferidos.

## 5.3 Modal de toque longo (item divergente)

Campos:

- Código, descrição, qtd sistema, qtd física, diferença.
- Última baixa Goldbox, reposição posterior, reposição pendente.
- **Quantidade disponível em peças avulsas** (mesmo código, mesmo depósito).
- Opção de tratamento (ver 5.5).
- Campo de observação.
- Confirmação digitando **matrícula**.

## 5.4 Registro da conferência

`inspections` + `inspection_items` conforme modelo. Grava `qtdSistema`, `qtdFisica`, `diferenca`, autor/matrícula, data/hora, status, observação, tipo de correção.

- Qualquer usuário (inclusive mecânico) pode conferir e propor correção.

## 5.5 Tipos de tratamento (correção)

| Tipo | Ação |
| ---- | ---- |
| `APENAS_REGISTRAR_DIVERGENCIA` | mantém divergência aberta, alerta dashboard |
| `CORRIGIR_COM_PECA_AVULSA` | ver 5.6, utilisa peça avulsa do mesmo depósito |
| `AGUARDAR_REPOSICAO` | marca pendência de reposição (almoxarifado) |
| `ACAO_LIDERANCA` | liderança/administrador ajusta |
| `OUTRA` | observação livre |

## 5.6 Correção com peça avulsa (transação atômica)

```
BEGIN
1. Verifica código SAP + depositoId da peça avulsa (mesmo depósito obrigatório).
2. Verifica quantidade disponível (sparePart.quantidadeAtual >= qtd).
3. Debitar peça avulsa (spare_part_movements USO_CORRECAO).
4. Creditar/ajustar enxoval (inventoryItems.qtdAtual += qtd).
5. Registrar correção (inspectionItems.correcaoRef).
6. Gerar audit log CORRECAO.
7. Associar à conferência.
COMMIT → em qualquer erro, ROLLBACK.
```

## 5.7 Estorno de correção

- **Nunca apagar a correção original.**
- Criar operação inversa (débito enxoval + crédito peça avulsa) registrando: operação revertida, motivo, usuário/matrícula, data, valores antes/depois.
- Gera audit log `ESTORNO`.

## 5.8 Edição de conferência finalizada

- Permitida por: **autor**, líder, administrador.
- Cria **nova revisão** (novo `inspection` com status `REVISADA`/nova) + novo log; a anterior é preservada.

## 5.9 Divergência automática

- Diferença ≠ 0 → `divergences` tipo `CONFERENCIA`, status `ABERTA`, aparece no dashboard.