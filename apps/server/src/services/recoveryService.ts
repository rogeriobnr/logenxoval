import bcrypt from 'bcryptjs';
import { AppError } from '../lib/errors';
import { loadEnv } from '../env';
import { enviarEmail } from '../lib/mail';
import { newToken, sha256Hex } from '../lib/crypto';
import {
  findByEmail,
  findById,
  getPinHashById,
  revokeSessionsByUser,
  updatePin,
  updateSenha,
} from '../repos/usersRepo';
import {
  criarReset,
  encontrarResetValido,
  limparResetsVencidosDe,
  marcarUsado,
} from '../repos/passwordResetRepo';
import {
  criarResetPin,
  encontrarResetPinValido,
  limparResetsPinDe,
  marcarResetPinUsado,
} from '../repos/pinResetRepo';
import { insertAuditLog } from '../repos/auditLogRepo';

export const RESET_TTL_MS = 30 * 60 * 1000;

export async function solicitarRecuperacao(email: string): Promise<void> {
  const user = await findByEmail(email.trim().toLowerCase());
  if (!user) return; // não revelar existência de contas

  const token = newToken(32);
  const tokenHash = sha256Hex(token);
  await criarReset({
    userId: user.id,
    tokenHash,
    expiraEmIso: new Date(Date.now() + RESET_TTL_MS).toISOString(),
  });

  const env = loadEnv();
  const base = env.APP_URL ?? 'http://localhost:5173';
  const link = `${base}/?recuperar=${token}`;
  const res = await enviarEmail({
    para: user.email!,
    assunto: 'Recuperação de senha — LogEnxoval',
    texto: `Recebemos um pedido de redefinição de senha para sua conta no LogEnxoval.\n\nAbra o link abaixo (válido por 30 minutos):\n\n${link}\n\nSe não foi você, ignore este e-mail.`,
  });
  if (!res.entregue) {
    console.log(`[mail] SMTP não configurado — link de recuperação para ${user.email}:\n${res.alternativo}`);
  }
}

export async function redefinirSenhaComToken(token: string, novaSenha: string): Promise<void> {
  const reset = await encontrarResetValido(sha256Hex(token));
  if (!reset) throw new AppError('VALIDATION_FAILED', 'Link inválido ou expirado', 400);
  const user = await findById(reset.userId);
  if (!user) throw new AppError('VALIDATION_FAILED', 'Link inválido ou expirado', 400);

  await marcarUsado(reset.id);
  await updateSenha(user.id, await bcrypt.hash(novaSenha, 12));
  await revokeSessionsByUser(user.id);
  await limparResetsVencidosDe(user.id);
  await insertAuditLog({
    tipo: 'EDICAO_USUARIO',
    usuarioId: user.id,
    matricula: user.matricula,
    entidade: 'users',
    operacaoId: user.id,
    estadoPosterior: { senhaRedefinida: true },
    origem: 'ONLINE',
    dispositivo: 'recuperacao',
  });
}

/**
 * Fase 22: recuperação do próprio PIN por e-mail. Sem isso, quem esquecesse o
 * PIN ficava travado — redefinir PIN de terceiros e as ações sensíveis
 * (`ACTION_REQUIRES_PIN`) exigem o PIN do usuário logado. Não revoga sessões:
 * o usuário não perde o acesso nem o espelho local.
 */
export async function solicitarRecuperacaoPin(email: string): Promise<void> {
  const user = await findByEmail(email.trim().toLowerCase());
  if (!user || !user.email) return; // não revelar existência de contas

  const token = newToken(32);
  await criarResetPin({
    userId: user.id,
    tokenHash: sha256Hex(token),
    expiraEmIso: new Date(Date.now() + RESET_TTL_MS).toISOString(),
  });

  const env = loadEnv();
  const base = env.APP_URL ?? 'http://localhost:5173';
  const link = `${base}/?recuperar-pin=${token}`;
  const res = await enviarEmail({
    para: user.email,
    assunto: 'Recuperação de PIN — LogEnxoval',
    texto: `Recebemos um pedido de redefinição do seu PIN no LogEnxoval.\n\nAbra o link abaixo (válido por 30 minutos):\n\n${link}\n\nSe não foi você, ignore este e-mail.`,
  });
  if (!res.entregue) {
    console.log(`[mail] SMTP não configurado — link de recuperação de PIN para ${user.email}:\n${res.alternativo}`);
  }
}

export async function redefinirPinComToken(token: string, novoPin: string): Promise<void> {
  const reset = await encontrarResetPinValido(sha256Hex(token));
  if (!reset) throw new AppError('VALIDATION_FAILED', 'Link inválido ou expirado', 400);
  const user = await findById(reset.userId);
  if (!user) throw new AppError('VALIDATION_FAILED', 'Link inválido ou expirado', 400);

  const pinAnteriorDefinido = Boolean(await getPinHashById(user.id));
  await marcarResetPinUsado(reset.id);
  await updatePin(user.id, await bcrypt.hash(novoPin, 10));
  await limparResetsPinDe(user.id);
  await insertAuditLog({
    tipo: 'EDICAO_USUARIO',
    usuarioId: user.id,
    matricula: user.matricula,
    entidade: 'users',
    operacaoId: user.id,
    estadoAnterior: { pinDefinido: pinAnteriorDefinido },
    estadoPosterior: { pinRedefinido: true, viaRecuperacao: true },
    origem: 'ONLINE',
    dispositivo: 'recuperacao',
  });
}