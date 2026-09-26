import type { FastifyInstance } from 'fastify';
import { divergenceQuerySchema } from '@logenxoval/contracts';
import { authenticate, requireDepositoAcesso } from '../plugins/auth';
import { zodToAppError } from '../lib/errors';
import { listarDivergencias } from '../repos/divergenceRepo';

export async function registerDivergenceRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/deposits/:depositoId/divergences',
    { preHandler: [authenticate, requireDepositoAcesso()] },
    async (req) => {
      const { depositoId } = req.params as { depositoId: string };
      const q = divergenceQuerySchema.safeParse(req.query);
      if (!q.success) throw zodToAppError(q.error);
      const divergencias = await listarDivergencias(depositoId, req.authUser!.perfil, {
        status: q.data.status,
        tipo: q.data.tipo,
        limit: q.data.limit,
      });
      return { divergencias };
    },
  );
}