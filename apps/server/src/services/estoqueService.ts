import type { FastifyInstance } from 'fastify';
import type { Perfil } from '@logenxoval/contracts';
import { AppError } from '../lib/errors';
import { aplicarEntradaEstoque } from '../repos/estoqueRepo';

export interface EstoqueServiceDeps {
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
    throw new AppError('PERMISSAO_NEGADA', 'Entrada de consumível/EPI exige perfil LIDER ou ADMIN', 403);
  }
}

/** Entrada (recebimento) de consumível ou EPI — cria o item se não existir (docs 16). */
export async function registrarEntradaEstoque(
  deps: EstoqueServiceDeps,
  params: {
    depositoId: string;
    operationId: string;
    tipo: 'CONSUMIVEL' | 'EPI';
    codigo: string;
    descricao: string;
    unidade?: string;
    estoqueMinimo?: number;
    quantidade: number;
    observacao?: string;
    origem: 'ONLINE' | 'OFFLINE';
    dispositivo: string;
    dataHora: string;
    assinaturaMatricula: string;
    matriculaConfirmacao?: string;
  },
) {
  validarMatricula(deps.authUser.matricula, params.matriculaConfirmacao);
  exigirNaoMecanico(deps.authUser.perfil);
  return aplicarEntradaEstoque({
    depositoId: params.depositoId,
    perfil: deps.authUser.perfil,
    usuarioId: deps.authUser.sub,
    matricula: deps.authUser.matricula,
    operationId: params.operationId,
    tipo: params.tipo,
    codigo: params.codigo,
    descricao: params.descricao,
    unidade: params.unidade,
    estoqueMinimo: params.estoqueMinimo,
    quantidade: params.quantidade,
    observacao: params.observacao,
    origem: params.origem,
    dispositivo: params.dispositivo,
    dataHora: params.dataHora,
    assinaturaMatricula: params.assinaturaMatricula,
  });
}