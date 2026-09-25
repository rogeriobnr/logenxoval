/**
 * Ponto de entrada da API para plataformas serverless (Vercel).
 * Constrói (e reutiliza entre invocações) uma única instância Fastify.
 */

import { buildApp, type AppOptions } from './app';
import { loadEnv } from './env';

type Fastify = Awaited<ReturnType<typeof buildApp>>;

let appPromise: Promise<Fastify> | null = null;

export function getApp(): Promise<Fastify> {
  if (!appPromise) {
    const env = loadEnv();
    const opts: AppOptions = { jwtSecret: env.JWT_SECRET, logger: env.NODE_ENV !== 'production' };
    if (process.env.CORS_ORIGINS) {
      opts.corsOrigins = process.env.CORS_ORIGINS.split(',').map((s) => s.trim());
    }
    appPromise = buildApp(opts).then((app) => app.ready().then(() => app));
  }
  return appPromise;
}