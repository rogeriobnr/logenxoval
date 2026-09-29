import { getPool } from '../db/pool';
import { newId } from '../lib/crypto';

/** Fase 22: tokens de recuperação de PIN — hasheados, de uso único, com expiração. */
export async function criarResetPin(opts: {
  userId: string;
  tokenHash: string;
  expiraEmIso: string;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO pin_resets (id, user_id, token_hash, expira_em)
     VALUES ($1,$2,$3,$4)`,
    [newId(), opts.userId, opts.tokenHash, opts.expiraEmIso],
  );
}

export async function encontrarResetPinValido(tokenHash: string): Promise<{
  id: string;
  userId: string;
} | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, user_id FROM pin_resets
     WHERE token_hash = $1 AND usado_em IS NULL AND expira_em > now()`,
    [tokenHash],
  );
  return rows[0] ? { id: rows[0].id as string, userId: rows[0].user_id as string } : null;
}

export async function marcarResetPinUsado(id: string): Promise<void> {
  const pool = getPool();
  await pool.query('UPDATE pin_resets SET usado_em = now() WHERE id = $1', [id]);
}

export async function limparResetsPinDe(userId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    'DELETE FROM pin_resets WHERE user_id = $1 AND (usado_em IS NOT NULL OR expira_em <= now())',
    [userId],
  );
}
