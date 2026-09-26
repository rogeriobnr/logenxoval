import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiClient, ApiError, isNetworkError, type ApiTokens } from '../lib/api';
import { generateDeviceId } from '../lib/device';
import { deriveLocalVerifier } from '../lib/crypto';
import {
  autenticarOffline,
  atualizarHashCredencialOffline,
  gravarCredencialOffline,
} from '../lib/offlineAuth';
import {
  DEVICE_KEY,
  db,
  kvGet,
  kvSet,
  getStoredSession,
  type DepositoInfo,
  type SessionRecord,
} from '../db/db';

/** Tempo sem interação até o bloqueio automático (docs 3.5). */
export const INACTIVITY_MS = 15 * 60 * 1000;
/** Validade da sessão local (espelho do refresh token do servidor). */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type AuthStatus = 'loading' | 'anon' | 'auth';

export interface AuthSession {
  userId: string;
  matricula: string;
  nomeCompleto: string;
  perfil: string;
  depositos: DepositoInfo[];
  depositoAtivo?: DepositoInfo;
}

export type LoginResult = { ok: true } | { ok: false; code: string; message: string };

interface AuthContextValue {
  status: AuthStatus;
  online: boolean;
  session: AuthSession | null;
  deviceId: string;
  api: ApiClient;
  login: (matricula: string, senha: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  changeDeposito: (id: string) => Promise<void>;
  changePassword: (senhaAtual: string, novaSenha: string) => Promise<LoginResult>;
  touchActivity: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function mapSession(rec: SessionRecord): AuthSession {
  return {
    userId: rec.userId,
    matricula: rec.matricula,
    nomeCompleto: rec.nomeCompleto,
    perfil: rec.perfil,
    depositos: rec.depositos,
    depositoAtivo: rec.depositos.find((d) => d.id === rec.depositoAtivo) ?? rec.depositos[0],
  };
}

function isExpired(rec: SessionRecord): boolean {
  return Date.now() > new Date(rec.expiresAt).getTime();
}

function nowIso(): string {
  return new Date().toISOString();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [online, setOnline] = useState<boolean>(() => navigator.onLine);

  const deviceIdRef = useRef<string>(generateDeviceId());
  const [deviceId, setDeviceId] = useState<string>(() => deviceIdRef.current);
  const tokensRef = useRef<ApiTokens | undefined>(undefined);
  const [api, setApi] = useState<ApiClient | null>(null);

  const persistTokens = async (tokens: ApiTokens) => {
    tokensRef.current = tokens;
    const stored = await getStoredSession();
    if (stored) {
      stored.accessToken = tokens.access;
      stored.refreshToken = tokens.refresh;
      await db.session.put(stored);
    }
  };

  const clearSession = async () => {
    tokensRef.current = undefined;
    await db.session.clear();
    setSession(null);
    setStatus('anon');
  };

  // Cria o ApiClient uma única vez (closures estáveis sobre refs).
  useEffect(() => {
    const client = new ApiClient({
      getDeviceId: () => deviceIdRef.current,
      getTokens: () => tokensRef.current,
      setTokens: (t) => {
        void persistTokens(t);
      },
      clearSession: () => {
        void clearSession();
      },
    });
    setApi(client);
  }, []);

  // Milho: rede
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // Inicialização: deviceId + sessão local persistida.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const storedDevice = await kvGet<string>(DEVICE_KEY);
        if (storedDevice) {
          deviceIdRef.current = storedDevice;
          setDeviceId(storedDevice);
        } else {
          await kvSet(DEVICE_KEY, deviceIdRef.current);
        }

        const stored = await getStoredSession();
        if (stored && !isExpired(stored) && stored.saltLocal && stored.hashLocal) {
          tokensRef.current = { access: stored.accessToken ?? '', refresh: stored.refreshToken ?? '' };
          if (!cancelled) {
            setSession(mapSession(stored));
            setStatus('auth');
          }
          await gravarCredencialOffline({
            userId: stored.userId,
            matricula: stored.matricula,
            nomeCompleto: stored.nomeCompleto,
            perfil: stored.perfil,
            depositos: stored.depositos,
            saltLocal: stored.saltLocal,
            hashLocal: stored.hashLocal,
            accessToken: stored.accessToken,
            refreshToken: stored.refreshToken,
          });
        } else if (stored) {
          await db.session.clear();
          if (!cancelled) setStatus('anon');
        } else if (!cancelled) {
          setStatus('anon');
        }
      } catch {
        if (!cancelled) setStatus('anon');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const offlineLogin = async (matricula: string, senha: string): Promise<LoginResult> => {
    const res = await autenticarOffline(matricula, senha);
    if (!res.ok) {
      return { ok: false, code: res.code, message: res.message };
    }
    tokensRef.current = {
      access: res.session.accessToken ?? '',
      refresh: res.session.refreshToken ?? '',
    };
    setSession(mapSession(res.session));
    setStatus('auth');
    return { ok: true };
  };

  const login = async (matricula: string, senha: string): Promise<LoginResult> => {
    const payload = { matricula: matricula.trim(), senha, deviceId: deviceIdRef.current };
    if (online) {
      try {
        const res = await api!.request<{
          accessToken: string;
          refreshToken: string;
          saltLocal: string;
          usuario: { id: string; matricula: string; nome: string; sobrenome: string; perfil: string };
          depositos: Array<{ id: string; numero: string; nome: string }>;
        }>('POST', '/auth/login', payload);
        const saltLocal = res.saltLocal;
        const hashLocal = await deriveLocalVerifier(senha, saltLocal);
        const rec: SessionRecord = {
          userId: res.usuario.id,
          matricula: res.usuario.matricula,
          nomeCompleto: `${res.usuario.nome} ${res.usuario.sobrenome}`.trim(),
          perfil: res.usuario.perfil,
          depositos: res.depositos,
          depositoAtivo: res.depositos[0]?.id ?? '',
          saltLocal,
          hashLocal,
          accessToken: res.accessToken,
          refreshToken: res.refreshToken,
          loginEm: nowIso(),
          expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
          lastActivityAt: nowIso(),
        };
        await db.session.put(rec);
        await gravarCredencialOffline({
          userId: rec.userId,
          matricula: rec.matricula,
          nomeCompleto: rec.nomeCompleto,
          perfil: rec.perfil,
          depositos: rec.depositos,
          saltLocal: rec.saltLocal,
          hashLocal: rec.hashLocal,
          accessToken: rec.accessToken,
          refreshToken: rec.refreshToken,
        });
        tokensRef.current = { access: res.accessToken, refresh: res.refreshToken };
        setSession(mapSession(rec));
        setStatus('auth');
        return { ok: true };
      } catch (err) {
        if (isNetworkError(err)) {
          return offlineLogin(matricula, senha);
        }
        return {
          ok: false,
          code: err instanceof ApiError ? err.code : 'INTERNAL',
          message: err instanceof ApiError ? err.message : 'Erro inesperado',
        };
      }
    }
    return offlineLogin(matricula, senha);
  };

  const logout = async (): Promise<void> => {
    if (api && tokensRef.current?.access && online) {
      try {
        await api.request<unknown>('POST', '/auth/logout');
      } catch {
        // local mesmo se o servidor estiver fora
      }
    }
    await clearSession();
  };

  const changeDeposito = async (id: string): Promise<void> => {
    const stored = await getStoredSession();
    if (!stored || !stored.depositos.some((d) => d.id === id)) return;
    stored.depositoAtivo = id;
    await db.session.put(stored);
    setSession(mapSession(stored));
  };

  const changePassword = async (senhaAtual: string, novaSenha: string): Promise<LoginResult> => {
    try {
      await api!.request<{ ok: boolean }>('POST', '/auth/change-password', { senhaAtual, novaSenha });
      const stored = await getStoredSession();
      if (stored) {
        stored.hashLocal = await deriveLocalVerifier(novaSenha, stored.saltLocal);
        await db.session.put(stored);
        await atualizarHashCredencialOffline(stored.matricula, stored.hashLocal);
      }
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        code: err instanceof ApiError ? err.code : 'INTERNAL',
        message: err instanceof ApiError ? err.message : 'Erro inesperado',
      };
    }
  };

  // Bloqueio por inatividade (docs 3.5)
  useEffect(() => {
    const timer = setInterval(async () => {
      if (status !== 'auth') return;
      const stored = await getStoredSession();
      if (stored && Date.now() - new Date(stored.lastActivityAt).getTime() > INACTIVITY_MS) {
        await clearSession();
      }
    }, 30_000);
    return () => clearInterval(timer);
  }, [status]);

  const touchActivity = () => {
    void (async () => {
      const stored = await getStoredSession();
      if (stored) {
        stored.lastActivityAt = nowIso();
        await db.session.put(stored);
      }
    })();
  };

  if (!api) return null;

  return (
    <AuthContext.Provider
      value={{
        status,
        online,
        session,
        deviceId,
        api,
        login,
        logout,
        changeDeposito,
        changePassword,
        touchActivity,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}