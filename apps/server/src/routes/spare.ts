import type { FastifyInstance } from 'fastify';
import { authenticate, requireDepositoAcesso } from '../plugins/auth';
import { listarPecasAvulsas } from '../repos/spareRepo';

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
}