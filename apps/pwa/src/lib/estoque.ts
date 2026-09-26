import type { RequestRow, RequestStatus, SolicitacaoTipo } from '@logenxoval/contracts';

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  RASCUNHO: 'Rascunho',
  ENVIADA: 'Enviada',
  RECEBIDA: 'Recebida',
  EXCLUIDA: 'Excluída',
};

export const SOLICITACAO_TIPO_LABEL: Record<SolicitacaoTipo, string> = {
  CONSUMIVEL: 'Consumíveis',
  EPI: 'EPIs',
};

export interface EstadoEstoque {
  codigo: string;
  descricao: string;
  estoqueAtual: number;
  estoqueMinimo: number;
  unidade: string;
}

export function resumoDeEstoque(rows: Array<Pick<EstadoEstoque, 'estoqueAtual' | 'estoqueMinimo'>>) {
  return {
    totalItens: rows.length,
    totalUnidades: rows.reduce((s, r) => s + r.estoqueAtual, 0),
    abaixoMinimo: rows.filter((r) => r.estoqueAtual < r.estoqueMinimo).length,
  };
}

export type AcaoSolicitacao = {
  para: RequestStatus;
  rotulo: string;
  danger?: boolean;
};

/**
 * Ações disponíveis por estado da solicitação (fluxo simplificado):
 * o dono compartilha (marca ENVIADA automaticamente após o compartilhamento),
 * a solicitação é marcada como RECEBIDA (com itens não recebidos) e pode ser
 * EXCLUIDA pelo dono ou pela liderança.
 */
export function acoesDaSolicitacao(
  req: RequestRow,
  perfil: string,
  usuarioId: string,
): AcaoSolicitacao[] {
  const lideranca = perfil === 'LIDER' || perfil === 'ADMIN';
  const dono = req.solicitanteId === usuarioId;
  switch (req.status) {
    case 'RASCUNHO':
      return dono
        ? [{ para: 'EXCLUIDA', rotulo: 'Excluir', danger: true }]
        : [];
    case 'ENVIADA':
      return dono || lideranca
        ? [
            { para: 'RECEBIDA', rotulo: 'Marcar recebido' },
            { para: 'EXCLUIDA', rotulo: 'Excluir', danger: true },
          ]
        : [];
    case 'RECEBIDA':
      return dono || lideranca
        ? [{ para: 'EXCLUIDA', rotulo: 'Excluir', danger: true }]
        : [];
    default:
      return [];
  }
}

/** Markdown copiável/compartilhável da solicitação (wireframe 10.6). */
export function solicitarMarkdown(req: RequestRow): string {
  const itens = req.itens
    .map((i) => `- ${i.qtd}x ${i.codigo} — ${i.descricao}`)
    .join('\n');
  return [
    `SOLICITAÇÃO Nº ${req.id.slice(0, 8).toUpperCase()}`,
    `Tipo: ${SOLICITACAO_TIPO_LABEL[req.tipo]}`,
    `Solicitante: ${req.matricula} (${req.solicitanteId})`,
    `Data: ${new Date(req.dataEm).toLocaleDateString('pt-BR')}`,
    `Status: ${REQUEST_STATUS_LABEL[req.status]}`,
    '',
    'Itens:',
    itens,
  ].join('\n');
}

export function filtrarPorBusca<T>(rows: T[], busca: string, texto: (row: T) => string): T[] {
  const q = busca.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => texto(r).toLowerCase().includes(q));
}