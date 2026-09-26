import type { FastifyInstance } from 'fastify';
import {
  createUserBodySchema,
  grantUserDepositBodySchema,
  revokeUserDepositBodySchema,
  updateUserBodySchema,
} from '@logenxoval/contracts';
import { requireAcao } from '../plugins/auth';
import { validateBody } from '../lib/validator';
import * as authService from '../services/authService';

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  const dispositivo = (deviceId: unknown) => (deviceId as string) ?? 'api';

  app.get('/users', { preHandler: requireAcao('GERENCIAR_USUARIOS') }, async () => {
    const users = await authService.adminListUsersComDepositos();
    return { usuarios: users };
  });

  app.post(
    '/users',
    { preHandler: requireAcao('GERENCIAR_USUARIOS'), ...validateBody(createUserBodySchema) },
    async (req) => {
      const body = req.body as typeof createUserBodySchema._type;
      const user = await authService.adminCreateUser({
        nome: body.nome,
        sobrenome: body.sobrenome,
        matricula: body.matricula,
        senha: body.senha,
        perfil: body.perfil,
        log: {
          usuarioId: req.authUser!.sub,
          matricula: req.authUser!.matricula,
          dispositivo: dispositivo(req.headers['x-device-id']),
        },
      });
      return { usuario: user };
    },
  );

  app.patch(
    '/users/:id',
    { preHandler: requireAcao('GERENCIAR_USUARIOS'), ...validateBody(updateUserBodySchema) },
    async (req) => {
      const body = req.body as typeof updateUserBodySchema._type;
      const id = (req.params as { id: string }).id;
      await authService.adminUpdateUser({
        id,
        status: body.status,
        perfil: body.perfil,
        log: {
          usuarioId: req.authUser!.sub,
          matricula: req.authUser!.matricula,
          dispositivo: dispositivo(req.headers['x-device-id']),
        },
      });
      return { ok: true };
    },
  );

  app.post(
    '/users/:id/deposits',
    { preHandler: requireAcao('GERENCIAR_USUARIOS'), ...validateBody(grantUserDepositBodySchema) },
    async (req) => {
      const body = req.body as typeof grantUserDepositBodySchema._type;
      const id = (req.params as { id: string }).id;
      await authService.adminDesignarDeposito({
        app,
        alvoId: id,
        depositoId: body.depositoId,
        matriculaConfirmacao: body.matriculaConfirmacao,
        pin: body.pin,
        log: {
          usuarioId: req.authUser!.sub,
          matricula: req.authUser!.matricula,
          dispositivo: dispositivo(req.headers['x-device-id']),
        },
      });
      return { ok: true };
    },
  );

  app.delete(
    '/users/:id/deposits/:depositoId',
    { preHandler: requireAcao('GERENCIAR_USUARIOS'), ...validateBody(revokeUserDepositBodySchema) },
    async (req) => {
      const body = req.body as typeof revokeUserDepositBodySchema._type;
      const { id, depositoId } = req.params as { id: string; depositoId: string };
      await authService.adminRevogarDeposito({
        app,
        alvoId: id,
        depositoId,
        matriculaConfirmacao: body.matriculaConfirmacao,
        pin: body.pin,
        log: {
          usuarioId: req.authUser!.sub,
          matricula: req.authUser!.matricula,
          dispositivo: dispositivo(req.headers['x-device-id']),
        },
      });
      return { ok: true };
    },
  );
}