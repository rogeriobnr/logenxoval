function besoin(x: string, nome: string): string {
  if (!x) throw new Error(`Variável de ambiente ausente: ${nome}`);
  return x;
}

export interface Env {
  NODE_ENV: string;
  PORT: number;
  DATABASE_URL: string;
  JWT_SECRET: string;
  GEMINI_API_KEY?: string;
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return {
    NODE_ENV: source.NODE_ENV ?? 'development',
    PORT: Number(source.PORT ?? 3000),
    DATABASE_URL: besoin(source.DATABASE_URL!, 'DATABASE_URL'),
    JWT_SECRET: besoin(source.JWT_SECRET!, 'JWT_SECRET'),
    GEMINI_API_KEY: source.GEMINI_API_KEY,
  };
}