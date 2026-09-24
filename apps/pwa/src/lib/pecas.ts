import type { OrigemSparePart, SparePartRow, SugestaoStatus, TipoMovimentacaoSparePart } from '@logenxoval/contracts';

export const ORIGEM_SPARE_PART_LABEL: Record<OrigemSparePart, string> = {
  BACKLOG: 'Backlog (material parado)',
  OUTRA_FRENTE: 'Sobra de outra frente',
  COMPRA_DEBITO_DIRETO: 'Compra com débito direto',
  LIDERANCA: 'Alocado pela liderança',
  OUTRO: 'Outro',
};

export const TIPO_MOVIMENTO_PECA_LABEL: Record<TipoMovimentacaoSparePart, string> = {
  ENTRADA: 'Entrada',
  SAIDA: 'Saída',
  USO_CORRECAO: 'Uso em correção',
  TRANSFERENCIA_INFORMATIVA: 'Transferência informativa',
  CONVERSAO_ACEITA: 'Conversão aceita',
  DESCARTE: 'Descarte',
  AJUSTE_AUTORIZADO: 'Ajuste autorizado',
  DEVOLUCAO_CORRECAO: 'Devolução de correção',
};

export const SUGESTAO_STATUS_LABEL: Record<SugestaoStatus, string> = {
  PENDENTE: 'Pendente',
  ACEITA: 'Aceita',
  RECUSADA: 'Recusada',
  CANCELADA: 'Cancelada',
  EXPIRADA: 'Expirada',
};

/** Quantidade sugerida de conversão: nunca passa do disponível nem do déficit da lista. */
export function qtdSugerida(disponivelPecas: number, qtdPrevistaLista: number, qtdAtualLista: number): number {
  const deficit = Math.max(0, qtdPrevistaLista - qtdAtualLista);
  if (deficit <= 0 || disponivelPecas <= 0) return 0;
  return Math.min(disponivelPecas, deficit);
}

export interface FiltroPecas {
  busca: string;
  soComSaldo: boolean;
}

export function filtrarPecas(pecas: SparePartRow[], filtro: FiltroPecas): SparePartRow[] {
  const q = filtro.busca.trim().toLowerCase();
  return pecas.filter((p) => {
    if (filtro.soComSaldo && p.quantidadeAtual <= 0) return false;
    if (!q) return true;
    return (
      p.codigoSap.toLowerCase().includes(q) ||
      p.descricao.toLowerCase().includes(q) ||
      (p.observacao ?? '').toLowerCase().includes(q)
    );
  });
}

export function resumoDePecas(pecas: SparePartRow[]) {
  return {
    total: pecas.length,
    totalItens: pecas.reduce((s, p) => s + p.quantidadeAtual, 0),
    comSaldo: pecas.filter((p) => p.quantidadeAtual > 0).length,
  };
}