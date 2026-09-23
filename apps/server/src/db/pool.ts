import { Pool, type PoolConfig } from 'pg';
import { loadEnv } from '../env';

let pool: Pool | null = null;

export function getPool(config?: PoolConfig): Pool {
  if (!pool) {
    const env = loadEnv();
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
      ...config,
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** Define o contexto de isolamento (RLS) para deposito autorizado/global. */
export async function setAppContext(
  client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  ctx: { depositoId: string; perfil: string },
): Promise<void> {
  const deposito = ctx.perfil === 'ADMIN' && ctx.depositoId === '*' ? '__ALL__' : ctx.depositoId;
  await client.query('SELECT set_config($1, $2, true)', ['app.deposito_id', deposito]);
}