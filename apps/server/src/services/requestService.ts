import type { FastifyInstance } from 'fastify';
import type { Perfil, RequestStatus, SolicitacaoTipo } from '@logenxoval/contracts';
import { podeExecutar } from '../domain/permissions';
import { AppError } from '../lib/errors';
import {
  criarSolicitacao,
  obterSolicitacao,
  transicionarSolicitacao,
} from '../repos/requestRepo';
import { verificarPinSeConfigurado } from '../plugins/auth';

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
 * Regras de transição (docs 11.4 / matriz 09):
 * - RASCUNHO/PRONTA_PARA_ENVIO: somente o dono (marcar pronta / enviar / cancelar).
 * - ENVIADA → RECEBIDA_PELA_LIDERANCA: somente LIDER/ADMIN.
 * - APROVADA/ATENDIDA: somente LIDER/ADMIN + PIN administrativo.
 * - Qualquer perfil pode cancelar a própria solicitação antes de enviada.
 */
const TRANSICOES: Record<string, { podeDono?: boolean; acao?: 'APROVAR_SOLICITACAO'; precisaPin?: boolean; podeLider?: boolean }> = {
  PRONTA_PARA_ENVIO: { podeDono: true },
  ENVIADA: { podeDono: true },
  RECEBIDA_PELA_LIDERANCA: { podeLider: true },
  APROVADA: { acao: 'APROVAR_SOLICITACAO', precisaPin: true },
  ATENDIDA: { acao: 'APROVAR_SOLICITACAO', precisaPin: true },
  CANCELADA: { podeDono: true, podeLider: true },
};

export async function transicionarSolicitacaoService(
  deps: RequestServiceDeps,
  params: {
    depositoId: string;
    operationId: string;
    requestId: string;
    para: RequestStatus;
    motivo?: string;
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

  if (regras.acao) {
    if (!podeExecutar(deps.authUser.perfil, regras.acao)) {
      throw new AppError('PERMISSAO_NEGADA', 'Aprovar/atender solicitação exige LIDER/ADMIN', 403);
    }
    if (regras.precisaPin) await verificarPinSeConfigurado(params.pin, deps.app);
  }

  const solicitacao = await obterSolicitacao(params.depositoId, deps.authUser.perfil, params.requestId);
  if (!solicitacao) {
    throw new AppError('NAO_ENCONTRADO', 'Solicitação não encontrada', 404);
  }
  const dono = solicitacao.solicitanteId === deps.authUser.sub;
  if (regras.podeDono && !dono) {
    throw new AppError('PERMISSAO_NEGADA', 'Somente o solicitante pode executar esta transição', 403);
  }
  if (regras.podeLider && !regras.podeDono && deps.authUser.perfil === 'MECANICO') {
    throw new AppError('PERMISSAO_NEGADA', 'Somente liderança pode executar esta transição', 403);
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
    assinaturaMatricula: params.assinaturaMatricula,
    origemMov: deps.origem,
    dispositivo: deps.dispositivo,
  });
}