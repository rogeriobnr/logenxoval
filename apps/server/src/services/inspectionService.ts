import type { FastifyInstance } from 'fastify';
import type { TipoCorrecao } from '@logenxoval/contracts';
import { AppError } from '../lib/errors';
import {
  aplicarCorrecao,
  buscarConferencia,
  criarConferencia,
  criarRevisao,
  finalizarConferencia,
  listarConferencias,
  reverterCorrecao,
} from '../repos/inspectionRepo';

export interface InspecaoServiceDeps {
  app: FastifyInstance;
  authUser: { sub: string; matricula: string; perfil: string };
  dispositivo: string;
  origem: 'ONLINE' | 'OFFLINE';
}

function validarMatricula(autenticado: string, confirmacao: string | undefined): void {
  if (confirmacao !== undefined && confirmacao !== autenticado) {
    throw new AppError('MATRICULA_INVALIDA', 'Matrícula de confirmação não corresponde ao usuário logado', 403);
  }
}

function exigirLideranca(perfil: string, tipo: TipoCorrecao): void {
  if (tipo === 'ACAO_LIDERANCA' && perfil !== 'LIDER' && perfil !== 'ADMIN') {
    throw new AppError('PERMISSAO_NEGADA', 'ACAO_LIDERANCA exige perfil LIDER ou ADMIN', 403);
  }
}

export async function iniciarConferencia(
  deps: InspecaoServiceDeps,
  params: {
    depositoId: string;
    hora: string;
    observacao?: string;
    itens: Array<{ codigoSap: string; qtdFisica: number; observacao?: string }>;
    assinaturaMatricula: string;
    matriculaConfirmacao?: string;
  },
) {
  validarMatricula(deps.authUser.matricula, params.matriculaConfirmacao);
  return criarConferencia({
    depositoId: params.depositoId,
    perfil: deps.authUser.perfil,
    usuarioId: deps.authUser.sub,
    matricula: deps.authUser.matricula,
    hora: params.hora,
    observacao: params.observacao,
    itens: params.itens,
    assinaturaMatricula: params.assinaturaMatricula,
    origem: deps.origem,
    dispositivo: deps.dispositivo,
  });
}

export async function consultarConferencias(deps: InspecaoServiceDeps, depositoId: string) {
  return listarConferencias(depositoId, deps.authUser.perfil);
}

export async function consultarConferencia(deps: InspecaoServiceDeps, depositoId: string, inspecaoId: string) {
  return buscarConferencia(depositoId, deps.authUser.perfil, inspecaoId);
}

export async function encerrarConferencia(
  deps: InspecaoServiceDeps,
  params: { depositoId: string; inspecaoId: string; observacao?: string; assinaturaMatricula: string; matriculaConfirmacao?: string },
) {
  validarMatricula(deps.authUser.matricula, params.matriculaConfirmacao);
  return finalizarConferencia({
    depositoId: params.depositoId,
    perfil: deps.authUser.perfil,
    usuarioId: deps.authUser.sub,
    matricula: deps.authUser.matricula,
    inspecaoId: params.inspecaoId,
    observacao: params.observacao,
    assinaturaMatricula: params.assinaturaMatricula,
    origem: deps.origem,
    dispositivo: deps.dispositivo,
  });
}

export async function revisarConferencia(
  deps: InspecaoServiceDeps,
  params: {
    depositoId: string;
    inspecaoId: string;
    hora: string;
    observacao?: string;
    itens: Array<{ codigoSap: string; qtdFisica: number; observacao?: string }>;
    assinaturaMatricula: string;
    matriculaConfirmacao?: string;
  },
) {
  validarMatricula(deps.authUser.matricula, params.matriculaConfirmacao);
  return criarRevisao({
    depositoId: params.depositoId,
    perfil: deps.authUser.perfil,
    usuarioId: deps.authUser.sub,
    matricula: deps.authUser.matricula,
    inspecaoId: params.inspecaoId,
    hora: params.hora,
    observacao: params.observacao,
    itens: params.itens,
    assinaturaMatricula: params.assinaturaMatricula,
    origem: deps.origem,
    dispositivo: deps.dispositivo,
  });
}

export async function corrigirItem(
  deps: InspecaoServiceDeps,
  params: {
    depositoId: string;
    inspecaoId: string;
    itemId: string;
    operationId: string;
    tipo: TipoCorrecao;
    sparePartId?: string;
    quantidade?: number;
    observacao?: string;
    assinaturaMatricula: string;
    matriculaConfirmacao?: string;
  },
) {
  validarMatricula(deps.authUser.matricula, params.matriculaConfirmacao);
  exigirLideranca(deps.authUser.perfil, params.tipo);
  return aplicarCorrecao({
    depositoId: params.depositoId,
    perfil: deps.authUser.perfil,
    usuarioId: deps.authUser.sub,
    matricula: deps.authUser.matricula,
    inspecaoId: params.inspecaoId,
    itemId: params.itemId,
    tipo: params.tipo,
    sparePartId: params.sparePartId,
    quantidade: params.quantidade,
    observacao: params.observacao,
    operationId: params.operationId,
    assinaturaMatricula: params.assinaturaMatricula,
    origem: deps.origem,
    dispositivo: deps.dispositivo,
  });
}

export async function estornarCorrecao(
  deps: InspecaoServiceDeps,
  params: {
    depositoId: string;
    inspecaoId: string;
    itemId: string;
    operationId: string;
    motivo: string;
    assinaturaMatricula: string;
    matriculaConfirmacao?: string;
  },
) {
  validarMatricula(deps.authUser.matricula, params.matriculaConfirmacao);
  return reverterCorrecao({
    depositoId: params.depositoId,
    perfil: deps.authUser.perfil,
    usuarioId: deps.authUser.sub,
    matricula: deps.authUser.matricula,
    inspecaoId: params.inspecaoId,
    itemId: params.itemId,
    motivo: params.motivo,
    operationId: params.operationId,
    assinaturaMatricula: params.assinaturaMatricula,
    origem: deps.origem,
    dispositivo: deps.dispositivo,
  });
}