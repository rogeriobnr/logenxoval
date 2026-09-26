import type { InventoryItemRow } from '@logenxoval/contracts';

export type AnaliseBaixa =
  | { status: 'sem_item' }
  | { status: 'item'; disponivel: number; validada: boolean; aposBaixa: number; vaiNegativar: boolean };

/**
 * Analisa a baixa em digitação contra o item selecionado (UX do goldbox):
 * mostra o saldo disponível e avisa quando o valor digitado negativaria o item.
 */
export function analisarBaixa(item: InventoryItemRow | null, quantidade: string): AnaliseBaixa {
  if (!item) return { status: 'sem_item' };
  const qtd = Number(quantidade);
  const disponivel = item.qtdAtual ?? 0;
  const validada = Number.isFinite(qtd) && qtd > 0;
  return {
    status: 'item',
    disponivel,
    validada,
    aposBaixa: validada ? disponivel - qtd : disponivel,
    vaiNegativar: validada && disponivel - qtd < 0,
  };
}