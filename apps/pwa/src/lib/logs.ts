import type { AuditLogRow, LogTipo } from '@logenxoval/contracts';

export type LogGrupo = 'peca' | 'reposicao' | 'lideranca' | 'divergencia' | 'conferencia';

export const LOG_TIPO_LABEL: Record<LogTipo, string> = {
  LOGIN: 'Login',
  LOGOUT: 'Logout',
  BLOQUEIO_INATIVIDADE: 'Bloqueio por inatividade',
  TROCA_USUARIO: 'Troca de usuário',
  CADASTRO_USUARIO: 'Solicitação de cadastro',
  CRIACAO_USUARIO: 'Criação de usuário',
  EDICAO_USUARIO: 'Edição de usuário',
  BAIXA: 'Baixa (goldbox)',
  ESTORNO: 'Estorno de baixa',
  CONFERENCIA: 'Conferência física',
  CORRECAO: 'Correção de divergência',
  REPOSICAO: 'Reposição',
  ENTRADA_MATERIAL: 'Entrada de material (enxoval)',
  ENTRADA_ESTOQUE: 'Entrada de consumível/EPI',
  ENTRADA_PECA_AVULSA: 'Entrada de peça avulsa',
  SAIDA_PECA_AVULSA: 'Saída de peça avulsa',
  SUGESTAO_CRIADA: 'Sugestão de conversão criada',
  SUGESTAO_ACEITA: 'Sugestão aceita (conversão)',
  SUGESTAO_RECUSADA: 'Sugestão recusada',
  CONVERSAO_PECA_AVULSA: 'Conversão peça avulsa → enxoval',
  CRIACAO_DEPOSITO: 'Criação de depósito',
  EDICAO_DEPOSITO: 'Edição de depósito',
  DESATIVACAO_DEPOSITO: 'Desativação de depósito',
  DESIGNACAO_DEPOSITO: 'Depósito designado a usuário',
  REVOGACAO_DEPOSITO: 'Acesso a depósito revogado',
  IMPORTACAO_FOLHA: 'Importação de folha',
  PUBLICACAO_ENXOVAL: 'Publicação do enxoval',
  EDICAO_ENXOVAL: 'Edição do enxoval',
  RESTAURACAO: 'Restauração',
  SINCRONIZACAO: 'Sincronização',
  CONFLITO: 'Conflito de sincronização',
  DIVERGENCIA: 'Divergência',
  BACKUP_RESTAURACAO: 'Backup / restauração',
  SOLICITACAO_CRIADA: 'Solicitação criada',
  SOLICITACAO_ATUALIZADA: 'Solicitação atualizada',
  SOLICITACAO_ENVIADA: 'Solicitação enviada',
  SOLICITACAO_RECEBIDA: 'Solicitação recebida',
  SOLICITACAO_EXCLUIDA: 'Solicitação excluída',
};

export const LOG_GRUPO: Record<LogTipo, LogGrupo> = {
  LOGIN: 'lideranca',
  LOGOUT: 'lideranca',
  BLOQUEIO_INATIVIDADE: 'lideranca',
  TROCA_USUARIO: 'lideranca',
  CADASTRO_USUARIO: 'lideranca',
  CRIACAO_USUARIO: 'lideranca',
  EDICAO_USUARIO: 'lideranca',
  BAIXA: 'reposicao',
  ESTORNO: 'reposicao',
  CONFERENCIA: 'conferencia',
  CORRECAO: 'divergencia',
  REPOSICAO: 'reposicao',
  ENTRADA_MATERIAL: 'reposicao',
  ENTRADA_ESTOQUE: 'reposicao',
  ENTRADA_PECA_AVULSA: 'peca',
  SAIDA_PECA_AVULSA: 'peca',
  SUGESTAO_CRIADA: 'peca',
  SUGESTAO_ACEITA: 'peca',
  SUGESTAO_RECUSADA: 'peca',
  CONVERSAO_PECA_AVULSA: 'peca',
  CRIACAO_DEPOSITO: 'lideranca',
  EDICAO_DEPOSITO: 'lideranca',
  DESATIVACAO_DEPOSITO: 'lideranca',
  DESIGNACAO_DEPOSITO: 'lideranca',
  REVOGACAO_DEPOSITO: 'lideranca',
  IMPORTACAO_FOLHA: 'lideranca',
  PUBLICACAO_ENXOVAL: 'lideranca',
  EDICAO_ENXOVAL: 'lideranca',
  RESTAURACAO: 'lideranca',
  SINCRONIZACAO: 'conferencia',
  CONFLITO: 'divergencia',
  DIVERGENCIA: 'divergencia',
  BACKUP_RESTAURACAO: 'lideranca',
  SOLICITACAO_CRIADA: 'reposicao',
  SOLICITACAO_ATUALIZADA: 'reposicao',
  SOLICITACAO_ENVIADA: 'reposicao',
  SOLICITACAO_RECEBIDA: 'reposicao',
  SOLICITACAO_EXCLUIDA: 'reposicao',
};

