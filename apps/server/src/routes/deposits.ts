import type { FastifyInstance } from 'fastify';
import {
  createDepositoBodySchema,
  deactivateDepositoBodySchema,
  updateDepositoBodySchema,
} from '@logenxoval/contracts';
import { authenticate, requireAcao, requireDepositoAcesso } from '../plugins/auth';
import { validateBody } from '../lib/validator';
import { listDepositsByUser, findDepositById } from '../repos/depositsRepo';
import * as depositService from '../services/depositService';

export async function registerDepositRoutes(app: FastifyInstance): Promise<void> {
  app.get('/deposits', { preHandler: authenticate }, async (req) => {
    const user = req.authUser!;
    const deposits = await listDepositsByUser(user.sub, user.perfil);
    return { depositos: deposits };
  });

  app.post(
    '/deposits',
    { preHandler: requireAcao('CRIAR_DEPOSITO'), ...validateBody(createDepositoBodySchema) },
    async (req) => {
      const body = req.body as typeof createDepositoBodySchema._type;
      const dep = await depositService.criarDeposito(
        {
          app,
          authUser: req.authUser!,
          dispositivo: (req.headers['x-device-id'] as string) ?? 'api',
          origem: 'ONLINE',
        },
        body,
      );
      return { deposito: dep };
    },
  );

  app.get(
    '/deposits/:depositoId',
    { preHandler: [authenticate, requireDepositoAcesso()] },
    async (req) => {
      const { depositoId } = req.params as { depositoId: string };
      const dep = await findDepositById(depositoId);
      if (!dep) throw new Error('depósito não encontrado');
      return { deposito: dep };
    },
  );

  app.patch(
    '/deposits/:depositoId',
    {
      preHandler: [requireAcao('EDITAR_DEPOSITO'), requireDepositoAcesso()],
      ...validateBody(updateDepositoBodySchema),
    },
    async (req) => {
      const body = req.body as typeof updateDepositoBodySchema._type;
      const { depositoId } = req.params as { depositoId: string };
      const dep = await depositService.editarDeposito(
        {
          app,
          authUser: req.authUser!,
          dispositivo: (req.headers['x-device-id'] as string) ?? 'api',
          origem: 'ONLINE',
        },
        { depositoId, nome: body.nome!, matriculaConfirmacao: body.matriculaConfirmacao, pin: body.pin },
      );
      return { deposito: dep };
    },
  );

  app.post(
    '/deposits/:depositoId/deactivate',
    {
      preHandler: [requireAcao('DESATIVAR_DEPOSITO'), requireDepositoAcesso()],
      ...validateBody(deactivateDepositoBodySchema),
    },
    async (req) => {
      const body = req.body as typeof deactivateDepositoBodySchema._type;
      const { depositoId } = req.params as { depositoId: string };
      const dep = await depositService.desativarDeposito(
        {
          app,
          authUser: req.authUser!,
          dispositivo: (req.headers['x-device-id'] as string) ?? 'api',
          origem: 'ONLINE',
        },
        { depositoId, motivo: body.motivo, matriculaConfirmacao: body.matriculaConfirmacao, pin: body.pin },
      );
      return { deposito: dep };
    },
  );
}