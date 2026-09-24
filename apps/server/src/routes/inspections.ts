import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  correctionBodySchema,
  createInspectionBodySchema,
  finalizeInspectionBodySchema,
  revisionInspectionBodySchema,
  revertCorrectionBodySchema,
} from '@logenxoval/contracts';
import { authenticate, requireAcao, requireDepositoAcesso } from '../plugins/auth';
import { validateBody } from '../lib/validator';
import * as inspectionService from '../services/inspectionService';

interface InspecaoDeps {
  app: FastifyInstance;
  authUser: NonNullable<FastifyRequest['authUser']>;
  dispositivo: string;
  origem: 'ONLINE' | 'OFFLINE';
}

function depsOf(app: FastifyInstance, req: FastifyRequest): InspecaoDeps {
  return {
    app,
    authUser: req.authUser!,
    dispositivo: (req.headers['x-device-id'] as string) ?? 'api',
    origem: 'ONLINE',
  };
}

export async function registerInspectionRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/deposits/:depositoId/inspections',
    {
      preHandler: [requireAcao('CONFERENCIA'), requireDepositoAcesso()],
      ...validateBody(createInspectionBodySchema),
    },
    async (req) => {
      const body = req.body as typeof createInspectionBodySchema._type;
      const { depositoId } = req.params as { depositoId: string };
      const res = await inspectionService.iniciarConferencia(depsOf(app, req), { ...body, depositoId });
      return { inspecao: res.inspecao, itens: res.itens };
    },
  );

  app.get(
    '/deposits/:depositoId/inspections',
    { preHandler: [authenticate, requireDepositoAcesso()] },
    async (req) => {
      const { depositoId } = req.params as { depositoId: string };
      const conferencias = await inspectionService.consultarConferencias(depsOf(app, req), depositoId);
      return { conferencias };
    },
  );

  app.get(
    '/deposits/:depositoId/inspections/:inspecaoId',
    { preHandler: [authenticate, requireDepositoAcesso()] },
    async (req) => {
      const { depositoId, inspecaoId } = req.params as { depositoId: string; inspecaoId: string };
      return inspectionService.consultarConferencia(depsOf(app, req), depositoId, inspecaoId);
    },
  );

  app.post(
    '/deposits/:depositoId/inspections/:inspecaoId/finalize',
    {
      preHandler: [requireAcao('CONFERENCIA'), requireDepositoAcesso()],
      ...validateBody(finalizeInspectionBodySchema),
    },
    async (req) => {
      const body = req.body as typeof finalizeInspectionBodySchema._type;
      const { depositoId, inspecaoId } = req.params as { depositoId: string; inspecaoId: string };
      const res = await inspectionService.encerrarConferencia(depsOf(app, req), {
        ...body,
        depositoId,
        inspecaoId,
      });
      return { inspecao: res.inspecao, itens: res.itens };
    },
  );

  app.post(
    '/deposits/:depositoId/inspections/:inspecaoId/revision',
    {
      preHandler: [requireAcao('CONFERENCIA'), requireDepositoAcesso()],
      ...validateBody(revisionInspectionBodySchema),
    },
    async (req) => {
      const body = req.body as typeof revisionInspectionBodySchema._type;
      const { depositoId, inspecaoId } = req.params as { depositoId: string; inspecaoId: string };
      const res = await inspectionService.revisarConferencia(depsOf(app, req), { ...body, depositoId, inspecaoId });
      return { inspecao: res.inspecao, itens: res.itens };
    },
  );

  app.post(
    '/deposits/:depositoId/inspections/:inspecaoId/items/:itemId/correction',
    {
      preHandler: [requireAcao('CORRECAO'), requireDepositoAcesso()],
      ...validateBody(correctionBodySchema),
    },
    async (req) => {
      const body = req.body as typeof correctionBodySchema._type;
      const { depositoId, inspecaoId, itemId } = req.params as {
        depositoId: string;
        inspecaoId: string;
        itemId: string;
      };
      const res = await inspectionService.corrigirItem(depsOf(app, req), {
        ...body,
        depositoId,
        inspecaoId,
        itemId,
      });
      return { item: res.item, saldo: res.saldo, sparePartMovimento: res.sparePartMovimento };
    },
  );

  app.post(
    '/deposits/:depositoId/inspections/:inspecaoId/items/:itemId/revert-correction',
    {
      preHandler: [requireAcao('ESTORNO'), requireDepositoAcesso()],
      ...validateBody(revertCorrectionBodySchema),
    },
    async (req) => {
      const body = req.body as typeof revertCorrectionBodySchema._type;
      const { depositoId, inspecaoId, itemId } = req.params as {
        depositoId: string;
        inspecaoId: string;
        itemId: string;
      };
      return inspectionService.estornarCorrecao(depsOf(app, req), {
        ...body,
        depositoId,
        inspecaoId,
        itemId,
      });
    },
  );
}