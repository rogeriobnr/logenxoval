import type { FastifyInstance } from 'fastify';
import { restoreSnapshotBodySchema, snapshotIdParamSchema } from '@logenxoval/contracts';
import { authenticate, requireAcao, requireDepositoAcesso } from '../plugins/auth';
import { validateBody } from '../lib/validator';
import { zodToAppError } from '../lib/errors';
import { listSnapshots } from '../repos/snapshotRepo';
import { restaurarSnapshot } from '../services/restoreService';

export async function registerSnapshotRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/deposits/:depositoId/snapshots',
    { preHandler: [authenticate, requireDepositoAcesso()] },
    async (req) => {
      const { depositoId } = req.params as { depositoId: string };
      const snapshots = await listSnapshots(depositoId, req.authUser!.perfil);
      return { snapshots };
    },
  );

  app.post(
    '/deposits/:depositoId/snapshots/:snapshotId/restore',
    {
      preHandler: [requireAcao('RESTAURAR'), requireDepositoAcesso()],
      ...validateBody(restoreSnapshotBodySchema),
    },
    async (req) => {
      const p = snapshotIdParamSchema.safeParse(req.params as { depositoId: string; snapshotId: string });
      if (!p.success) throw zodToAppError(p.error);
      const { depositoId, snapshotId } = p.data;
      const body = req.body as typeof restoreSnapshotBodySchema._type;
      const res = await restaurarSnapshot(
        {
          app,
          authUser: req.authUser!,
          dispositivo: (req.headers['x-device-id'] as string) ?? 'api',
          origem: 'ONLINE',
        },
        {
          depositoId,
          snapshotId,
          motivo: body.motivo,
          matriculaConfirmacao: body.matriculaConfirmacao,
          pin: body.pin,
        },
      );
      return { versao: res.versao, itens: res.itens };
    },
  );
}