export const GRUPO_LABEL: Record<LogGrupo, string> = {
  peca: 'Peça avulsa',
  reposicao: 'Reposição',
  lideranca: 'Liderança',
  divergencia: 'Divergência',
  conferencia: 'Conferência',
};

export const GRUPO_MARCA: Record<LogGrupo, string> = {
  peca: '🟠',
  reposicao: '🟢',
  lideranca: '🔵',
  divergencia: '🔴',
  conferencia: '⚪',
};

const GRUPO_ORDEM: LogGrupo[] = ['peca', 'reposicao', 'lideranca', 'divergencia', 'conferencia'];

export function grupoDeLog(tipo: LogTipo): LogGrupo {
  return LOG_GRUPO[tipo] ?? 'lideranca';
}

export function marcasUnicas(logs: AuditLogRow[]): string[] {
  const vistos = new Set<string>();
  const marcas: string[] = [];
  for (const g of GRUPO_ORDEM) {
    if (logs.some((l) => grupoDeLog(l.tipo) === g)) {
      vistos.add(g);
      marcas.push(GRUPO_MARCA[g]);
    }
  }
  return marcas;
}

export function chaveDoDia(iso: string): string {
  return iso.slice(0, 10);
}

export function chaveDoMes(iso: string): string {
  return iso.slice(0, 7);
}

export function agruparPorDia(logs: AuditLogRow[]): Map<string, AuditLogRow[]> {
  const mapa = new Map<string, AuditLogRow[]>();
  for (const l of logs) {
    const chave = chaveDoDia(l.dataHora);
    const atual = mapa.get(chave);
    if (atual) atual.push(l);
    else mapa.set(chave, [l]);
  }
  return mapa;
}

export interface DiaResumo {
  total: number;
  marcas: string[];
}

/** Resumo por dia (chave YYYY-MM-DD): contagem e marcas únicas ordenadas. */
export function resumirMes(logs: AuditLogRow[]): Map<string, DiaResumo> {
  const porDia = agruparPorDia(logs);
  const resumo = new Map<string, DiaResumo>();
  for (const [chave, diarios] of porDia) {
    resumo.set(chave, { total: diarios.length, marcas: marcasUnicas(diarios) });
  }
  return resumo;
}

export interface CelulaMes {
  /** YYYY-MM-DD quando dentro do mês; null para células vazias do grid. */
  iso: string | null;
  dia: number | null;
}

/** Malha do calendário mensal (seg a dom, 6 linhas) para ano/mês (0-11). */
export function malhaDoMes(ano: number, mes: number): CelulaMes[] {
  const primeiro = new Date(ano, mes, 1);
  const offset = (primeiro.getDay() + 6) % 7;
  const celulas: CelulaMes[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(ano, mes, 1 - offset + i);
    if (d.getMonth() !== mes) {
      celulas.push({ iso: null, dia: null });
    } else {
      const iso = `${ano}-${String(mes + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      celulas.push({ iso, dia: d.getDate() });
    }
  }
  return celulas;
}

export function nomeDoMes(ano: number, mes: number): string {
  return new Date(ano, mes, 1).toLocaleDateString('pt-BR', { month: 'long' });
}

export function formatarDataHora(iso: string): { data: string; hora: string } {
  const d = new Date(iso);
  const data = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  const hora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return { data, hora };
}

export interface FiltroLogs {
  grupo?: LogGrupo;
  matricula?: string;
  busca?: string;
}

/** Filtra logs por grupo de cor e matrícula/descrição. */
export function filtrarLogs(logs: AuditLogRow[], filtro: FiltroLogs): AuditLogRow[] {
  const q = (filtro.busca ?? '').trim().toLowerCase();
  return logs.filter((l) => {
    if (filtro.grupo && grupoDeLog(l.tipo) !== filtro.grupo) return false;
    if (filtro.matricula && !l.matricula.toLowerCase().includes(filtro.matricula.toLowerCase())) return false;
    if (q && !LOG_TIPO_LABEL[l.tipo].toLowerCase().includes(q) && !(l.motivo ?? '').toLowerCase().includes(q)) return false;
    return true;
  });
}