import type { FastifyInstance } from 'fastify';
import { baixaBodySchema, entradaMaterialBodySchema, estornoBodySchema, goldboxQuerySchema } from '@logenxoval/contracts';
import { authenticate, requireAcao, requireDepositoAcesso } from '../plugins/auth';
import { validateBody } from '../lib/validator';
import { zodToAppError } from '../lib/errors';
import * as goldboxService from '../services/goldboxService';

export async function registerGoldboxRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/deposits/:depositoId/goldbox',
    { preHandler: [authenticate, requireDepositoAcesso()] },
    async (req) => {
      const { depositoId } = req.params as { depositoId: string };
      const q = goldboxQuerySchema.safeParse(req.query);
      if (!q.success) throw zodToAppError(q.error);
      const filtro = {
        dataIni: q.data.dataIni,
        dataFim: q.data.dataFim,
        codigoSap: q.data.codigoSap,
        usuario: q.data.usuario,
        tipo: q.data.tipo,
        reposicao: q.data.reposicao === undefined ? undefined : q.data.reposicao === 'true',
      };
      const movimentos = await goldboxService.consultarHistoricoGoldbox(
        {
          app,
          authUser: req.authUser!,
          dispositivo: (req.headers['x-device-id'] as string) ?? 'api',
          origem: 'ONLINE',
        },
        depositoId,
        filtro,
      );
      return { movimentos };
    },
  );

  app.post(
    '/deposits/:depositoId/goldbox/baixa',
    {
      preHandler: [authenticate, requireDepositoAcesso()],
      ...validateBody(baixaBodySchema),
    },
    async (req) => {
      const body = req.body as typeof baixaBodySchema._type;
      const { depositoId } = req.params as { depositoId: string };
      const res = await goldboxService.registrarBaixa(
        {
          app,
          authUser: req.authUser!,
          dispositivo: (req.headers['x-device-id'] as string) ?? 'api',
          origem: 'ONLINE',
        },
        { ...body, depositoId },
      );
      return {
        baixa: res.movimento,
        saldo: res.saldo,
        divergenciaCriada: res.divergenciaCriada,
        jaProcessada: res.jaProcessada,
      };
    },
  );

  app.post(
    '/deposits/:depositoId/goldbox/entrada',
    {
      preHandler: [requireAcao('ENTRADA_MATERIAL'), requireDepositoAcesso()],
      ...validateBody(entradaMaterialBodySchema),
    },
    async (req) => {
      const body = req.body as typeof entradaMaterialBodySchema._type;
      const { depositoId } = req.params as { depositoId: string };
      const res = await goldboxService.registrarEntrada(
        {
          app,
          authUser: req.authUser!,
          dispositivo: (req.headers['x-device-id'] as string) ?? 'api',
          origem: 'ONLINE',
        },
        { ...body, depositoId },
      );
      return {
        entrada: res.movimento,
        saldo: res.saldo,
        divergenciasFechadas: res.divergenciasFechadas,
        jaProcessada: res.jaProcessada,
      };
    },
  );

  app.post(
    '/deposits/:depositoId/goldbox/estorno',
    {
      preHandler: [requireAcao('ESTORNO'), requireDepositoAcesso()],
      ...validateBody(estornoBodySchema),
    },
    async (req) => {
      const body = req.body as typeof estornoBodySchema._type;
      const { depositoId } = req.params as { depositoId: string };
      const res = await goldboxService.estornarMovimento(
        {
          app,
          authUser: req.authUser!,
          dispositivo: (req.headers['x-device-id'] as string) ?? 'api',
          origem: 'ONLINE',
        },
        { ...body, depositoId },
      );
      return {
        estorno: res.movimento,
        saldo: res.saldo,
        jaProcessada: res.jaProcessada,
      };
    },
  );
}