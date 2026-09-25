import type {
  AuditLogRow,
  ConsumableRow,
  DivergenceRow,
  GoldboxMovementRow,
  InspectionRow,
  InventoryItemRow,
  PpeItemRow,
  RequestRow,
} from '@logenxoval/contracts';
import { REQUEST_STATUS_LABEL, SOLICITACAO_TIPO_LABEL } from './estoque';
import { LOG_TIPO_LABEL } from './logs';

export interface colunasTabela {
  titulo: string;
  largura: number;
}

export interface RelatorioTabela {
  titulo: string;
  subtitulo: string;
  colunas: colunasTabela[];
  linhas: string[][];
  rodape?: string;
}

export interface FiltroRelatorio {
  dataIni?: string;
  dataFim?: string;
  codigo?: string;
}

const DIA = 24 * 60 * 60 * 1000;

export function formatarData(dataHora: string): string {
  const d = new Date(dataHora);
  return d.toLocaleDateString('pt-BR');
}

export function formatarDataHora(dataHora: string): string {
  const d = new Date(dataHora);
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

export function formatarNumero(n: number): string {
  return n.toLocaleString('pt-BR');
}

function dentroDoPeriodo(dataHora: string, f: FiltroRelatorio): boolean {
  if (f.dataIni && dataHora < f.dataIni) return false;
  if (f.dataFim) {
    const fimExclusivo = new Date(new Date(f.dataFim).getTime() + DIA).toISOString();
    if (dataHora >= fimExclusivo) return false;
  }
  return true;
}

function semAcento(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function filtraCodigo(grupos: string[], f: FiltroRelatorio): boolean {
  if (!f.codigo) return true;
  const alvo = semAcento(f.codigo.trim());
  return grupos.some((g) => semAcento(g).includes(alvo));
}

/** Relatório de enxoval atual — itens da versão publicada (docs 4.2). */
export function relatorioEnxoval(
  itens: InventoryItemRow[],
  nomeDeposito: string,
  numeroDeposito: string,
  versao?: string,
): RelatorioTabela {
  const linhas = [...itens]
    .sort((a, b) => a.codigoSap.localeCompare(b.codigoSap))
    .map((i) => [
      i.codigoSap,
      i.textoBreve,
      formatarNumero(i.qtdOficial),
      formatarNumero(i.qtdAtual),
      formatarNumero(i.estoqueMinimo ?? 0),
      i.utilizacaoLivre ? 'Livre' : 'Controlado',
      i.status,
    ]);
  return {
    titulo: 'Enxoval',
    subtitulo: `Depósito ${nomeDeposito} (${numeroDeposito})${versao ? ` · Versão ${versao}` : ''}`,
    colunas: [
      { titulo: 'Código SAP', largura: 24 },
      { titulo: 'Descrição', largura: 34 },
      { titulo: 'Oficial', largura: 12 },
      { titulo: 'Atual', largura: 12 },
      { titulo: 'Mín.', largura: 12 },
      { titulo: 'Uso', largura: 14 },
      { titulo: 'Status', largura: 14 },
    ],
    linhas,
    rodape: `${formataContagem(itens.length)} item(ns)`,
  };
}

/** Relatório de movimentações (baixa goldbox) — histórico com filtros (docs 4.5). */
export function relatorioMovimentacoes(
  movimentos: GoldboxMovementRow[],
  nomeDeposito: string,
  numeroDeposito: string,
  filtro: FiltroRelatorio = {},
): RelatorioTabela {
  const linhas = movimentos
    .filter((m) => dentroDoPeriodo(m.dataHora, filtro))
    .filter((m) => filtraCodigo([m.codigoSap, m.descricao ?? '', m.matricula], filtro))
    .map((m) => [
      formatarDataHora(m.dataHora),
      m.codigoSap,
      abbreviate(m.descricao ?? '', 26),
      m.reposicao ? 'Reposição' : m.estornoDe ? 'Estorno' : 'Baixa',
      formatarNumero(m.quantidade),
      m.matricula,
      m.dispositivo,
    ]);
  const soma = movimentos
    .filter((m) => dentroDoPeriodo(m.dataHora, filtro))
    .filter((m) => filtraCodigo([m.codigoSap, m.descricao ?? '', m.matricula], filtro))
    .reduce((acc, m) => acc + m.quantidade, 0);
  return {
    titulo: 'Movimentações (goldbox)',
    subtitulo: `Depósito ${nomeDeposito} (${numeroDeposito})${filtro.dataIni ? ` · de ${formatarData(filtro.dataIni)}` : ''}${filtro.dataFim ? ` a ${formatarData(filtro.dataFim)}` : ''}`,
    colunas: [
      { titulo: 'Quando', largura: 20 },
      { titulo: 'SAP', largura: 20 },
      { titulo: 'Descrição', largura: 26 },
      { titulo: 'Tipo', largura: 16 },
      { titulo: 'Qtd', largura: 10 },
      { titulo: 'Matrícula', largura: 18 },
      { titulo: 'Dispositivo', largura: 16 },
    ],
    linhas,
    rodape: `${formataContagem(linhas.length)} movimentação(ões) · total ${formatarNumero(soma)}`,
  };
}

/** Relatório de consumíveis — estoque atual × mínimo (docs 10.6). */
export function relatorioConsumiveis(
  consumiveis: ConsumableRow[],
  nomeDeposito: string,
  numeroDeposito: string,
  tipo = 'Consumíveis',
): RelatorioTabela {
  const linhas = consumiveis
    .slice()
    .sort((a, b) => a.codigo.localeCompare(b.codigo))
    .map((c) => [
      c.codigo,
      c.descricao,
      formatarNumero(c.estoqueAtual),
      formatarNumero(c.estoqueMinimo),
      c.estoqueAtual < c.estoqueMinimo ? 'Abaixo do mínimo' : 'Ok',
    ]);
  return {
    titulo: tipo,
    subtitulo: `Depósito ${nomeDeposito} (${numeroDeposito})`,
    colunas: [
      { titulo: 'Código', largura: 18 },
      { titulo: 'Descrição', largura: 42 },
      { titulo: 'Estoque', largura: 14 },
      { titulo: 'Mínimo', largura: 14 },
      { titulo: 'Situação', largura: 26 },
    ],
    linhas,
    rodape: `${formataContagem(consumiveis.length)} item(ns) · ${formataContagem(consumiveis.filter((c) => c.estoqueAtual < c.estoqueMinimo).length)} abaixo do mínimo`,
  };
}

export function relatorioEpi(
  ppe: PpeItemRow[],
  nomeDeposito: string,
  numeroDeposito: string,
): RelatorioTabela {
  return relatorioConsumiveis(ppe as unknown as ConsumableRow[], nomeDeposito, numeroDeposito, 'EPIs');
}

/** Relatório de solicitações (docs 10.6) e conferências (docs 4.6). */
export function relatorioSolicitacoes(
  requests: RequestRow[],
  nomeDeposito: string,
  numeroDeposito: string,
  filtro: FiltroRelatorio = {},
): RelatorioTabela {
  const linhas = requests
    .filter((r) => dentroDoPeriodo(r.dataEm, filtro))
    .filter((r) => filtraCodigo([r.matricula, SOLICITACAO_TIPO_LABEL[r.tipo], r.itens.map((i) => i.codigo).join(' ')], filtro))
    .sort((a, b) => b.dataEm.localeCompare(a.dataEm))
    .map((r) => [
      formatarDataHora(r.dataEm),
      SOLICITACAO_TIPO_LABEL[r.tipo],
      r.matricula,
      r.itens.map((i) => `${i.qtd}x ${i.codigo}`).join(' · '),
      REQUEST_STATUS_LABEL[r.status],
    ]);
  return {
    titulo: 'Solicitações',
    subtitulo: `Depósito ${nomeDeposito} (${numeroDeposito})`,
    colunas: [
      { titulo: 'Quando', largura: 20 },
      { titulo: 'Tipo', largura: 16 },
      { titulo: 'Matrícula', largura: 16 },
      { titulo: 'Itens', largura: 36 },
      { titulo: 'Status', largura: 20 },
    ],
    linhas,
    rodape: `${formataContagem(linhas.length)} solicitação(ões)`,
  };
}

/** Relatório de log de auditoria (docs 4.8 — calendário). */
export function relatorioAuditLogs(
  logs: AuditLogRow[],
  nomeDeposito: string,
  numeroDeposito: string,
  filtro: FiltroRelatorio = {},
): RelatorioTabela {
  const linhas = logs
    .filter((l) => dentroDoPeriodo(l.dataHora, filtro))
    .filter((l) => filtraCodigo([l.tipo, l.matricula ?? '', l.motivo ?? '', l.entidade], filtro))
    .map((l) => [
      formatarDataHora(l.dataHora),
      LOG_TIPO_LABEL[l.tipo as keyof typeof LOG_TIPO_LABEL] ?? l.tipo,
      l.matricula ?? '',
      abbreviate(l.motivo ?? l.entidade, 40),
    ]);
  return {
    titulo: 'Log de auditoria',
    subtitulo: `Depósito ${nomeDeposito} (${numeroDeposito})`,
    colunas: [
      { titulo: 'Quando', largura: 20 },
      { titulo: 'Tipo', largura: 28 },
      { titulo: 'Matrícula', largura: 18 },
      { titulo: 'Detalhe', largura: 44 },
    ],
    linhas,
    rodape: `${formataContagem(linhas.length)} registro(s)`,
  };
}

/** Relatório de conferências (docs 4.6). */
export function relatorioConferencias(
  conferencias: InspectionRow[],
  nomeDeposito: string,
  numeroDeposito: string,
  filtro: FiltroRelatorio = {},
): RelatorioTabela {
  const linhas = conferencias
    .filter((c) => dentroDoPeriodo(c.dataEm, filtro))
    .sort((a, b) => b.dataEm.localeCompare(a.dataEm))
    .map((c) => [
      formatarDataHora(c.dataEm),
      c.matricula,
      c.versaoEnxoval,
      c.status,
      abbreviate(c.observacao ?? '', 36),
    ]);
  return {
    titulo: 'Conferências',
    subtitulo: `Depósito ${nomeDeposito} (${numeroDeposito})`,
    colunas: [
      { titulo: 'Quando', largura: 20 },
      { titulo: 'Matrícula', largura: 18 },
      { titulo: 'Versão', largura: 18 },
      { titulo: 'Status', largura: 18 },
      { titulo: 'Observação', largura: 36 },
    ],
    linhas,
    rodape: `${formataContagem(linhas.length)} conferência(s)`,
  };
}

/** Relatório de divergências abertas (docs 4.6). */
export function relatorioDivergencias(
  divergencias: DivergenceRow[],
  nomeDeposito: string,
  numeroDeposito: string,
  filtro: FiltroRelatorio = {},
): RelatorioTabela {
  const linhas = divergencias
    .filter((d) => dentroDoPeriodo(d.criadoEm, filtro))
    .filter((d) => filtraCodigo([d.codigoSap, d.tipo], filtro))
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
    .map((d) => [
      formatarDataHora(d.criadoEm),
      d.codigoSap,
      d.tipo,
      formatarNumero(d.quantidade),
      d.status,
      d.criadoPor,
    ]);
  return {
    titulo: 'Divergências abertas',
    subtitulo: `Depósito ${nomeDeposito} (${numeroDeposito})`,
    colunas: [
      { titulo: 'Quando', largura: 20 },
      { titulo: 'SAP', largura: 20 },
      { titulo: 'Tipo', largura: 16 },
      { titulo: 'Qtd', largura: 10 },
      { titulo: 'Status', largura: 18 },
      { titulo: 'Criado por', largura: 18 },
    ],
    linhas,
    rodape: `${formataContagem(linhas.length)} divergência(s)`,
  };
}

export function formataContagem(n: number): string {
  return n.toLocaleString('pt-BR');
}

export function abbreviate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function novaTabela(titulo: string, subtitulo: string, colunas: string[], linhas: string[][]): RelatorioTabela {
  return {
    titulo,
    subtitulo,
    colunas: colunas.map((t) => ({ titulo: t, largura: 100 / colunas.length })),
    linhas,
  };
}