import type { FastifyInstance } from 'fastify';
import type { DepositoRow } from '@logenxoval/contracts';
import { AppError } from '../lib/errors';
import { insertAuditLog } from '../repos/auditLogRepo';
import {
  createDeposit,
  findDepositById,
  grantDepositAccess,
  setDepositStatus,
  updateDepositMeta,
} from '../repos/depositsRepo';

export interface DepositServiceDeps {
  app: FastifyInstance;
  authUser: { sub: string; matricula: string; perfil: string };
  dispositivo: string;
  origem: 'ONLINE' | 'OFFLINE';
}

export async function criarDeposito(
  deps: DepositServiceDeps,
  params: { numero: string; nome: string; matriculaConfirmacao: string; pin?: string },
): Promise<DepositoRow> {
  if (deps.authUser.matricula !== params.matriculaConfirmacao) {
    throw new AppError('MATRICULA_INVALIDA', 'Matrícula de confirmação inválida', 403);
  }
  const { verificarPinSeConfigurado } = await import('../plugins/auth');
  await verificarPinSeConfigurado(params.pin, deps.app);

  const dep = await createDeposit({
    numero: params.numero,
    nome: params.nome,
    criadoPor: deps.authUser.matricula,
  });

  // Criador (líder/admin) automaticamente autorizado ao novo depósito.
  await grantDepositAccess({
    userId: deps.authUser.sub,
    depositoId: dep.id,
    concedidoPor: deps.authUser.matricula,
  });

  await insertAuditLog({
    tipo: 'CRIACAO_DEPOSITO',
    usuarioId: deps.authUser.sub,
    matricula: deps.authUser.matricula,
    depositoId: dep.id,
    entidade: 'deposits',
    operacaoId: dep.id,
    estadoPosterior: { numero: dep.numero, nome: dep.nome },
    origem: deps.origem,
    dispositivo: deps.dispositivo,
  });
  return dep;
}

export async function editarDeposito(
  deps: DepositServiceDeps,
  params: { depositoId: string; nome: string; matriculaConfirmacao: string; pin?: string },
): Promise<DepositoRow> {
  if (deps.authUser.matricula !== params.matriculaConfirmacao) {
    throw new AppError('MATRICULA_INVALIDA', 'Matrícula de confirmação inválida', 403);
  }
  const { verificarPinSeConfigurado } = await import('../plugins/auth');
  await verificarPinSeConfigurado(params.pin, deps.app);

  const anterior = await findDepositById(params.depositoId);
  if (!anterior) throw new AppError('NAO_ENCONTRADO', 'Depósito não encontrado', 404);

  const dep = await updateDepositMeta({
    id: params.depositoId,
    nome: params.nome,
    alteradoPor: deps.authUser.matricula,
  });

  await insertAuditLog({
    tipo: 'EDICAO_DEPOSITO',
    usuarioId: deps.authUser.sub,
    matricula: deps.authUser.matricula,
    depositoId: dep.id,
    entidade: 'deposits',
    operacaoId: dep.id,
    estadoAnterior: { nome: anterior.nome },
    estadoPosterior: { nome: dep.nome },
    origem: deps.origem,
    dispositivo: deps.dispositivo,
  });
  return dep;
}

export async function desativarDeposito(
  deps: DepositServiceDeps,
  params: { depositoId: string; motivo: string; matriculaConfirmacao: string; pin?: string },
): Promise<DepositoRow> {
  if (deps.authUser.matricula !== params.matriculaConfirmacao) {
    throw new AppError('MATRICULA_INVALIDA', 'Matrícula de confirmação inválida', 403);
  }
  const { verificarPinSeConfigurado } = await import('../plugins/auth');
  await verificarPinSeConfigurado(params.pin, deps.app);

  const anterior = await findDepositById(params.depositoId);
  if (!anterior) throw new AppError('NAO_ENCONTRADO', 'Depósito não encontrado', 404);

  const dep = await setDepositStatus({
    id: params.depositoId,
    status: 'INATIVO',
    alteradoPor: deps.authUser.matricula,
  });

  await insertAuditLog({
    tipo: 'DESATIVACAO_DEPOSITO',
    usuarioId: deps.authUser.sub,
    matricula: deps.authUser.matricula,
    depositoId: dep.id,
    entidade: 'deposits',
    operacaoId: dep.id,
    estadoAnterior: { status: anterior.status },
    estadoPosterior: { status: dep.status },
    motivo: params.motivo,
    origem: deps.origem,
    dispositivo: deps.dispositivo,
  });
  return dep;
}