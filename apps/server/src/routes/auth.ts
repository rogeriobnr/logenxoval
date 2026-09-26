import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  loginBodySchema, logoutBodySchema, refreshBodySchema, changePasswordBodySchema, registerUserBodySchema,
  forgotPasswordBodySchema, resetPasswordBodySchema, changePinBodySchema,
} from '@logenxoval/contracts';
import { authenticate } from '../plugins/auth';
import { validateBody } from '../lib/validator';
import { AppError } from '../lib/errors';
import * as authService from '../services/authService';
import * as recoveryService from '../services/recoveryService';
import { listDepositsByUser } from '../repos/depositsRepo';
import { findById } from '../repos/usersRepo';

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const jwtSign = (p: { sub: string; matricula: string; perfil: string }) =>
    app.jwt.sign({ jti: randomUUID(), ...p }, { expiresIn: `${authService.ACCESS_TTL_S}s` });

  app.post(
    '/auth/login',
    { ...validateBody(loginBodySchema) },
    async (req) => {
      const body = req.body as typeof loginBodySchema._type;
      const deviceId = req.headers['x-device-id'] as string;
      if (!deviceId) throw new AppError('VALIDATION_FAILED', 'header X-Device-Id obrigatório', 400);
      return authService.login({
        matricula: body.matricula,
        senha: body.senha,
        deviceId,
        dispositivo: deviceId,
        deps: { jwtSign },
      });
    },
  );

  app.post(
    '/auth/register',
    { ...validateBody(registerUserBodySchema) },
    async (req) => {
      const body = req.body as typeof registerUserBodySchema._type;
      const user = await authService.publicoRegistrarUsuario({
        nome: body.nome,
        sobrenome: body.sobrenome,
        matricula: body.matricula,
        email: body.email.toLowerCase(),
        senha: body.senha,
        perfil: body.perfil,
        pin: body.pin,
        dispositivo: (req.headers['x-device-id'] as string) ?? undefined,
      });
      return {
        usuario: {
          id: user.id,
          matricula: user.matricula,
          nome: user.nome,
          sobrenome: user.sobrenome,
          email: user.email ?? undefined,
          perfil: user.perfil,
          status: user.status,
          temPin: user.temPin,
        },
        mensagem: 'Cadastro recebido. Um administrador precisa aprovar antes do primeiro login.',
      };
    },
  );

  app.post(
    '/auth/forgot-password',
    { ...validateBody(forgotPasswordBodySchema) },
    async (req) => {
      const body = req.body as typeof forgotPasswordBodySchema._type;
      await recoveryService.solicitarRecuperacao(body.email);
      return { ok: true, mensagem: 'Se o e-mail estiver cadastrado, enviamos o link de recuperação.' };
    },
  );

  app.post(
    '/auth/reset-password',
    { ...validateBody(resetPasswordBodySchema) },
    async (req) => {
      const body = req.body as typeof resetPasswordBodySchema._type;
      await recoveryService.redefinirSenhaComToken(body.token, body.novaSenha);
      return { ok: true, mensagem: 'Senha redefinida. Faça login com a nova senha.' };
    },
  );

  app.post(
    '/auth/change-pin',
    { preHandler: authenticate, ...validateBody(changePinBodySchema) },
    async (req) => {
      const body = req.body as typeof changePinBodySchema._type;
      await authService.alterarPinDoUsuario({
        userId: req.authUser!.sub,
        pinAtual: body.pinAtual,
        novoPin: body.novoPin,
        dispositivo: (req.headers['x-device-id'] as string) ?? 'api',
      });
      return { ok: true };
    },
  );

  app.post(
    '/auth/logout',
    { preHandler: authenticate },
    async (req) => {
      const deviceId = req.headers['x-device-id'] as string;
      await authService.logout({
        deviceId,
        usuarioId: req.authUser!.sub,
        matricula: req.authUser!.matricula,
        dispositivo: deviceId,
      });
      return { ok: true };
    },
  );

  app.post(
    '/auth/refresh',
    { ...validateBody(refreshBodySchema) },
    async (req) => {
      const body = req.body as typeof refreshBodySchema._type;
      return authService.refresh({
        refreshToken: body.refreshToken,
        deviceId: body.deviceId,
        deps: { jwtSign },
      });
    },
  );

  app.get('/auth/me', { preHandler: authenticate }, async (req) => {
    const user = await findById(req.authUser!.sub);
    if (!user) throw new Error('usuário não encontrado');
    const depositos = await listDepositsByUser(user.id, user.perfil);
    return {
      usuario: {
        id: user.id,
        matricula: user.matricula,
        nome: user.nome,
        sobrenome: user.sobrenome,
        perfil: user.perfil,
        status: user.status,
      },
      depositos: depositos.map((d) => ({ id: d.id, numero: d.numero, nome: d.nome })),
    };
  });

  app.post(
    '/auth/change-password',
    { preHandler: authenticate, ...validateBody(changePasswordBodySchema) },
    async (req) => {
      const body = req.body as typeof changePasswordBodySchema._type;
      await authService.changePassword({
        userId: req.authUser!.sub,
        senhaAtual: body.senhaAtual,
        novaSenha: body.novaSenha,
      });
      return { ok: true };
    },
  );
}