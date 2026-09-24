import type { RequestRow, RequestStatus, SolicitacaoTipo } from '@logenxoval/contracts';

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  RASCUNHO: 'Rascunho',
  PRONTA_PARA_ENVIO: 'Pronta p/ envio',
  ENVIADA: 'Enviada',
  RECEBIDA_PELA_LIDERANCA: 'Recebida pela liderança',
  APROVADA: 'Aprovada',
  ATENDIDA: 'Atendida',
  CANCELADA: 'Cancelada',
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
  lideranca: boolean;
  precisaPin: boolean;
};

/**
 * Ações disponíveis por estado da solicitação (espelho das transições do
 * servidor, docs 09/10.6). O dono comanda rascunho→pronta→envio; a liderança
 * recebe, aprova (com PIN) e atende.
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
        ? [
            { para: 'PRONTA_PARA_ENVIO', rotulo: 'Marcar pronta p/ envio', lideranca: false, precisaPin: false },
            { para: 'CANCELADA', rotulo: 'Cancelar', lideranca: false, precisaPin: false },
          ]
        : [];
    case 'PRONTA_PARA_ENVIO':
      return dono
        ? [
            { para: 'ENVIADA', rotulo: 'Enviar', lideranca: false, precisaPin: false },
            { para: 'CANCELADA', rotulo: 'Cancelar', lideranca: false, precisaPin: false },
          ]
        : [];
    case 'ENVIADA':
      return lideranca
        ? [{ para: 'RECEBIDA_PELA_LIDERANCA', rotulo: 'Receber pela liderança', lideranca: true, precisaPin: false }]
        : [];
    case 'RECEBIDA_PELA_LIDERANCA':
      return lideranca
        ? [{ para: 'APROVADA', rotulo: 'Aprovar com PIN', lideranca: true, precisaPin: true }]
        : [];
    case 'APROVADA':
      return lideranca
        ? [{ para: 'ATENDIDA', rotulo: 'Atender com PIN', lideranca: true, precisaPin: true }]
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