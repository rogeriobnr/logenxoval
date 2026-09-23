import type { FastifyInstance } from 'fastify';
import { syncBodySchema, syncPayloadBaixaSchema } from '@logenxoval/contracts';
import { AppError } from '../lib/errors';
import { userHasDepositAccess } from '../repos/depositsRepo';
import { registrarBaixa } from './goldboxService';

export interface SyncDeps {
  app: FastifyInstance;
  authUser: { sub: string; matricula: string; perfil: string };
  dispositivo: string;
}

interface SyncResult {
  acks: Array<{ operationId: string; status: 'OK' | 'JA_PROCESSADO' }>;
  conflicts: Array<{ operationId: string; tipo: string; detalhe?: string }>;
  errors: Array<{ operationId: string; code: string; message?: string }>;
}

/**
 * Fase 05: processa o lote push do cliente (baixas offline).
 * Cada operação usa a mesma idempotência por operationId das baixas online
 * (processed_operations) — reenvios viram ACK JA_PROCESSADO (docs 7.6/8.5).
 */
export async function processarSync(deps: SyncDeps, body: typeof syncBodySchema._type): Promise<SyncResult> {
  const acesso = await userHasDepositAccess(deps.authUser.sub, body.depositoId, deps.authUser.perfil);
  if (!acesso) {
    throw new AppError('DEPOSITO_NAO_AUTORIZADO', 'Depósito não autorizado para o usuário', 403);
  }

  const acks: SyncResult['acks'] = [];
  const conflicts: SyncResult['conflicts'] = [];
  const errors: SyncResult['errors'] = [];

  for (const op of body.operations) {
    try {
      if (op.entidade !== 'BAIXA' || op.acao !== 'CREATE') {
        throw new AppError('VALIDATION_FAILED', 'Operação não suportada na sincronização', 400);
      }
      const p = syncPayloadBaixaSchema.safeParse(op.payload);
      if (!p.success) {
        throw new AppError('VALIDATION_FAILED', 'Payload inválido na operação de baixa', 400);
      }
      if (p.data.depositoId !== body.depositoId) {
        throw new AppError('DEPOSITO_NAO_AUTORIZADO', 'depositoId da operação diverge do lote', 403);
      }
      const res = await registrarBaixa(
        { app: deps.app, authUser: deps.authUser, dispositivo: deps.dispositivo, origem: 'OFFLINE' },
        {
          depositoId: body.depositoId,
          operationId: op.operationId,
          codigoSap: p.data.codigoSap,
          materialId: p.data.materialId,
          descricao: p.data.descricao,
          quantidade: p.data.quantidade,
          reposicao: p.data.reposicao,
          origem: 'OFFLINE',
          dispositivo: deps.dispositivo,
          dataHora: p.data.dataHora,
          assinaturaMatricula: p.data.assinaturaMatricula,
          matriculaConfirmacao: p.data.matriculaConfirmacao,
        },
      );
      acks.push({ operationId: op.operationId, status: res.jaProcessada ? 'JA_PROCESSADO' : 'OK' });
    } catch (err) {
      if (err instanceof AppError) {
        errors.push({ operationId: op.operationId, code: err.code, message: err.message });
      } else {
        errors.push({ operationId: op.operationId, code: 'INTERNAL', message: 'Erro interno ao processar a operação' });
      }
    }
  }

  return { acks, conflicts, errors };
}