import { db, getStoredSession, type DepositoInfo, type SessionRecord } from '../db/db';
import { deriveLocalVerifier, verifierIgual } from './crypto';

export interface OfflineCredential {
  userId: string;
  matricula: string;
  nomeCompleto: string;
  perfil: string;
  depositos: DepositoInfo[];
  saltLocal: string;
  hashLocal: string;
  accessToken?: string;
  refreshToken?: string;
}

export const OFFLINE_CRED_NUNCA_CONHECIDO =
  'Esta matrícula nunca autenticou online neste aparelho. Conecte-se uma vez para habilitar o acesso offline.';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const agoraIso = () => new Date().toISOString();

export async function gravarCredencialOffline(cred: OfflineCredential): Promise<void> {
  await db.offlineCreds.put({ ...cred, atualizadoEm: agoraIso() });
}

export async function atualizarHashCredencialOffline(matricula: string, hashLocal: string): Promise<void> {
  const cred = await db.offlineCreds.get(matricula);
  if (cred) {
    await db.offlineCreds.put({ ...cred, hashLocal, atualizadoEm: agoraIso() });
  }
}

export async function removerCredencialOffline(matricula: string): Promise<void> {
  await db.offlineCreds.delete(matricula);
}

export type OfflineAuthResult =
  | { ok: true; session: SessionRecord }
  | { ok: false; code: string; message: string };

export async function autenticarOffline(matricula: string, senha: string): Promise<OfflineAuthResult> {
  const alvo = matricula.trim();
  const cred = await db.offlineCreds.get(alvo);
  if (!cred) {
    return { ok: false, code: 'OFFLINE_INDISPONIVEL', message: OFFLINE_CRED_NUNCA_CONHECIDO };
  }

  const hash = await deriveLocalVerifier(senha, cred.saltLocal);
  if (!verifierIgual(cred.hashLocal, hash)) {
    return { ok: false, code: 'UNAUTHORIZED', message: 'Matrícula ou senha inválidos' };
  }

  const anterior = await getStoredSession();
  const mesmoUsuario = anterior?.matricula === cred.matricula;
  const agora = agoraIso();
  const session: SessionRecord = {
    userId: cred.userId,
    matricula: cred.matricula,
    nomeCompleto: cred.nomeCompleto,
    perfil: cred.perfil,
    depositos: cred.depositos,
    depositoAtivo:
      mesmoUsuario && anterior.depositoAtivo
        ? anterior.depositoAtivo
        : (cred.depositos[0]?.id ?? ''),
    saltLocal: cred.saltLocal,
    hashLocal: cred.hashLocal,
    accessToken: mesmoUsuario ? (anterior!.accessToken ?? cred.accessToken) : cred.accessToken,
    refreshToken: mesmoUsuario ? (anterior!.refreshToken ?? cred.refreshToken) : cred.refreshToken,
    loginEm: agora,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    lastActivityAt: agora,
  };
  await db.session.put(session);
  return { ok: true, session };
}