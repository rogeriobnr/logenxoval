import { getPool } from '../db/pool';
import bcrypt from 'bcryptjs';

export const PIN_CHAVE = 'ADMIN_PIN_HASH';

export async function getPinHash(): Promise<string | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT valor FROM settings WHERE chave = $1 AND deposito_id IS NULL LIMIT 1',
    [PIN_CHAVE],
  );
  const raw = rows[0]?.valor;
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'string') {
    try {
      const obj = JSON.parse(raw) as { hash?: unknown };
      return typeof obj.hash === 'string' ? obj.hash : raw;
    } catch {
      return raw;
    }
  }
  const h = (raw as { hash?: unknown }).hash;
  return typeof h === 'string' ? h : null;
}

/**
 * Define o PIN global (deposito_id NULL). Upsert manual em transação:
 * `ON CONFLICT (chave, deposito_id)` não conflita quando deposito_id é NULL
 * (NULLs são distintos no Postgres), então UPDATE + INSERT condicional.
 */
export async function setPin(pin: string): Promise<void> {
  const pool = getPool();
  const hash = await bcrypt.hash(pin, 12);
  const valor = JSON.stringify({ hash });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE settings SET valor = $2 WHERE chave = $1 AND deposito_id IS NULL', [
      PIN_CHAVE,
      valor,
    ]);
    await client.query(
      'INSERT INTO settings (chave, valor, deposito_id) SELECT $1, $2, NULL WHERE NOT EXISTS (SELECT 1 FROM settings WHERE chave = $1 AND deposito_id IS NULL)',
      [PIN_CHAVE, valor],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}