import { getPool } from '../db/pool';
import bcrypt from 'bcryptjs';

export const PIN_CHAVE = 'ADMIN_PIN_HASH';

export async function getPinHash(): Promise<string | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT valor FROM settings WHERE chave = $1 AND deposito_id IS NULL',
    [PIN_CHAVE],
  );
  const raw = rows[0]?.valor;
  return typeof raw === 'string' ? raw : (raw?.hash ?? null);
}

export async function setPin(pin: string): Promise<void> {
  const pool = getPool();
  const hash = await bcrypt.hash(pin, 12);
  await pool.query(
    'INSERT INTO settings (chave, valor, deposito_id) VALUES ($1,$2,NULL) ON CONFLICT (chave, deposito_id) DO UPDATE SET valor = EXCLUDED.valor',
    [PIN_CHAVE, JSON.stringify({ hash })],
  );
}