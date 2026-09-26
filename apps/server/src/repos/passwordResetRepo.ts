import { getPool } from '../db/pool';
import { newId } from '../lib/crypto';

export async function criarReset(opts: {
  userId: string;
  tokenHash: string;
  expiraEmIso: string;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO password_resets (id, user_id, token_hash, expira_em)
     VALUES ($1,$2,$3,$4)`,
    [newId(), opts.userId, opts.tokenHash, opts.expiraEmIso],
  );
}

export async function encontrarResetValido(tokenHash: string): Promise<{
  id: string;
  userId: string;
} | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, user_id FROM password_resets
     WHERE token_hash = $1 AND usado_em IS NULL AND expira_em > now()`,
    [tokenHash],
  );
  return rows[0] ? { id: rows[0].id as string, userId: rows[0].user_id as string } : null;
}

export async function marcarUsado(id: string): Promise<void> {
  const pool = getPool();
  await pool.query('UPDATE password_resets SET usado_em = now() WHERE id = $1', [id]);
}

export async function limparResetsVencidosDe(userId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    'DELETE FROM password_resets WHERE user_id = $1 AND (usado_em IS NOT NULL OR expira_em <= now())',
    [userId],
  );
}