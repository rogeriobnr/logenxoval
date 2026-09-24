import type { FastifyInstance } from 'fastify';
import type { Perfil } from '@logenxoval/contracts';
import { podeExecutar } from '../domain/permissions';
import { AppError } from '../lib/errors';
import { gerarEListarSugestoes, responderSugestao } from '../repos/suggestionRepo';

export interface SugestaoServiceDeps {
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

function exigirConverter(perfil: Perfil): void {
  if (!podeExecutar(perfil, 'CONVERTER_SUGESTAO')) {
    throw new AppError('PERMISSAO_NEGADA', 'Ação sobre sugestão exige perfil LIDER ou ADMIN', 403);
  }
}

export async function consultarSugestoes(deps: SugestaoServiceDeps, depositoId: string) {
  return gerarEListarSugestoes({
    depositoId,
    perfil: deps.authUser.perfil,
    usuarioId: deps.authUser.sub,
    matricula: deps.authUser.matricula,
    origemMov: deps.origem,
    dispositivo: deps.dispositivo,
  });
}

export async function responderSugestaoConversao(
  deps: SugestaoServiceDeps,
  params: {
    depositoId: string;
    suggestionId: string;
    operationId: string;
    acao: 'ACEITA' | 'RECUSADA';
    motivo?: string;
    assinaturaMatricula: string;
    matriculaConfirmacao?: string;
  },
) {
  validarMatricula(deps.authUser.matricula, params.matriculaConfirmacao);
  exigirConverter(deps.authUser.perfil);
  return responderSugestao({
    depositoId: params.depositoId,
    perfil: deps.authUser.perfil,
    usuarioId: deps.authUser.sub,
    matricula: deps.authUser.matricula,
    suggestionId: params.suggestionId,
    operationId: params.operationId,
    acao: params.acao,
    motivo: params.motivo,
    assinaturaMatricula: params.assinaturaMatricula,
    origemMov: deps.origem,
    dispositivo: deps.dispositivo,
  });
}