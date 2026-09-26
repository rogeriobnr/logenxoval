import type {
  DepositoStatus, DivergenciaStatus, DivergenciaTipo, InspectionItemStatus, InspectionStatus,
  ItemStatus, LogTipo, OrigemMovimentacao, OrigemSparePart, Perfil, RequestStatus,
  SolicitacaoTipo, SugestaoStatus, SyncStatus, TipoCorrecao, TipoMovimentacaoEstoque,
  TipoMovimentacaoSparePart, UserStatus, VersionStatus,
} from './enums.js';

/** Timestamp ISO-8601 UTC. */
export type ISO = string;

/** UUID gerado no device — chave de idempotência de operações distribuídas. */
export type OperationId = string;

export interface UserRow {
  id: string;
  matricula: string;
  nome: string;
  sobrenome: string;
  email?: string | null;
  perfil: Perfil;
  status: UserStatus;
  temPin: boolean;
  criadoEm: ISO;
  atualizadoEm: ISO;
}

export interface SessionRow {
  id: string;
  userId: string;
  deviceId: string;
  tokenHash: string;
  criadoEm: ISO;
  expiresAt: ISO;
  lastActivityAt: ISO;
}

export interface DepositoRow {
  id: string;
  numero: string;
  nome: string;
  status: DepositoStatus;
  criadoPor: string;
  criadoEm: ISO;
  alteradoPor?: string;
  alteradoEm?: ISO;
  versaoAtualEnxoval?: string;
}

export interface DepositVersionRow {
  id: string;
  depositoId: string;
  versao: number;
  dataEm: ISO;
  usuarioId: string;
  matricula: string;
  documentoId?: string;
  alteracoes: unknown;
  motivo?: string;
  refFolha?: string;
  hashDocumento?: string;
  status: VersionStatus;
}

export interface InventoryItemRow {
  id: string;
  depositoId: string;
  codigoSap: string;
  materialId?: string;
  textoBreve: string;
  foto?: string;
  qtdOficial: number;
  qtdAtual: number;
  utilizacaoLivre: boolean;
  valorUnitario?: number;
  valorTotal?: number;
  unidadeMedida?: string;
  estoqueMinimo?: number;
  status: ItemStatus;
  versao: string;
  criadoEm: ISO;
  atualizadoEm: ISO;
  usuarioResponsavel: string;
  /** Espelho do payload original do snapshot — replay semântico. */
  payloadHash?: string;
}

export interface GoldboxMovementRow {
  id: string;
  operationId: OperationId;
  depositoId: string;
  codigoSap: string;
  materialId?: string;
  descricao?: string;
  quantidade: number;
  dataHora: ISO;
  usuarioId: string;
  nomeCompleto: string;
  matricula: string;
  reposicao: boolean;
  /** BAIXA (débito) ou ENTRADA (crédito de reposição/recebimento). */
  tipo?: 'BAIXA' | 'ENTRADA';
  origem: OrigemMovimentacao;
  dispositivo: string;
  statusSync?: 'ENVIADO' | 'PENDENTE';
  assinaturaMatricula?: string;
  estornoDe?: OperationId;
}

export interface SparePartRow {
  id: string;
  depositoId: string;
  foto?: string;
  codigoSap: string;
  descricao: string;
  quantidadeAtual: number;
  origem: OrigemSparePart;
  dataEntrada: ISO;
  responsavel: string;
  observacao?: string;
  status: 'ATIVO' | 'INATIVO';
}

export interface SparePartMovementRow {
  id: string;
  depositoId: string;
  sparePartId: string;
  operationId: OperationId;
  tipo: TipoMovimentacaoSparePart;
  quantidade: number;
  dataHora: ISO;
  usuarioId: string;
  matricula: string;
  motivo?: string;
  estadoAnterior?: unknown;
  estadoPosterior?: unknown;
}

export interface ConsumableRow {
  id: string;
  depositoId: string;
  foto?: string;
  codigo: string;
  descricao: string;
  quantidade: number;
  unidade: string;
  estoqueAtual: number;
  estoqueMinimo: number;
  historico: unknown[];
}

export interface ConsumableMovementRow {
  id: string;
  consumableId: string;
  depositoId: string;
  operationId: OperationId;
  tipo: TipoMovimentacaoEstoque;
  quantidade: number;
  dataHora: ISO;
  usuarioId: string;
  matricula: string;
  motivo?: string;
}

export interface PpeItemRow {
  id: string;
  depositoId: string;
  foto?: string;
  codigo: string;
  descricao: string;
  quantidade: number;
  unidade: 'unidade';
  estoqueAtual: number;
  estoqueMinimo: number;
  historico: unknown[];
}

export interface PpeMovementRow {
  id: string;
  ppeItemId: string;
  depositoId: string;
  operationId: OperationId;
  tipo: TipoMovimentacaoEstoque;
  quantidade: number;
  dataHora: ISO;
  usuarioId: string;
  matricula: string;
  motivo?: string;
}

