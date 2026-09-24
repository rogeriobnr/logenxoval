import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import jwt from '@fastify/jwt';
import cors from '@fastify/cors';
import { errorResponse } from './lib/errors';
import { getPool } from './db/pool';
import { registerAuthRoutes } from './routes/auth';
import { registerUserRoutes } from './routes/users';
import { registerDepositRoutes } from './routes/deposits';
import { registerEnxovalRoutes } from './routes/enxoval';
import { registerGoldboxRoutes } from './routes/goldbox';
import { registerSyncRoutes } from './routes/sync';
import { registerInspectionRoutes } from './routes/inspections';
import { registerSpareRoutes } from './routes/spare';

export interface AppOptions {
  jwtSecret: string;
  logger?: boolean;
  corsOrigins?: string[];
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  await app.register(jwt, { secret: opts.jwtSecret });
  await app.register(cors, { origin: opts.corsOrigins ?? true });

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof Error && 'validation' in err && (err as { validation?: unknown }).validation) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_FAILED',
          message: err.message,
          details: (err as { validation?: unknown }).validation,
        },
      });
    }
    const { statusCode, body } = errorResponse(err as FastifyError);
    return reply.status(statusCode).send(body);
  });

  app.get('/health', async () => {
    const pool = getPool();
    const { rows } = await pool.query('SELECT 1 AS ok');
    return { status: 'ok', db: rows[0]?.ok === 1 };
  });

  await registerAuthRoutes(app);
  await registerUserRoutes(app);
  await registerDepositRoutes(app);
  await registerEnxovalRoutes(app);
  await registerGoldboxRoutes(app);
  await registerSyncRoutes(app);
  await registerInspectionRoutes(app);
  await registerSpareRoutes(app);

  return app;
}