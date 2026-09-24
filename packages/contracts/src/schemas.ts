import { z } from 'zod';
import { DEPOSITO_STATUS, ITEM_STATUS, PERFIL, TIPO_CORRECAO, USER_STATUS } from './enums.js';

const iso = z.string().datetime({ offset: true }).or(z.string());
export const operationId = z.string().uuid().or(z.string().min(8).max(64));
export const depositoIdSchema = z.string().min(1).max(64);
export const matriculaSchema = z.string().min(3).max(40);
export const codigoSapSchema = z.string().trim().min(1).max(40);
export const quantidadeSchema = z.number().int().positive();

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

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export const createUserBodySchema = z.object({
  nome: z.string().trim().min(2),
  sobrenome: z.string().trim().min(2),
  matricula: matriculaSchema,
  senha: z.string().min(8),
  perfil: z.enum([PERFIL.MECANICO, PERFIL.LIDER, PERFIL.ADMIN]),
});

export const updateUserBodySchema = z.object({
  status: z.enum([USER_STATUS.ATIVO, USER_STATUS.BLOQUEADO]).optional(),
  perfil: z.enum([PERFIL.MECANICO, PERFIL.LIDER, PERFIL.ADMIN]).optional(),
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

export const goldboxQuerySchema = z.object({
  dataIni: iso.optional(),
  dataFim: iso.optional(),
  codigoSap: codigoSapSchema.optional(),
  usuario: matriculaSchema.optional(),
  reposicao: z.enum(['true', 'false']).optional(),
  tipo: z.enum(['BAIXA', 'ESTORNO']).optional(),
});

/** Payload de uma baixa enviada pela fila offline (docs 8/11). */
export const syncPayloadBaixaSchema = baixaBodySchema.omit({ operationId: true }).extend({
  depositoId: z.string().min(1),
});

export const syncOperationSchema = z.object({
  operationId,
  entidade: z.enum(['BAIXA']),
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