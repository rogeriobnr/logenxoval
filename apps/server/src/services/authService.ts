import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import type { Perfil } from '@logenxoval/contracts';
import { AppError } from '../lib/errors';
import { newId, newToken } from '../lib/crypto';
import {
  createUser,
  findById,
  findByMatricula,
  listUsers,
  revokeSessionsByUser,
  updateUserStatus,
} from '../repos/usersRepo';
import {
  findByDeviceId,
  hashToken,
  revokeByDeviceId,
  touchActivity,
  upsertSession,
} from '../repos/sessionsRepo';
import {
  findDepositById,
  grantDepositAccess,
  listDepositsByUser,
  listUserDepositGrants,
  revokeDepositAccess,
} from '../repos/depositsRepo';
import { insertAuditLog } from '../repos/auditLogRepo';

export const ACCESS_TTL_S = 15 * 60;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const INACTIVITY_TTL_MS = 15 * 60 * 1000;

export interface AuthDeps {
  jwtSign: (payload: { sub: string; matricula: string; perfil: Perfil }) => string;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  usuario: { id: string; matricula: string; nome: string; sobrenome: string; perfil: Perfil; status: string };
  depositos: Array<{ id: string; numero: string; nome: string }>;
  saltLocal: string;
}

export async function login(opts: {
  matricula: string;
  senha: string;
  deviceId: string;
  dispositivo: string;
  deps: AuthDeps;
}): Promise<AuthResult> {
  const user = await findByMatricula(opts.matricula.trim());
  if (!user) throw new AppError('UNAUTHORIZED', 'Matrícula ou senha inválidos', 401);
  if (user.status === 'BLOQUEADO') throw new AppError('PERMISSAO_NEGADA', 'Usuário bloqueado', 403);

  const ok = await bcrypt.compare(opts.senha, user.senhaHash);
  if (!ok) throw new AppError('UNAUTHORIZED', 'Matrícula ou senha inválidos', 401);

  const refreshToken = newToken(32);
  await upsertSession({
    userId: user.id,
    deviceId: opts.deviceId,
    refreshTokenHash: hashToken(refreshToken),
    expiresAtIso: new Date(Date.now() + REFRESH_TTL_MS).toISOString(),
  });

  const accessToken = opts.deps.jwtSign({
    sub: user.id,
    matricula: user.matricula,
    perfil: user.perfil,
  });

  const depositos = await listDepositsByUser(user.id, user.perfil);

  await insertAuditLog({
    tipo: 'LOGIN',
    usuarioId: user.id,
    matricula: user.matricula,
    entidade: 'sessions',
    origem: 'ONLINE',
    dispositivo: opts.deviceId,
  });

  return {
    accessToken,
    refreshToken,
    usuario: {
      id: user.id,
      matricula: user.matricula,
      nome: user.nome,
      sobrenome: user.sobrenome,
      perfil: user.perfil,
      status: user.status,
    },
    depositos: depositos.map((d) => ({ id: d.id, numero: d.numero, nome: d.nome })),
    saltLocal: newToken(16),
  };
}

export async function logout(opts: {
  deviceId: string;
  usuarioId: string;
  matricula: string;
  dispositivo: string;
}): Promise<void> {
  const user = await findById(opts.usuarioId);
  await revokeByDeviceId(opts.deviceId);
  await insertAuditLog({
    tipo: 'LOGOUT',
    usuarioId: opts.usuarioId,
    matricula: opts.matricula,
    entidade: 'sessions',
    origem: 'ONLINE',
    dispositivo: opts.deviceId,
  });
  return user ? undefined : undefined;
}

export async function refresh(opts: {
  refreshToken: string;
  deviceId: string;
  deps: AuthDeps;
}): Promise<{ accessToken: string; refreshToken: string }> {
  const session = await findByDeviceId(opts.deviceId);
  if (!session) throw new AppError('UNAUTHORIZED', 'Sessão não encontrada', 401);
  if (hashToken(opts.refreshToken) !== session.tokenHash) {
    throw new AppError('UNAUTHORIZED', 'Refresh token inválido', 401);
  }
  if (Date.now() > new Date(session.expiresAt).getTime()) {
    throw new AppError('UNAUTHORIZED', 'Sessão expirada', 401);
  }
  const user = await findById(session.userId);
  if (!user || user.status === 'BLOQUEADO') {
    throw new AppError('PERMISSAO_NEGADA', 'Usuário bloqueado', 403);
  }
  const newRefresh = newToken(32);
  await upsertSession({
    userId: user.id,
    deviceId: opts.deviceId,
    refreshTokenHash: hashToken(newRefresh),
    expiresAtIso: new Date(Date.now() + REFRESH_TTL_MS).toISOString(),
  });
  await touchActivity(opts.deviceId);
  return {
    accessToken: opts.deps.jwtSign({
      sub: user.id,
      matricula: user.matricula,
      perfil: user.perfil,
    }),
    refreshToken: newRefresh,
  };
}

export async function changePassword(opts: {
  userId: string;
  senhaAtual: string;
  novaSenha: string;
}): Promise<void> {
  const user = await findById(opts.userId);
  if (!user) throw new AppError('NAO_ENCONTRADO', 'Usuário não encontrado', 404);
  const stored = await findByMatricula(user.matricula);
  if (!stored || !(await bcrypt.compare(opts.senhaAtual, stored.senhaHash))) {
    throw new AppError('UNAUTHORIZED', 'Senha atual incorreta', 401);
  }
  const novoHash = await bcrypt.hash(opts.novaSenha, 12);
  const { getPool } = await import('../db/pool');
  const pool = getPool();
  await pool.query(
    "UPDATE users SET senha_hash = $2 WHERE id = $1",
    [opts.userId, novoHash],
  );
}

