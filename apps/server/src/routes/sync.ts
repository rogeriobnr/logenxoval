import type { FastifyInstance } from 'fastify';
import { syncBodySchema } from '@logenxoval/contracts';
import { authenticate } from '../plugins/auth';
import { validateBody } from '../lib/validator';
import { processarSync } from '../services/syncService';

export async function registerSyncRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/sync',
    {
      preHandler: [authenticate],
      ...validateBody(syncBodySchema),
    },
    async (req) => {
      const body = req.body as typeof syncBodySchema._type;
      const res = await processarSync(
        {
          app,
          authUser: req.authUser!,
          dispositivo: (req.headers['x-device-id'] as string) ?? 'api',
        },
        body,
      );
      // Pull (delta) é feito pelo espelho local após o push (espelharDepositos).
      return res;
    },
  );
}