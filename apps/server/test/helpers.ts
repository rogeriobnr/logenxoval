import { getPool, setAppContext } from '../src/db/pool';
import { migrate } from '../src/db/migrate';

let migrado = false;

export async function ensureMigrated(): Promise<void> {
  if (!migrado) {
    await migrate();
    migrado = true;
  }
}

const TABELAS = [
  'processed_operations',
  'audit_logs',
  'snapshots',
  'documents',
  'conversion_suggestions',
  'divergences',
  'inspection_items',
  'inspections',
  'requests',
  'ppe_movements',
  'ppe_items',
  'consumable_movements',
  'consumables',
  'spare_part_movements',
  'spare_parts',
  'goldbox_movements',
  'inventory_items',
  'deposit_versions',
  'user_deposits',
  'deposits',
  'sessions',
  'users',
  'settings',
];

export async function resetDb(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE audit_logs DISABLE TRIGGER ALL');
    await client.query('ALTER TABLE processed_operations DISABLE TRIGGER ALL');
    for (const t of TABELAS) {
      await client.query(`DELETE FROM ${t}`);
    }
    await client.query('ALTER TABLE audit_logs ENABLE TRIGGER ALL');
    await client.query('ALTER TABLE processed_operations ENABLE TRIGGER ALL');
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Abre transação com contexto RLS de depósito — repositórios passam pelo caller. */
export async function withContext<T>(
  depositoId: string,
  perfil: string,
  fn: (client: { query: (sql: string, params?: unknown[]) => Promise<unknown> }) => Promise<T>,
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setAppContext(
      { query: (sql, p) => client.query(sql, p) },
      { depositoId, perfil },
    );
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