import type { FastifyInstance } from 'fastify';
import { respondSuggestionBodySchema, sparePartEntradaBodySchema, sparePartMovimentoBodySchema } from '@logenxoval/contracts';
import { authenticate, requireAcao, requireDepositoAcesso } from '../plugins/auth';
import { validateBody } from '../lib/validator';
import { listarPecasAvulsas } from '../repos/spareRepo';
import * as spareService from '../services/spareService';
import * as suggestionService from '../services/suggestionService';

export async function registerSpareRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/deposits/:depositoId/spare-parts',
    { preHandler: [authenticate, requireDepositoAcesso()] },
    async (req) => {
      const { depositoId } = req.params as { depositoId: string };
      const pecas = await listarPecasAvulsas(depositoId, req.authUser!.perfil);
      return { pecas };
    },
  );

  app.post(
    '/deposits/:depositoId/spare-parts',
    {
      preHandler: [authenticate, requireDepositoAcesso()],
      ...validateBody(sparePartEntradaBodySchema),
    },
    async (req) => {
      const body = req.body as typeof sparePartEntradaBodySchema._type;
      const { depositoId } = req.params as { depositoId: string };
      const res = await spareService.registrarEntradaPeca(
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
      return { peca: res.peca, jaProcessada: res.jaProcessada };
    },
  );

  app.post(
    '/deposits/:depositoId/spare-parts/:sparePartId/movements',
    {
      preHandler: [authenticate, requireDepositoAcesso()],
      ...validateBody(sparePartMovimentoBodySchema),
    },
    async (req) => {
      const body = req.body as typeof sparePartMovimentoBodySchema._type;
      const { depositoId, sparePartId } = req.params as { depositoId: string; sparePartId: string };
      const res = await spareService.movimentarPecaAvulsa(
        {
          app,
          authUser: req.authUser!,
          dispositivo: (req.headers['x-device-id'] as string) ?? 'api',
          origem: 'ONLINE',
        },
        {
          ...body,
          depositoId,
          sparePartId,
        },
      );
      return { peca: res.peca, movement: res.movement };
    },
  );

  app.get(
    '/deposits/:depositoId/conversion-suggestions',
    { preHandler: [authenticate, requireDepositoAcesso()] },
    async (req) => {
      const { depositoId } = req.params as { depositoId: string };
      const sugestoes = await suggestionService.consultarSugestoes(
        {
          app,
          authUser: req.authUser!,
          dispositivo: (req.headers['x-device-id'] as string) ?? 'api',
          origem: 'ONLINE',
        },
        depositoId,
      );
      return { sugestoes };
    },
  );

  app.post(
    '/deposits/:depositoId/conversion-suggestions/:suggestionId/respond',
    {
      preHandler: [requireAcao('CONVERTER_SUGESTAO'), requireDepositoAcesso()],
      ...validateBody(respondSuggestionBodySchema),
    },
    async (req) => {
      const body = req.body as typeof respondSuggestionBodySchema._type;
      const { depositoId, suggestionId } = req.params as { depositoId: string; suggestionId: string };
      const res = await suggestionService.responderSugestaoConversao(
        {
          app,
          authUser: req.authUser!,
          dispositivo: (req.headers['x-device-id'] as string) ?? 'api',
          origem: 'ONLINE',
        },
        {
          ...body,
          depositoId,
          suggestionId,
        },
      );
      return { sugestao: res.sugestao, jaProcessada: res.jaProcessada };
    },
  );
}