import type { FastifyInstance } from 'fastify';
import type { Perfil, RequestStatus, SolicitacaoTipo } from '@logenxoval/contracts';
import { AppError } from '../lib/errors';
import {
  criarSolicitacao,
  obterSolicitacao,
  transicionarSolicitacao,
} from '../repos/requestRepo';

export interface RequestServiceDeps {
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

export interface ItemBase {
  qtd: number;
  descricao: string;
  codigo: string;
}

function normalizarItens(itens: Array<{ qtd: number; codigo: string; descricao?: string }>): ItemBase[] {
  return itens.map((i) => ({ qtd: i.qtd, descricao: i.descricao ?? '', codigo: i.codigo }));
}

export async function registrarSolicitacao(
  deps: RequestServiceDeps,
  params: {
    depositoId: string;
    operationId: string;
    tipo: SolicitacaoTipo;
    itens: Array<{ qtd: number; codigo: string; descricao?: string }>;
    assinaturaMatricula: string;
    matriculaConfirmacao?: string;
  },
) {
  validarMatricula(deps.authUser.matricula, params.matriculaConfirmacao);
  return criarSolicitacao({
    depositoId: params.depositoId,
    perfil: deps.authUser.perfil,
    usuarioId: deps.authUser.sub,
    matricula: deps.authUser.matricula,
    operationId: params.operationId,
    tipo: params.tipo,
    itens: normalizarItens(params.itens),
    assinaturaMatricula: params.assinaturaMatricula,
    origemMov: deps.origem,
    dispositivo: deps.dispositivo,
  });
}

/**
 * Regras de transição (fluxo simplificado de solicitações):
 * - ENVIADA: somente o dono marca como enviada após compartilhar.
 * - RECEBIDA: o dono ou a liderança marca o recebimento (com itens não recebidos).
 * - EXCLUIDA: o dono ou a liderança exclui a solicitação.
 */
const TRANSICOES: Record<string, { podeDono?: boolean; podeLider?: boolean }> = {
  ENVIADA: { podeDono: true },
  RECEBIDA: { podeDono: true, podeLider: true },
  EXCLUIDA: { podeDono: true, podeLider: true },
};

export async function transicionarSolicitacaoService(
  deps: RequestServiceDeps,
  params: {
    depositoId: string;
    operationId: string;
    requestId: string;
    para: RequestStatus;
    motivo?: string;
    naoRecebidos?: string[];
    pin?: string;
    assinaturaMatricula: string;
    matriculaConfirmacao?: string;
  },
) {
  validarMatricula(deps.authUser.matricula, params.matriculaConfirmacao);

  const regras = TRANSICOES[params.para];
  if (!regras) {
    throw new AppError('VALIDATION_FAILED', `Transição para ${params.para} não suportada`, 400);
  }

  const solicitacao = await obterSolicitacao(params.depositoId, deps.authUser.perfil, params.requestId);
  if (!solicitacao) {
    throw new AppError('NAO_ENCONTRADO', 'Solicitação não encontrada', 404);
  }
  const dono = solicitacao.solicitanteId === deps.authUser.sub;
  const lideranca = deps.authUser.perfil !== 'MECANICO';
  const autorizado = (regras.podeDono && dono) || (regras.podeLider && lideranca);
  if (!autorizado) {
    throw new AppError('PERMISSAO_NEGADA', 'Você não pode executar esta transição nesta solicitação', 403);
  }

  return transicionarSolicitacao({
    depositoId: params.depositoId,
    perfil: deps.authUser.perfil,
    usuarioId: deps.authUser.sub,
    matricula: deps.authUser.matricula,
    operationId: params.operationId,
    requestId: params.requestId,
    para: params.para,
    motivo: params.motivo,
    naoRecebidos: params.naoRecebidos,
    assinaturaMatricula: params.assinaturaMatricula,
    origemMov: deps.origem,
    dispositivo: deps.dispositivo,
  });
}