export interface RequestRow {
  id: string;
  depositoId: string;
  tipo: SolicitacaoTipo;
  solicitanteId: string;
  matricula: string;
  status: RequestStatus;
  dataEm: ISO;
  itens: Array<{ qtd: number; descricao: string; codigo: string }>;
}

export interface InspectionRow {
  id: string;
  depositoId: string;
  versaoEnxoval: string;
  autorId: string;
  matricula: string;
  dataEm: ISO;
  hora: string;
  status: InspectionStatus;
  observacao?: string;
  tipoCorrecao?: TipoCorrecao;
  revisaoDe?: string;
}

export interface InspectionItemRow {
  id: string;
  inspectionId: string;
  depositoId: string;
  codigoSap: string;
  materialId?: string;
  qtdSistema: number;
  qtdFisica: number;
  diferenca: number;
  status: InspectionItemStatus;
  observacao?: string;
  ultimaBaixaGoldbox?: { operationId: string; dataHora: ISO; quantidade: number };
  reposicaoPosterior?: boolean;
  reposicaoPendente?: boolean;
  corregido: boolean;
  correcaoRef?: OperationId;
}

export interface ConversionSuggestionRow {
  id: string;
  depositoId: string;
  codigoSap: string;
  descricao: string;
  qtdDisponivelPecas: number;
  qtdPrevistaLista: number;
  qtdSugerida: number;
  status: SugestaoStatus;
  motivo?: string;
  criadoPor: string;
  versaoEnxoval: string;
  processadaOperationId?: OperationId;
}

export interface DivergenceRow {
  id: string;
  depositoId: string;
  codigoSap: string;
  tipo: DivergenciaTipo;
  quantidade: number;
  status: DivergenciaStatus;
  origemOperationId?: OperationId;
  inspecaoId?: string;
  criadoEm: ISO;
  criadoPor: string;
  resolvidoEm?: ISO;
  resolvidoPor?: string;
}

export interface AuditLogRow {
  id: string;
  tipo: LogTipo;
  dataHora: ISO;
  usuarioId: string;
  matricula: string;
  depositoId?: string;
  entidade: string;
  operacaoId?: OperationId;
  estadoAnterior?: unknown;
  estadoPosterior?: unknown;
  motivo?: string;
  origem: OrigemMovimentacao;
  dispositivo: string;
  hash: string;
}

export interface SnapshotRow {
  id: string;
  depositoId: string;
  titulo: string;
  tipo: 'ANTES' | 'DEPOIS';
  motivo?: string;
  usuarioId: string;
  matricula: string;
  dataEm: ISO;
  payload: unknown;
}

export interface DocumentRow {
  id: string;
  depositoId: string;
  tipo: 'FOTO' | 'PDF';
  nome: string;
  mime: string;
  tamanho: number;
  hashDocumento: string;
  bytes?: Blob | Buffer;
  criadoEm: ISO;
  usuarioId: string;
  matricula: string;
}

export interface SyncQueueRow {
  id: string;
  operationId: OperationId;
  entidade: string;
  acao: 'CREATE' | 'UPDATE';
  payload: unknown;
  criadoEm: ISO;
  tentativas: number;
  proximaTentativaEm: ISO;
  status: 'PENDENTE' | 'ENVIANDO' | 'ERRO' | 'ENVIADO';
  erro?: string;
}

export interface SettingsRow {
  chave: string;
  valor: unknown;
  depositoId?: string;
}

export interface SessionLocal {
  userId: string;
  matricula: string;
  nomeCompleto: string;
  perfil: string;
  depositosAutorizados: string[];
  depositoAtivo: string;
  token?: string;
  refreshToken?: string;
  saltLocal: string;
  loginEm: ISO;
  expiresAt: ISO;
  lastActivityAt: ISO;
}

export interface SyncStateRow {
  deviceId: string;
  depositoId: string;
  lastSyncAt: ISO;
  status: SyncStatus;
  ultimaDivergenciaNaoLida?: ISO;
}

export interface SyncOperation {
  operationId: OperationId;
  entidade: string;
  acao: 'CREATE' | 'UPDATE';
  payload: Record<string, unknown>;
}

export interface SyncResponse {
  acks: Array<{ operationId: OperationId; status: 'OK' | 'JA_PROCESSADO' }>;
  conflicts: Array<{ operationId: OperationId; tipo: string; detalhe?: string }>;
  errors: Array<{ operationId: OperationId; code: string; message?: string }>;
  changed: {
    inventoryItems: InventoryItemRow[];
    versions: DepositVersionRow[];
    goldboxMovements: GoldboxMovementRow[];
    spareParts: SparePartRow[];
    consumables: ConsumableRow[];
    ppeItems: PpeItemRow[];
    divergences: DivergenceRow[];
    settings: Array<{ chave: string; valor: unknown }>;
    bloqueado?: boolean;
  };
}