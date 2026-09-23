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

/**
 * Executa fn dentro de uma transação com o contexto RLS do depósito
 * (app.deposito_id). Tabelas protegidas (inventory_items, deposit_versions,
 * goldbox_movements, …) só são visíveis/graváveis com este contexto.
 */
export async function withDepositoContext<T>(
  depositoId: string,
  perfil: string,
  fn: (client: { query: (sql: string, params?: unknown[]) => Promise<unknown> }) => Promise<T>,
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setAppContext(client, { depositoId, perfil });
    const out = await fn({ query: (sql, p) => client.query(sql, p) });
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}