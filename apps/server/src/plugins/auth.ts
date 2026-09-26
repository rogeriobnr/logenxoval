import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Perfil } from '@logenxoval/contracts';
import { AppError } from '../lib/errors';
import { podeExecutar, type Acao } from '../domain/permissions';
import { userHasDepositAccess } from '../repos/depositsRepo';
import { findByDeviceId, revokeByDeviceId, touchActivity } from '../repos/sessionsRepo';
import { insertAuditLog } from '../repos/auditLogRepo';
import { INACTIVITY_TTL_MS } from '../services/authService';

export interface AuthUser {
  sub: string;
  matricula: string;
  perfil: Perfil;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

export async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await req.jwtVerify();
    const payload = req.user as AuthUser;
    const deviceId = req.headers['x-device-id'] as string | undefined;
    if (deviceId) {
      const session = await findByDeviceId(deviceId);
      if (!session || session.userId !== payload.sub) {
        reply.status(401).send({
          error: { code: 'UNAUTHORIZED', message: 'Sessão revogada no servidor' },
        });
        return;
      }
      if (Date.now() > new Date(session.expiresAt).getTime()) {
        await revokeByDeviceId(deviceId);
        reply.status(401).send({
          error: { code: 'UNAUTHORIZED', message: 'Sessão expirada' },
        });
        return;
      }
      if (Date.now() - new Date(session.lastActivityAt).getTime() > INACTIVITY_TTL_MS) {
        await revokeByDeviceId(deviceId);
        await insertAuditLog({
          tipo: 'BLOQUEIO_INATIVIDADE',
          usuarioId: payload.sub,
          matricula: payload.matricula,
          entidade: 'sessions',
          origem: 'ONLINE',
          dispositivo: deviceId,
        });
        reply.status(401).send({
          error: { code: 'UNAUTHORIZED', message: 'Sessão expirada por inatividade' },
        });
        return;
      }
      await touchActivity(deviceId);
    }
    req.authUser = { sub: payload.sub, matricula: payload.matricula, perfil: payload.perfil };
  } catch {
    reply.status(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Token inválido ou ausente' },
    });
  }
}

export function requireAcao(acao: Acao) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authenticate(req, reply);
    const user = req.authUser!;
    if (!podeExecutar(user.perfil, acao)) {
      reply.status(403).send({
        error: { code: 'PERMISSAO_NEGADA', message: 'Perfil não permite esta ação' },
      });
    }
  };
}

export function requireDepositoAcesso() {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!req.authUser) {
      await authenticate(req, reply);
    }
    const user = req.authUser!;
    const depositoId = (req.params as { depositoId?: string }).depositoId;
    if (!depositoId) {
      reply.status(400).send({ error: { code: 'VALIDATION_FAILED', message: 'depositoId ausente' } });
      return;
    }
    const ok = await userHasDepositAccess(user.sub, depositoId, user.perfil);
    if (!ok) {
      reply.status(403).send({
        error: { code: 'DEPOSITO_NAO_AUTORIZADO', message: 'Depósito não autorizado para o usuário' },
      });
    }
  };
}

export function confirmarMatricula(matricula: string) {
  return (req: FastifyRequest): void => {
    if (!req.authUser) throw new AppError('UNAUTHORIZED', 'Não autenticado', 401);
    if (req.authUser.matricula !== matricula) {
      throw new AppError('MATRICULA_INVALIDA', 'Matrícula de confirmação não corresponde ao usuário logado', 403);
    }
  };
}

/**
 * Valida o PIN DO PRÓPRIO usuário logado (fase 14). Usuário sem PIN definido
 * não exige PIN — quem define o PIN (cadastro, admin) passa a precisar dele.
 */
export async function verificarPinDoUsuario(
  pin: string | undefined,
  _app: FastifyInstance,
  usuarioId: string,
): Promise<void> {
  const { getPinHashById } = await import('../repos/usersRepo');
  const pinHash = await getPinHashById(usuarioId);
  if (!pinHash) return; // usuário sem PIN → não exigir
  if (!pin) throw new AppError('PERMISSAO_NEGADA', 'PIN obrigatório', 403);
  const bcrypt = (await import('bcryptjs')).default;
  const ok = await bcrypt.compare(pin, pinHash);
  if (!ok) throw new AppError('PERMISSAO_NEGADA', 'PIN inválido', 403);
}