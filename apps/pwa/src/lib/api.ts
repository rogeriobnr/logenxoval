/**
 * Cliente HTTP da API — access token curto + refresh rotativo (single-flight).
 * Erros normalizados em ApiError (código + mensagem do servidor).
 */

export interface ApiTokens {
  access: string;
  refresh: string;
}

export interface ApiClientOpts {
  getDeviceId: () => string;
  getTokens: () => ApiTokens | undefined;
  setTokens: (tokens: ApiTokens) => void;
  clearSession: () => void;
  baseUrl?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number | undefined,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isNetworkError(err: unknown): boolean {
  return err instanceof ApiError && err.status === undefined;
}

const BASE_URL: string = (import.meta.env.VITE_API_URL ?? '') as string;

export class ApiClient {
  private refreshing: Promise<string> | null = null;

  constructor(private readonly opts: ApiClientOpts) {}

  private async raw(
    method: string,
    path: string,
    body?: unknown,
    accessToken?: string,
  ): Promise<{ status: number; body: unknown }> {
    const headers: Record<string, string> = { 'X-Device-Id': this.opts.getDeviceId() };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

    let response: Response;
    try {
      response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(undefined, 'NETWORK', 'Sem conexão com o servidor');
    }

    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    return { status: response.status, body: parsed };
  }

  /** Obtém (e rotaciona) o access token — um único refresh em voo por vez. */
  private refreshAccess(): Promise<string> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async doRefresh(): Promise<string> {
    const tokens = this.opts.getTokens();
    if (!tokens) throw new ApiError(401, 'UNAUTHORIZED', 'Sessão não iniciada');
    const res = await this.raw('POST', '/auth/refresh', {
      refreshToken: tokens.refresh,
      deviceId: this.opts.getDeviceId(),
    });
    if (res.status === 401) {
      this.opts.clearSession();
      throw new ApiError(401, 'UNAUTHORIZED', 'Sessão expirada ou revogada');
    }
    if (res.status !== 200) {
      throw new ApiError(res.status, this.codeOf(res.body), this.messageOf(res.body));
    }
    const data = res.body as { accessToken: string; refreshToken: string };
    this.opts.setTokens({ access: data.accessToken, refresh: data.refreshToken });
    return data.accessToken;
  }

  private codeOf(body: unknown): string {
    const b = body as { error?: { code?: string; message?: string } };
    return b?.error?.code ?? 'INTERNAL';
  }

  private messageOf(body: unknown): string {
    const b = body as { error?: { code?: string; message?: string } };
    return b?.error?.message ?? 'Erro inesperado';
  }

  async request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const tokens = this.opts.getTokens();
    let res = await this.raw(method, path, body, tokens?.access);

    if (res.status === 401 && tokens) {
      let access: string;
      try {
        access = await this.refreshAccess();
      } catch (err) {
        throw err;
      }
      res = await this.raw(method, path, body, access);
    }

    if (res.status >= 200 && res.status < 300) return (res.body ?? {}) as T;
    throw new ApiError(res.status, this.codeOf(res.body), this.messageOf(res.body), undefined);
  }
}