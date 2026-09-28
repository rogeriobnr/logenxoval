# 05 — Fluxo de Conferência do Enxoval

## 5.1 Tela otimizada para contagem física

Por item exibe:

- Código SAP + descrição.
- Quantidade do **enxoval lançado** (`qtdOficial`) e o valor **após baixas anteriores** (`qtdAtual`).
- Campo de quantidade física.
- Diferença (computada ao vivo).
- Status (OK / DIVERGENTE / PENDENTE).
- Se o físico ficou abaixo do sistema → marcado como **pendência de baixa**.

## 5.2 Interações

- **Toque simples**: seleciona/percorre item (contagem rápida).
- **Busca** por código ou descrição.
- **Filtros**: pendentes | divergentes | conferidos.

## 5.3 Registro conclui na hora (fase 20)

Ao tocar **Registrar e concluir conferência**, a conferência nasce `CONCLUIDA`
na mesma transação e **as divergências abrem automaticamente** no dashboard:

| Situação                          | Divergência criada                          |
| --------------------------------- | ------------------------------------------- |
| Físico < sistema (**falta**)      | `REPOSICAO` ABERTA, quantidade = diferença  |
| Físico > sistema (**sobra**)      | `CONFERENCIA` ABERTA, quantidade = diferença |
| Físico = sistema                  | nenhuma                                     |

- A `REPOSICAO` alimenta o card **"Reposições pendentes (almoxarifado)"** do
  dashboard e o dashboard do líder responsável pelo depósito (espelho
  multi-dispositivo, fase 19) — a pendência é resolvida pela entrada de material.
- A `REPOSICAO` é idempotente: uma por item com pendência **ABERTA**.
- Depois de registrar, a tela vai para o **Histórico**; o dashboard é
  atualizado com o espelho de divergências.

## 5.4 Histórico (somente leitura)

- Lista conferências (status, data/hora, total de itens, divergentes).
- Detalhe read-only: itens com lançado/sistema/física/diferença, pendência de
  baixa, reposição pendente/posterior e peça avulsa disponível quando houver.

> **Correções por item, estorno, finalizar e revisar** foram removidos do fluxo
> da conferência (fase 20). Os endpoints de servidor permanecem para
> compatibilidade; o tratamento de reposição passa a ser feito pela entrada de
> material (Goldbox) e a sobra vira divergência `CONFERENCIA` no dashboard.

## 5.5 Origem dos dados gravados

`inspections` + `inspection_items` conforme modelo. Grava `qtdSistema` (valor
após baixas anteriores), `qtdOficial` (enxoval lançado), `qtdFisica`,
`diferenca`, autor/matrícula, data/hora, status, observação. Quando
`qtdFisica < qtdSistema`, o item é marcado como **pendência de baixa**
(`pendenciaBaixa`) — a baixa do material ausente ainda precisa ser registrada
no Goldbox.

- Qualquer usuário (inclusive mecânico) pode registrar uma conferência.