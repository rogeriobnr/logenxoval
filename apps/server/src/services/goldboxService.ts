import type { FastifyInstance } from 'fastify';
import type { GoldboxMovementRow } from '@logenxoval/contracts';
import { AppError } from '../lib/errors';
import { findById } from '../repos/usersRepo';
import { aplicarBaixa, aplicarEntrada, aplicarEstorno, listGoldbox, type GoldboxFilter } from '../repos/goldboxRepo';

export interface GoldboxServiceDeps {
  app: FastifyInstance;
  authUser: { sub: string; matricula: string; perfil: string };
  dispositivo: string;
  origem: 'ONLINE' | 'OFFLINE';
}

async function nomeCompletoDe(usuarioId: string): Promise<string> {
  const user = await findById(usuarioId);
  if (!user) throw new AppError('UNAUTHORIZED', 'Usuário não localizado', 401);
  return `${user.nome} ${user.sobrenome}`.trim();
}

function validarMatriculaSeInformada(autenticado: string, confirmacao: string | undefined): void {
  if (confirmacao !== undefined && confirmacao !== autenticado) {
    throw new AppError('MATRICULA_INVALIDA', 'Matrícula de confirmação não corresponde ao usuário logado', 403);
  }
}

export async function registrarBaixa(
  deps: GoldboxServiceDeps,
  params: {
    depositoId: string;
    operationId: string;
    codigoSap: string;
    materialId?: string;
    descricao?: string;
    quantidade: number;
    reposicao: boolean;
    origem: 'ONLINE' | 'OFFLINE';
    dispositivo: string;
    dataHora: string;
    assinaturaMatricula: string;
    matriculaConfirmacao?: string;
  },
) {
  validarMatriculaSeInformada(deps.authUser.matricula, params.matriculaConfirmacao);
  const nome = await nomeCompletoDe(deps.authUser.sub);
  return aplicarBaixa({
    depositoId: params.depositoId,
    perfil: deps.authUser.perfil,
    usuarioId: deps.authUser.sub,
    matricula: deps.authUser.matricula,
    nomeCompleto: nome,
    operationId: params.operationId,
    codigoSap: params.codigoSap,
    materialId: params.materialId,
    descricao: params.descricao,
    quantidade: params.quantidade,
    reposicao: params.reposicao,
    origem: params.origem,
    dispositivo: params.dispositivo,
    dataHora: params.dataHora,
    assinaturaMatricula: params.assinaturaMatricula,
  });
}

export async function registrarEntrada(
  deps: GoldboxServiceDeps,
  params: {
    depositoId: string;
    operationId: string;
    codigoSap: string;
    materialId?: string;
    descricao?: string;
    quantidade: number;
    observacao?: string;
    origem: 'ONLINE' | 'OFFLINE';
    dispositivo: string;
    dataHora: string;
    assinaturaMatricula: string;
    matriculaConfirmacao?: string;
  },
) {
  if (deps.authUser.perfil === 'MECANICO') {
    throw new AppError('PERMISSAO_NEGADA', 'Entrada de material exige perfil LIDER ou ADMIN', 403);
  }
  validarMatriculaSeInformada(deps.authUser.matricula, params.matriculaConfirmacao);
  const nome = await nomeCompletoDe(deps.authUser.sub);
  return aplicarEntrada({
    depositoId: params.depositoId,
    perfil: deps.authUser.perfil,
    usuarioId: deps.authUser.sub,
    matricula: deps.authUser.matricula,
    nomeCompleto: nome,
    operationId: params.operationId,
    codigoSap: params.codigoSap,
    materialId: params.materialId,
    descricao: params.descricao,
    quantidade: params.quantidade,
    observacao: params.observacao,
    origem: params.origem,
    dispositivo: params.dispositivo,
    dataHora: params.dataHora,
    assinaturaMatricula: params.assinaturaMatricula,
  });
}

export async function estornarMovimento(
  deps: GoldboxServiceDeps,
  params: {
    depositoId: string;
    operationId: string;
    operationIdOriginal: string;
    motivo: string;
    assinaturaMatricula: string;
    pin?: string;
    matriculaConfirmacao?: string;
  },
) {
  validarMatriculaSeInformada(deps.authUser.matricula, params.matriculaConfirmacao);
  const { verificarPinDoUsuario } = await import('../plugins/auth');
  await verificarPinDoUsuario(params.pin, deps.app, deps.authUser.sub);
  const nome = await nomeCompletoDe(deps.authUser.sub);
  return aplicarEstorno({
    depositoId: params.depositoId,
    perfil: deps.authUser.perfil,
    usuarioId: deps.authUser.sub,
    matricula: deps.authUser.matricula,
    nomeCompleto: nome,
    operationId: params.operationId,
    operationIdOriginal: params.operationIdOriginal,
    motivo: params.motivo,
    origem: deps.origem,
    dispositivo: deps.dispositivo,
    assinaturaMatricula: params.assinaturaMatricula,
  });
}

export async function consultarHistoricoGoldbox(
  deps: GoldboxServiceDeps,
  depositoId: string,
  filtro: GoldboxFilter,
): Promise<GoldboxMovementRow[]> {
  return listGoldbox(depositoId, deps.authUser.perfil, filtro);
}