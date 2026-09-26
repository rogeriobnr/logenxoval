import { z } from 'zod';
import {
  DEPOSITO_STATUS,
  ITEM_STATUS,
  LOG_TIPO,
  ORIGEM_SPARE_PART,
  PERFIL,
  REQUEST_STATUS,
  SOLICITACAO_TIPO,
  SUGESTAO_STATUS,
  TIPO_CORRECAO,
  TIPO_MOVIMENTACAO_SPARE_PART,
  USER_STATUS,
} from './enums.js';

const iso = z.string().datetime({ offset: true }).or(z.string());
export const operationId = z.string().uuid().or(z.string().min(8).max(64));
export const depositoIdSchema = z.string().min(1).max(64);
export const matriculaSchema = z.string().min(3).max(40);
export const codigoSapSchema = z.string().trim().min(1).max(40);
export const quantidadeSchema = z.number().int().positive();
/** PIN de usuário: 4 a 6 dígitos. */
export const pinSchema = z.string().regex(/^\d{4,6}$/);
export const emailSchema = z.string().trim().email().max(254);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export const loginBodySchema = z.object({
  matricula: matriculaSchema,
  senha: z.string().min(1),
  deviceId: z.string().min(8).max(128),
});

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(1),
  deviceId: z.string().min(8).max(128),
});

export const logoutBodySchema = z.object({
  deviceId: z.string().min(8).max(128),
});

export const changePasswordBodySchema = z.object({
  senhaAtual: z.string().min(1),
  novaSenha: z.string().min(8),
});

export const changePinBodySchema = z.object({
  pinAtual: z.union([pinSchema, z.literal('')]),
  novoPin: pinSchema,
});

export const forgotPasswordBodySchema = z.object({
  email: emailSchema,
});