export async function adminCreateUser(opts: {
  nome: string;
  sobrenome: string;
  matricula: string;
  senha: string;
  perfil: Perfil;
  log: { usuarioId: string; matricula: string; dispositivo: string };
}): Promise<ReturnType<typeof createUser>> {
  const senhaHash = await bcrypt.hash(opts.senha, 12);
  const user = await createUser({
    matricula: opts.matricula,
    nome: opts.nome,
    sobrenome: opts.sobrenome,
    perfil: opts.perfil,
    senhaHash,
  });
  await insertAuditLog({
    tipo: 'CRIACAO_USUARIO',
    usuarioId: opts.log.usuarioId,
    matricula: opts.log.matricula,
    entidade: 'users',
    operacaoId: user.id,
    estadoPosterior: { matricula: user.matricula, perfil: user.perfil },
    origem: 'ONLINE',
    dispositivo: opts.log.dispositivo,
  });
  return user;
}

export async function adminUpdateUser(opts: {
  id: string;
  status?: 'ATIVO' | 'BLOQUEADO';
  perfil?: Perfil;
  log: { usuarioId: string; matricula: string; dispositivo: string };
}): Promise<void> {
  const alvo = await findById(opts.id);
  if (!alvo) throw new AppError('NAO_ENCONTRADO', 'Usuário não encontrado', 404);
  const status = opts.status ?? alvo.status;
  const perfil = opts.perfil ?? alvo.perfil;
  await updateUserStatus(opts.id, status, perfil);
  if (status === 'BLOQUEADO') {
    await revokeSessionsByUser(opts.id);
  }
  await insertAuditLog({
    tipo: 'EDICAO_USUARIO',
    usuarioId: opts.log.usuarioId,
    matricula: opts.log.matricula,
    entidade: 'users',
    operacaoId: opts.id,
    estadoAnterior: { status: alvo.status, perfil: alvo.perfil },
    estadoPosterior: { status, perfil },
    origem: 'ONLINE',
    dispositivo: opts.log.dispositivo,
  });
}

export async function adminListUsers(): Promise<ReturnType<typeof listUsers>> {
  return listUsers();
}

type UserRowBase = Awaited<ReturnType<typeof listUsers>>[number];

export async function adminListUsersComDepositos(): Promise<
  Array<UserRowBase & { depositoIds: string[] }>
> {
  const users = await listUsers();
  const grants = await listUserDepositGrants();
  const porUsuario = new Map(grants.map((g) => [g.userId, g.depositoIds]));
  return users.map((u) => ({ ...u, depositoIds: porUsuario.get(u.id) ?? [] }));
}

type LogContext = { usuarioId: string; matricula: string; dispositivo: string };

function requireNonNull<T>(v: T | null): T {
  if (v === null) throw new AppError('NAO_ENCONTRADO', 'Registro não encontrado', 404);
  return v;
}

export async function adminDesignarDeposito(opts: {
  app: FastifyInstance;
  alvoId: string;
  depositoId: string;
  matriculaConfirmacao: string;
  pin?: string;
  log: LogContext;
}): Promise<void> {
  if (opts.matriculaConfirmacao !== opts.log.matricula) {
    throw new AppError('MATRICULA_INVALIDA', 'Matrícula de confirmação inválida', 403);
  }
  const { verificarPinSeConfigurado } = await import('../plugins/auth');
  await verificarPinSeConfigurado(opts.pin, opts.app);

  const alvo = requireNonNull(await findById(opts.alvoId));
  const dep = requireNonNull(await findDepositById(opts.depositoId));

  await grantDepositAccess({
    userId: alvo.id,
    depositoId: dep.id,
    concedidoPor: opts.log.matricula,
  });

  await insertAuditLog({
    tipo: 'DESIGNACAO_DEPOSITO',
    usuarioId: opts.log.usuarioId,
    matricula: opts.log.matricula,
    depositoId: dep.id,
    entidade: 'user_deposits',
    operacaoId: dep.id,
    estadoPosterior: { matricula: alvo.matricula, depositoId: dep.id, numero: dep.numero },
    origem: 'ONLINE',
    dispositivo: opts.log.dispositivo,
  });
}

export async function adminRevogarDeposito(opts: {
  app: FastifyInstance;
  alvoId: string;
  depositoId: string;
  matriculaConfirmacao: string;
  pin?: string;
  log: LogContext;
}): Promise<void> {
  if (opts.matriculaConfirmacao !== opts.log.matricula) {
    throw new AppError('MATRICULA_INVALIDA', 'Matrícula de confirmação inválida', 403);
  }
  const { verificarPinSeConfigurado } = await import('../plugins/auth');
  await verificarPinSeConfigurado(opts.pin, opts.app);

  const alvo = requireNonNull(await findById(opts.alvoId));
  const dep = requireNonNull(await findDepositById(opts.depositoId));

  await revokeDepositAccess({
    userId: alvo.id,
    depositoId: dep.id,
    revogadoPor: opts.log.matricula,
  });

  await insertAuditLog({
    tipo: 'REVOGACAO_DEPOSITO',
    usuarioId: opts.log.usuarioId,
    matricula: opts.log.matricula,
    depositoId: dep.id,
    entidade: 'user_deposits',
    operacaoId: dep.id,
    estadoPosterior: { matricula: alvo.matricula, depositoId: dep.id, numero: dep.numero },
    origem: 'ONLINE',
    dispositivo: opts.log.dispositivo,
  });
}

export { newId };