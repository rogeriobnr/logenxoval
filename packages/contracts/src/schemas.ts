import { z } from 'zod';
import { DEPOSITO_STATUS, ITEM_STATUS, PERFIL, USER_STATUS } from './enums.js';

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
  perfil: z.enum(Object.values(PERFIL) as [string, ...string[]]),
});

export const updateUserBodySchema = z.object({
  status: z.enum(Object.values(USER_STATUS) as [string, ...string[]]).optional(),
  perfil: z.enum(Object.values(PERFIL) as [string, ...string[]]).optional(),
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
  status: z.enum(Object.values(ITEM_STATUS) as [string, ...string[]]).default(ITEM_STATUS.ATIVO),
});

export const importEnxovalBodySchema = z.object({
  documentoId: z.string().optional(),
  refFolha: z.string().optional(),
  motivo: z.string().trim().min(5),
  matriculaConfirmacao: matriculaSchema,
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
});

export const estornoBodySchema = z.object({
  operationIdOriginal: operationId,
  motivo: z.string().trim().min(5),
  assinaturaMatricula: z.string().min(3),
  pin: z.string().optional(),
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