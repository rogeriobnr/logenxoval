import type { FastifyInstance } from 'fastify';
import type { OrigemSparePart, Perfil, TipoMovimentacaoSparePart } from '@logenxoval/contracts';
import { podeExecutar } from '../domain/permissions';
import { AppError } from '../lib/errors';
import { criarPecaAvulsa, movimentarPeca } from '../repos/spareRepo';
import { verificarPinSeConfigurado } from '../plugins/auth';

export interface PecaServiceDeps {
  app: FastifyInstance;
  authUser: { sub: string; matricula: string; perfil: Perfil };
  dispositivo: string;
  origem: 'ONLINE' | 'OFFLINE';
}

function validarMatricula(autenticado: string, confirmacao: string | undefined): void {
  if (confirmacao !== undefined && confirmacao !== autenticado) {
    throw new AppError('MATRICULA_INVALIDA', 'Matrícula de confirmação não corresponde ao usuário logado', 403);
  }
}

function exigirNaoMecanico(perfil: Perfil): void {
  if (perfil === 'MECANICO') {
    throw new AppError('PERMISSAO_NEGADA', 'Entrada de peça avulsa exige perfil LIDER ou ADMIN', 403);
  }
}

export async function registrarEntradaPeca(
  deps: PecaServiceDeps,
  params: {
    depositoId: string;
    operationId: string;
    codigoSap: string;
    descricao: string;
    foto?: string;
    origem: OrigemSparePart;
    quantidade: number;
    observacao?: string;
    assinaturaMatricula: string;
    matriculaConfirmacao?: string;
  },
) {
  validarMatricula(deps.authUser.matricula, params.matriculaConfirmacao);
  exigirNaoMecanico(deps.authUser.perfil);
  return criarPecaAvulsa({
    depositoId: params.depositoId,
    perfil: deps.authUser.perfil,
    usuarioId: deps.authUser.sub,
    matricula: deps.authUser.matricula,
    operationId: params.operationId,
    codigoSap: params.codigoSap,
    descricao: params.descricao,
    foto: params.foto,
    origem: params.origem,
    quantidade: params.quantidade,
    observacao: params.observacao,
    assinaturaMatricula: params.assinaturaMatricula,
    origemMov: deps.origem,
    dispositivo: deps.dispositivo,
  });
}

export async function movimentarPecaAvulsa(
  deps: PecaServiceDeps,
  params: {
    depositoId: string;
    sparePartId: string;
    operationId: string;
    tipo: TipoMovimentacaoSparePart;
    quantidade?: number;
    novoSaldo?: number;
    motivo?: string;
    pin?: string;
    assinaturaMatricula: string;
    matriculaConfirmacao?: string;
  },
) {
  validarMatricula(deps.authUser.matricula, params.matriculaConfirmacao);
  if (params.tipo === 'AJUSTE_AUTORIZADO') {
    if (params.novoSaldo === undefined) throw new AppError('VALIDATION_FAILED', 'novoSaldo é obrigatório para AJUSTE_AUTORIZADO', 400);
    if (params.quantidade !== undefined) throw new AppError('VALIDATION_FAILED', 'para AJUSTE_AUTORIZADO use novoSaldo, não quantidade', 400);
  } else if (params.tipo === 'DESCARTE') {
    if (params.motivo === undefined) throw new AppError('VALIDATION_FAILED', 'motivo é obrigatório para DESCARTE', 400);
    if (params.quantidade === undefined) throw new AppError('VALIDATION_FAILED', 'quantidade é obrigatória para DESCARTE', 400);
  } else if (params.quantidade === undefined) {
    throw new AppError('VALIDATION_FAILED', `quantidade é obrigatória para ${params.tipo}`, 400);
  }
  if (params.tipo === 'AJUSTE_AUTORIZADO' && !podeExecutar(deps.authUser.perfil, 'AJUSTE_AUTORIZADO')) {
    throw new AppError('PERMISSAO_NEGADA', 'Ajuste autorizado exige LIDER/ADMIN', 403);
  }
  if (params.tipo === 'DESCARTE' && !podeExecutar(deps.authUser.perfil, 'DESCARTE')) {
    throw new AppError('PERMISSAO_NEGADA', 'Descarte exige LIDER/ADMIN', 403);
  }
  if (params.tipo === 'AJUSTE_AUTORIZADO' || params.tipo === 'DESCARTE') {
    await verificarPinSeConfigurado(params.pin, deps.app);
  }
  return movimentarPeca({
    depositoId: params.depositoId,
    perfil: deps.authUser.perfil,
    usuarioId: deps.authUser.sub,
    matricula: deps.authUser.matricula,
    sparePartId: params.sparePartId,
    operationId: params.operationId,
    tipo: params.tipo,
    quantidade: params.quantidade,
    novoSaldo: params.novoSaldo,
    motivo: params.motivo,
    assinaturaMatricula: params.assinaturaMatricula,
    origemMov: deps.origem,
    dispositivo: deps.dispositivo,
  });
}