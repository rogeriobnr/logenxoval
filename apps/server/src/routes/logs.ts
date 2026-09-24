import type { FastifyInstance } from 'fastify';
import { logsQuerySchema } from '@logenxoval/contracts';
import { authenticate, requireDepositoAcesso } from '../plugins/auth';
import { zodToAppError } from '../lib/errors';
import { listAuditLogs } from '../repos/auditLogRepo';

export async function registerLogRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/deposits/:depositoId/logs',
    { preHandler: [authenticate, requireDepositoAcesso()] },
    async (req) => {
      const { depositoId } = req.params as { depositoId: string };
      const q = logsQuerySchema.safeParse(req.query);
      if (!q.success) throw zodToAppError(q.error);
      const logs = await listAuditLogs({
        depositoId,
        tipos: q.data.tipo ? [q.data.tipo] : undefined,
        matricula: q.data.matricula,
        dataIni: q.data.dataIni,
        dataFim: q.data.dataFim,
        limit: q.data.limit ?? 500,
      });
      return { logs };
    },
  );
}