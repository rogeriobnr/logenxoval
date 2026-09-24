import type { FastifyInstance } from 'fastify';
import { solicitacaoCreateBodySchema, solicitacaoTransitionBodySchema } from '@logenxoval/contracts';
import { authenticate, requireDepositoAcesso } from '../plugins/auth';
import { validateBody } from '../lib/validator';
import { listarConsumiveis, listarMovimentosConsumivel, listarMovimentosPpe, listarPpeItems } from '../repos/estoqueRepo';
import { listarSolicitacoes } from '../repos/requestRepo';
import * as requestService from '../services/requestService';

export async function registerEstoqueRoutes(app: FastifyInstance): Promise<void> {
  const prehandler = [authenticate, requireDepositoAcesso()];

  app.get('/deposits/:depositoId/consumables', { preHandler: prehandler }, async (req) => {
    const { depositoId } = req.params as { depositoId: string };
    const consumiveis = await listarConsumiveis(depositoId, req.authUser!.perfil);
    return { consumiveis };
  });

  app.get('/deposits/:depositoId/ppe', { preHandler: prehandler }, async (req) => {
    const { depositoId } = req.params as { depositoId: string };
    const ppe = await listarPpeItems(depositoId, req.authUser!.perfil);
    return { ppe };
  });

  app.get('/deposits/:depositoId/consumables/:consumableId/movements', { preHandler: prehandler }, async (req) => {
    const { depositoId, consumableId } = req.params as { depositoId: string; consumableId: string };
    const movements = await listarMovimentosConsumivel(depositoId, consumableId, req.authUser!.perfil);
    return { movements };
  });

  app.get('/deposits/:depositoId/ppe/:ppeItemId/movements', { preHandler: prehandler }, async (req) => {
    const { depositoId, ppeItemId } = req.params as { depositoId: string; ppeItemId: string };
    const movements = await listarMovimentosPpe(depositoId, ppeItemId, req.authUser!.perfil);
    return { movements };
  });

  app.get('/deposits/:depositoId/requests', { preHandler: prehandler }, async (req) => {
    const { depositoId } = req.params as { depositoId: string };
    const { tipo } = req.query as { tipo?: string };
    const tipoValido = tipo === 'CONSUMIVEL' || tipo === 'EPI' ? (tipo as 'CONSUMIVEL' | 'EPI') : undefined;
    const solicitacoes = await listarSolicitacoes(
      depositoId,
      req.authUser!.perfil,
      req.authUser!.sub,
      tipoValido,
    );
    return { solicitacoes };
  });

  app.post(
    '/deposits/:depositoId/requests',
    {
      preHandler: prehandler,
      ...validateBody(solicitacaoCreateBodySchema),
    },
    async (req) => {
      const body = req.body as typeof solicitacaoCreateBodySchema._type;
      const { depositoId } = req.params as { depositoId: string };
      const res = await requestService.registrarSolicitacao(
        {
          app,
          authUser: req.authUser!,
          dispositivo: (req.headers['x-device-id'] as string) ?? 'api',
          origem: 'ONLINE',
        },
        {
          ...body,
          depositoId,
          operationId: body.operationId,
        },
      );
      return { solicitacao: res.solicitacao, jaProcessada: res.jaProcessada };
    },
  );

  app.post(
    '/deposits/:depositoId/requests/:requestId/transition',
    {
      preHandler: prehandler,
      ...validateBody(solicitacaoTransitionBodySchema),
    },
    async (req) => {
      const body = req.body as typeof solicitacaoTransitionBodySchema._type;
      const { depositoId, requestId } = req.params as { depositoId: string; requestId: string };
      const res = await requestService.transicionarSolicitacaoService(
        {
          app,
          authUser: req.authUser!,
          dispositivo: (req.headers['x-device-id'] as string) ?? 'api',
          origem: 'ONLINE',
        },
        {
          ...body,
          depositoId,
          requestId,
          operationId: body.operationId,
        },
      );
      return { solicitacao: res.solicitacao, jaProcessada: res.jaProcessada };
    },
  );
}