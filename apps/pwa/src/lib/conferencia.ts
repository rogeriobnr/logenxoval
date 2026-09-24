import type { InspectionItemRow, TipoCorrecao } from '@logenxoval/contracts';

export type FiltroConferencia = 'todos' | 'pendentes' | 'divergentes' | 'conferidos' | 'corrigidos';

export function statusDeItem(qtdSistema: number, qtdFisica: number): InspectionItemRow['status'] {
  return qtdFisica === qtdSistema ? 'OK' : 'DIVERGENTE';
}

export function filtrarItens(
  itens: InspectionItemRow[],
  filtro: FiltroConferencia,
  busca: string,
): InspectionItemRow[] {
  const q = busca.trim().toLowerCase();
  const base = filtro === 'todos' ? itens : itens.filter((i) => {
    switch (filtro) {
      case 'pendentes': return i.status === 'PENDENTE';
      case 'divergentes': return i.status === 'DIVERGENTE';
      case 'conferidos': return i.status === 'OK';
      case 'corrigidos': return i.corregido;
      default: return true;
    }
  });
  return q
    ? base.filter(
        (i) =>
          i.codigoSap.toLowerCase().includes(q) ||
          (i.materialId ?? '').toLowerCase().includes(q),
      )
    : base;
}

export function resumoDeItens(itens: InspectionItemRow[]) {
  return {
    total: itens.length,
    ok: itens.filter((i) => i.status === 'OK').length,
    divergentes: itens.filter((i) => i.status === 'DIVERGENTE').length,
    pendentes: itens.filter((i) => i.status === 'PENDENTE').length,
    corrigidos: itens.filter((i) => i.corregido).length,
  };
}

export const TIPO_CORRECAO_LABEL: Record<TipoCorrecao, string> = {
  APENAS_REGISTRAR_DIVERGENCIA: 'Só registrar divergência',
  CORRIGIR_COM_PECA_AVULSA: 'Corrigir com peça avulsa',
  AGUARDAR_REPOSICAO: 'Aguardar reposição (almoxarifado)',
  ACAO_LIDERANCA: 'Ação da liderança (ajuste)',
  OUTRA: 'Outra (observação)',
};

export const INSPECAO_STATUS_LABEL: Record<string, string> = {
  EM_ANDAMENTO: 'Em andamento',
  CONCLUIDA: 'Concluída',
  REVISADA: 'Revisada',
};