export const resetPasswordBodySchema = z.object({
  token: z.string().min(20).max(512),
  novaSenha: z.string().min(8),
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export const createUserBodySchema = z.object({
  nome: z.string().trim().min(2),
  sobrenome: z.string().trim().min(2),
  matricula: matriculaSchema,
  email: emailSchema,
  senha: z.string().min(8),
  perfil: z.enum([PERFIL.MECANICO, PERFIL.LIDER, PERFIL.ADMIN]),
  pin: pinSchema,
});

export const updateUserBodySchema = z.object({
  status: z.enum([USER_STATUS.ATIVO, USER_STATUS.BLOQUEADO]).optional(),
  perfil: z.enum([PERFIL.MECANICO, PERFIL.LIDER, PERFIL.ADMIN]).optional(),
  novoPin: pinSchema.optional(),
});

/** Cadastro público (auto-atendimento): nasce PENDENTE até aprovação do admin. */
export const registerUserBodySchema = z.object({
  nome: z.string().trim().min(2),
  sobrenome: z.string().trim().min(2),
  matricula: matriculaSchema,
  email: emailSchema,
  senha: z.string().min(8),
  perfil: z.enum([PERFIL.MECANICO, PERFIL.LIDER]),
  pin: pinSchema,
});

export const grantUserDepositBodySchema = z.object({
  depositoId: depositoIdSchema,
  matriculaConfirmacao: matriculaSchema,
  pin: z.string().optional(),
});

export const revokeUserDepositBodySchema = z.object({
  matriculaConfirmacao: matriculaSchema,
  pin: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Depósitos
// ---------------------------------------------------------------------------
export const createDepositoBodySchema = z.object({
  numero: z.string().regex(/^\d{4}$/, 'Número do depósito deve ter 4 dígitos'),
  nome: z.string().trim().min(2).max(120),
  matriculaConfirmacao: matriculaSchema,
});

export const updateDepositoBodySchema = z.object({
  nome: z.string().trim().min(2).max(120).optional(),
  matriculaConfirmacao: matriculaSchema,
  pin: z.string().optional(),
});

export const deactivateDepositoBodySchema = z.object({
  matriculaConfirmacao: matriculaSchema,
  pin: z.string().optional(),
  motivo: z.string().trim().min(5),
});

// ---------------------------------------------------------------------------
// Enxoval
// ---------------------------------------------------------------------------
export const inventoryItemSchema = z.object({
  codigoSap: codigoSapSchema,
  materialId: z.string().optional(),
  textoBreve: z.string().trim().min(1).max(200),
  foto: z.string().optional(),
  qtdOficial: z.number().int().min(0),
  qtdAtual: z.number().int(),
  utilizacaoLivre: z.boolean(),
  valorUnitario: z.number().nonnegative().optional(),
  valorTotal: z.number().nonnegative().optional(),
  unidadeMedida: z.string().trim().max(20).optional(),
  estoqueMinimo: z.number().int().min(0).optional(),
  status: z.enum([
    ITEM_STATUS.ATIVO,
    ITEM_STATUS.INATIVO,
    ITEM_STATUS.REMOVIDO_DA_LISTA_OFICIAL,
    ITEM_STATUS.ALTERADO,
    ITEM_STATUS.PENDENTE_DE_REVISAO,
  ]).default(ITEM_STATUS.ATIVO),
});

export const importEnxovalBodySchema = z.object({
  documentoId: z.string().optional(),
  refFolha: z.string().optional(),
  motivo: z.string().trim().min(5),
  matriculaConfirmacao: matriculaSchema,
  pin: z.string().optional(),
  itens: z.array(inventoryItemSchema).min(1),
});

// ---------------------------------------------------------------------------
// Snapshots / restauração (docs 15)
// ---------------------------------------------------------------------------
export const restoreSnapshotBodySchema = z.object({
  motivo: z.string().trim().min(5),
  matriculaConfirmacao: matriculaSchema,
  pin: z.string().optional(),
});

export const snapshotIdParamSchema = z.object({
  depositoId: depositoIdSchema,
  snapshotId: z.string().min(1).max(64),
});

// ---------------------------------------------------------------------------
// Goldbox (baixa)
// ---------------------------------------------------------------------------
export const baixaBodySchema = z.object({
  operationId,
  codigoSap: codigoSapSchema,
  materialId: z.string().optional(),
  descricao: z.string().trim().max(200).optional(),
  quantidade: quantidadeSchema,
  reposicao: z.boolean(),
  origem: z.enum(['ONLINE', 'OFFLINE']),
  dispositivo: z.string().min(1),
  dataHora: iso,
  assinaturaMatricula: z.string().min(3),
  /** Confirmação crítica digitada pelo usuário — validada contra o usuário logado. */
  matriculaConfirmacao: matriculaSchema.optional(),
});

export const estornoBodySchema = z.object({
  operationId,
  operationIdOriginal: operationId,
  motivo: z.string().trim().min(5),
  assinaturaMatricula: z.string().min(3),
  pin: z.string().optional(),
  matriculaConfirmacao: matriculaSchema.optional(),
});

/** Entrada de material no enxoval (reposição recebida — credita o saldo e fecha divergência REPOSICAO). */
export const entradaMaterialBodySchema = z.object({
  operationId,
  codigoSap: codigoSapSchema,
  materialId: z.string().optional(),
  descricao: z.string().trim().max(200).optional(),
  quantidade: quantidadeSchema,
  observacao: z.string().trim().max(300).optional(),
  origem: z.enum(['ONLINE', 'OFFLINE']),
  dispositivo: z.string().min(1),
  dataHora: iso,
  assinaturaMatricula: z.string().min(3),
  /** Confirmação crítica digitada pelo usuário — validada contra o usuário logado. */
  matriculaConfirmacao: matriculaSchema.optional(),
});

export const goldboxQuerySchema = z.object({
  dataIni: iso.optional(),
  dataFim: iso.optional(),
  codigoSap: codigoSapSchema.optional(),
  usuario: matriculaSchema.optional(),
  reposicao: z.enum(['true', 'false']).optional(),
  tipo: z.enum(['BAIXA', 'ESTORNO', 'ENTRADA']).optional(),
});

export const logsQuerySchema = z.object({
  dataIni: iso.optional(),
  dataFim: iso.optional(),
  tipo: z.enum(Object.values(LOG_TIPO) as [string, ...string[]]).optional(),
  matricula: matriculaSchema.optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
});

export type LogsQuery = z.infer<typeof logsQuerySchema>;

/** Payload de uma baixa enviada pela fila offline (docs 8/11). */
export const syncPayloadBaixaSchema = baixaBodySchema.omit({ operationId: true }).extend({
  depositoId: z.string().min(1),
});

/** Payload de uma entrada de material (reposição de enxoval) enviada pela fila offline. */
export const syncPayloadEntradaMaterialSchema = entradaMaterialBodySchema
  .omit({ operationId: true })
  .extend({ depositoId: z.string().min(1) });

// ---------------------------------------------------------------------------
// Peças avulsas e sugestões de conversão
// ---------------------------------------------------------------------------
export const sparePartEntradaBodySchema = z.object({
  operationId,
  codigoSap: codigoSapSchema,
  descricao: z.string().trim().min(1).max(200),
  foto: z.string().optional(),
  origem: z.enum([
    ORIGEM_SPARE_PART.BACKLOG,
    ORIGEM_SPARE_PART.OUTRA_FRENTE,
    ORIGEM_SPARE_PART.COMPRA_DEBITO_DIRETO,
    ORIGEM_SPARE_PART.LIDERANCA,
    ORIGEM_SPARE_PART.OUTRO,
  ]),
  quantidade: quantidadeSchema,
  observacao: z.string().trim().max(200).optional(),
  assinaturaMatricula: z.string().min(3),
  matriculaConfirmacao: matriculaSchema.optional(),
});

const TIPOS_MOVIMENTO_PECA = [
  TIPO_MOVIMENTACAO_SPARE_PART.SAIDA,
  TIPO_MOVIMENTACAO_SPARE_PART.USO_CORRECAO,
  TIPO_MOVIMENTACAO_SPARE_PART.TRANSFERENCIA_INFORMATIVA,
  TIPO_MOVIMENTACAO_SPARE_PART.DESCARTE,
  TIPO_MOVIMENTACAO_SPARE_PART.AJUSTE_AUTORIZADO,
] as const;
export type TipoMovimentoPeca = (typeof TIPOS_MOVIMENTO_PECA)[number];

export const sparePartMovimentoBodySchema = z.object({
  operationId,
  tipo: z.enum(TIPOS_MOVIMENTO_PECA),
  quantidade: quantidadeSchema.optional(),
  novoSaldo: z.number().int().min(0).optional(),
  motivo: z.string().trim().min(2).max(300).optional(),
  pin: z.string().optional(),
  assinaturaMatricula: z.string().min(3),
  matriculaConfirmacao: matriculaSchema.optional(),
});

export const respondSuggestionBodySchema = z.object({
  operationId,
  acao: z.enum([SUGESTAO_STATUS.ACEITA, SUGESTAO_STATUS.RECUSADA]),
  motivo: z.string().trim().min(2).optional(),
  assinaturaMatricula: z.string().min(3),
  matriculaConfirmacao: matriculaSchema.optional(),
});

export const syncPayloadSparePartEntradaSchema = sparePartEntradaBodySchema
  .omit({ operationId: true })
  .extend({ depositoId: z.string().min(1) });

export const syncPayloadSparePartSaidaSchema = sparePartMovimentoBodySchema
  .omit({ operationId: true })
  .extend({
    depositoId: z.string().min(1),
    sparePartId: z.string().min(1),
  });

export const syncPayloadSugestaoRespostaSchema = z.object({
  depositoId: z.string().min(1),
  suggestionId: z.string().min(1),
  acao: z.enum([SUGESTAO_STATUS.ACEITA, SUGESTAO_STATUS.RECUSADA]),
  motivo: z.string().trim().min(2).optional(),
  assinaturaMatricula: z.string().min(3),
  matriculaConfirmacao: matriculaSchema.optional(),
});

// ---------------------------------------------------------------------------
// Consumíveis e EPIs (fase 10)
// ---------------------------------------------------------------------------
export const requestItemSchema = z.object({
  codigo: z.string().trim().min(1).max(40),
  descricao: z.string().trim().max(200).optional(),
  qtd: z.number().int().positive(),
  recebido: z.boolean().optional(),
});

/**
 * Entrada (recebimento) de consumível ou EPI. O item é criado no catálogo se o
 * código ainda não existir no depósito (docs 16). O payload é de UM item por
 * operação — mantém a idempotência por operation_id das tabelas de movimentos.
 */
export const estoqueEntradaBodySchema = z.object({
  operationId,
  tipo: z.enum(['CONSUMIVEL', 'EPI']),
  codigo: z.string().trim().min(1).max(40),
  descricao: z.string().trim().min(1).max(200),
  unidade: z.string().trim().max(20).optional(),
  estoqueMinimo: z.number().int().min(0).optional(),
  quantidade: quantidadeSchema,
  observacao: z.string().trim().max(300).optional(),
  origem: z.enum(['ONLINE', 'OFFLINE']),
  dispositivo: z.string().min(1),
  dataHora: iso,
  assinaturaMatricula: z.string().min(3),
  matriculaConfirmacao: matriculaSchema.optional(),
});

export const solicitacaoCreateBodySchema = z.object({
  operationId,
  tipo: z.enum([SOLICITACAO_TIPO.CONSUMIVEL, SOLICITACAO_TIPO.EPI]),
  itens: z.array(requestItemSchema).min(1).max(50),
  assinaturaMatricula: z.string().min(3),
  matriculaConfirmacao: matriculaSchema.optional(),
});

export const TRANSICOES_SOLICITACAO = [
  REQUEST_STATUS.ENVIADA,
  REQUEST_STATUS.RECEBIDA,
  REQUEST_STATUS.EXCLUIDA,
] as const;

export const solicitacaoTransitionBodySchema = z.object({
  operationId,
  para: z.enum(TRANSICOES_SOLICITACAO),
  motivo: z.string().trim().max(300).optional(),
  /** Códigos dos itens que NÃO foram recebidos (usado na transição para RECEBIDA). */
  naoRecebidos: z.array(z.string().trim().min(1).max(40)).max(50).optional(),
  pin: z.string().optional(),
  assinaturaMatricula: z.string().min(3),
  matriculaConfirmacao: matriculaSchema.optional(),
});

export const syncPayloadSolicitacaoSchema = solicitacaoCreateBodySchema
  .omit({ operationId: true })
  .extend({
    depositoId: z.string().min(1),
    solicitanteId: z.string().min(1),
    matricula: matriculaSchema,
  });

export const syncPayloadSolicitacaoTransitionSchema = solicitacaoTransitionBodySchema
  .omit({ operationId: true })
  .extend({
    depositoId: z.string().min(1),
    requestId: z.string().min(1),
  });

export const syncPayloadEntradaEstoqueSchema = estoqueEntradaBodySchema
  .omit({ operationId: true })
  .extend({ depositoId: z.string().min(1) });

export const syncOperationSchema = z.object({
  operationId,
  entidade: z.enum([
    'BAIXA',
    'SPARE_PART_ENTRADA',
    'SPARE_PART_SAIDA',
    'SUGESTAO_ACEITA',
    'SUGESTAO_RECUSADA',
    'SOLICITACAO',
    'SOLICITACAO_TRANSICAO',
    'ENTRADA_MATERIAL',
    'ENTRADA_ESTOQUE',
  ]),
  acao: z.enum(['CREATE']),
  payload: z.unknown(),
});

export const syncBodySchema = z.object({
  deviceId: z.string().min(1),
  depositoId: z.string().min(1),
  lastSyncAt: iso.optional(),
  operations: z.array(syncOperationSchema).max(200),
});

// ---------------------------------------------------------------------------
// Sincronização
// ---------------------------------------------------------------------------
export const syncPushSchema = z.object({
  deviceId: z.string().min(8).max(128),
  lastSyncAt: iso.optional(),
});

export const syncFullSchema = z.object({
  deviceId: z.string().min(8).max(128),
  depositoId: depositoIdSchema,
  lastSyncAt: iso.optional(),
  operations: z.array(
    z.object({
      operationId,
      entidade: z.string().min(1),
      acao: z.enum(['CREATE', 'UPDATE']),
      payload: z.record(z.string(), z.unknown()),
    }),
  ).max(500),
});

export const depositoParamSchema = z.object({
  depositoId: depositoIdSchema,
});

// ---------------------------------------------------------------------------
// Conferência física (docs 5)
// ---------------------------------------------------------------------------
export const inspectionItemInputSchema = z.object({
  codigoSap: codigoSapSchema,
  /** Quantidade contada fisicamente. O qtdSistema é lido do servidor. */
  qtdFisica: z.number().int().min(0),
  observacao: z.string().trim().max(500).optional(),
});

export const inspectionItemInputArraySchema = z
  .array(inspectionItemInputSchema)
  .min(1)
  .max(500);

export const createInspectionBodySchema = z.object({
  hora: z.string().regex(/^\d{2}:\d{2}$/, 'hora deve usar HH:MM'),
  observacao: z.string().trim().max(1000).optional(),
  itens: inspectionItemInputArraySchema,
  assinaturaMatricula: z.string().min(3),
  /** Confirmação crítica digitada pelo usuário — validada contra o usuário logado. */
  matriculaConfirmacao: matriculaSchema,
});

export const finalizeInspectionBodySchema = z.object({
  observacao: z.string().trim().max(1000).optional(),
  assinaturaMatricula: z.string().min(3),
  matriculaConfirmacao: matriculaSchema,
});

export const revisionInspectionBodySchema = z.object({
  hora: z.string().regex(/^\d{2}:\d{2}$/, 'hora deve usar HH:MM'),
  observacao: z.string().trim().max(1000).optional(),
  itens: inspectionItemInputArraySchema,
  assinaturaMatricula: z.string().min(3),
  matriculaConfirmacao: matriculaSchema,
});

export const correctionBodySchema = z.object({
  operationId,
  tipo: z.nativeEnum(TIPO_CORRECAO),
  /** Obrigatório para CORRIGIR_COM_PECA_AVULSA. */
  sparePartId: z.string().optional(),
  /** Obrigatório para CORRIGIR_COM_PECA_AVULSA. */
  quantidade: z.number().int().min(1).max(9999).optional(),
  observacao: z.string().trim().max(1000).optional(),
  assinaturaMatricula: z.string().min(3),
  matriculaConfirmacao: matriculaSchema,
});

export const revertCorrectionBodySchema = z.object({
  operationId,
  motivo: z.string().trim().min(5),
  assinaturaMatricula: z.string().min(3),
  matriculaConfirmacao: matriculaSchema,
});