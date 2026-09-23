import Dexie, { type Table } from 'dexie';

/** Chave/valor persistido no IndexedDB (deviceId, salt, hash PBKDF2, etc.). */
export interface KvRecord {
  key: string;
  value: unknown;
}

export interface DepositoInfo {
  id: string;
  numero: string;
  nome: string;
}

/** Sessão local do dispositivo — única por device (docs 3.2). */
export interface SessionRecord {
  userId: string;
  matricula: string;
  nomeCompleto: string;
  perfil: string;
  depositos: DepositoInfo[];
  depositoAtivo: string;
  saltLocal: string;
  hashLocal: string;
  accessToken?: string;
  refreshToken?: string;
  loginEm: string;
  expiresAt: string;
  lastActivityAt: string;
}

class LogEnxovalDb extends Dexie {
  kv!: Table<KvRecord, string>;
  session!: Table<SessionRecord, string>;

  constructor() {
    super('logenxoval');
    this.version(1).stores({
      kv: 'key',
      session: 'userId',
    });
  }
}

export const db = new LogEnxovalDb();

export const kvGet = async <T>(key: string): Promise<T | undefined> =>
  (await db.kv.get(key))?.value as T | undefined;

export const kvSet = async (key: string, value: unknown): Promise<void> => {
  await db.kv.put({ key, value });
};

export const kvDel = async (key: string): Promise<void> => {
  await db.kv.delete(key);
};

export const SESSION_KEY = 'session:ativa';
export const DEVICE_KEY = 'deviceId';

export async function getStoredSession(): Promise<SessionRecord | undefined> {
  return db.session.get(SESSION_KEY);
}