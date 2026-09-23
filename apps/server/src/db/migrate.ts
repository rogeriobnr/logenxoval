import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getPool, closePool } from './pool';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, '..', '..', 'sql', 'migrations');
const MIGRATION_LOCK = 7421137;

export async function migrate(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        aplicado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const already = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (already.rowCount) continue;

      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`migrado: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Falha na migração ${file}: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]);
    client.release();
  }
}

if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
  migrate()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}