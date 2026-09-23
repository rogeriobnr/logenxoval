import type { FastifyInstance } from 'fastify';
import { importEnxovalBodySchema } from '@logenxoval/contracts';
import { authenticate, requireAcao, requireDepositoAcesso } from '../plugins/auth';
import { validateBody } from '../lib/validator';
import * as enxovalService from '../services/enxovalService';

export async function registerEnxovalRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/deposits/:depositoId/enxoval',
    { preHandler: [authenticate, requireDepositoAcesso()] },
    async (req) => {
      const { depositoId } = req.params as { depositoId: string };
      const res = await enxovalService.consultarEnxoval(
        {
          app,
          authUser: req.authUser!,
          dispositivo: (req.headers['x-device-id'] as string) ?? 'api',
          origem: 'ONLINE',
        },
        depositoId,
      );
      return { versao: res.versao, itens: res.itens };
    },
  );

  app.get(
    '/deposits/:depositoId/enxoval/versions',
    { preHandler: [authenticate, requireDepositoAcesso()] },
    async (req) => {
      const { depositoId } = req.params as { depositoId: string };
      const versoes = await enxovalService.consultarVersoes(
        {
          app,
          authUser: req.authUser!,
          dispositivo: (req.headers['x-device-id'] as string) ?? 'api',
          origem: 'ONLINE',
        },
        depositoId,
      );
      return { versoes };
    },
  );

  app.get(
    '/deposits/:depositoId/enxoval/versions/:versionId',
    { preHandler: [authenticate, requireDepositoAcesso()] },
    async (req) => {
      const { depositoId, versionId } = req.params as { depositoId: string; versionId: string };
      const res = await enxovalService.consultarVersao(
        {
          app,
          authUser: req.authUser!,
          dispositivo: (req.headers['x-device-id'] as string) ?? 'api',
          origem: 'ONLINE',
        },
        depositoId,
        versionId,
      );
      return { versao: res.versao, itens: res.itens };
    },
  );

  app.post(
    '/deposits/:depositoId/enxoval/import',
    {
      preHandler: [requireAcao('IMPORTAR_ENXOVAL'), requireDepositoAcesso()],
      ...validateBody(importEnxovalBodySchema),
    },
    async (req) => {
      const body = req.body as typeof importEnxovalBodySchema._type;
      const { depositoId } = req.params as { depositoId: string };
      const res = await enxovalService.importarEnxoval(
        {
          app,
          authUser: req.authUser!,
          dispositivo: (req.headers['x-device-id'] as string) ?? 'api',
          origem: 'ONLINE',
        },
        {
          depositoId,
          documentoId: body.documentoId,
          refFolha: body.refFolha,
          motivo: body.motivo,
          matriculaConfirmacao: body.matriculaConfirmacao,
          pin: body.pin,
          itens: body.itens,
        },
      );
      return { versao: res.versao, itens: res.itens };
    },
  );
}