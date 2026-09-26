import type { FastifyInstance } from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  createUserBodySchema,
  grantUserDepositBodySchema,
  revokeUserDepositBodySchema,
  updateUserBodySchema,
} from '@logenxoval/contracts';
import { authenticate, requireAcao } from '../plugins/auth';
import { podeExecutar } from '../domain/permissions';
import { validateBody } from '../lib/validator';
import { AppError } from '../lib/errors';
import * as authService from '../services/authService';

/**
 * Permite ver/criar usuários para ADMIN (gestão completa) e LIDER (cria e vê a
 * lista de não-admins). PATCH/designação continuam restritos ao ADMIN.
 */
function gerenciarOuCriarUsuarios(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  return (async () => {
    await authenticate(req, reply);
    const user = req.authUser!;
    if (!podeExecutar(user.perfil, 'GERENCIAR_USUARIOS') && !podeExecutar(user.perfil, 'CRIAR_USUARIOS')) {
      reply.status(403).send({
        error: { code: 'PERMISSAO_NEGADA', message: 'Perfil não permite esta ação' },
      });
    }
  })();
}

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  const dispositivo = (deviceId: unknown) => (deviceId as string) ?? 'api';

  app.get('/users', { preHandler: gerenciarOuCriarUsuarios }, async (req) => {
    const actor = req.authUser!.perfil;
    const users = await authService.adminListUsersComDepositos({
      omitirAdmin: !podeExecutar(actor, 'GERENCIAR_USUARIOS'),
    });
    return { usuarios: users };
  });

  app.post(
    '/users',
    { preHandler: gerenciarOuCriarUsuarios, ...validateBody(createUserBodySchema) },
    async (req) => {
      const body = req.body as typeof createUserBodySchema._type;
      if (body.perfil === 'ADMIN' && req.authUser!.perfil !== 'ADMIN') {
        throw new AppError('PERMISSAO_NEGADA', 'Somente o administrador pode criar usuários ADMIN', 403);
      }
      const user = await authService.adminCreateUser({
        nome: body.nome,
        sobrenome: body.sobrenome,
        matricula: body.matricula,
        email: body.email.toLowerCase(),
        senha: body.senha,
        perfil: body.perfil,
        pin: body.pin,
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
      const log = {
        usuarioId: req.authUser!.sub,
        matricula: req.authUser!.matricula,
        dispositivo: dispositivo(req.headers['x-device-id']),
      };
      if (body.status !== undefined || body.perfil !== undefined) {
        await authService.adminUpdateUser({ id, status: body.status, perfil: body.perfil, log });
      }
      if (body.novoPin !== undefined) {
        await authService.adminRedefinirPin({ id, novoPin: body.novoPin, log });
      }
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