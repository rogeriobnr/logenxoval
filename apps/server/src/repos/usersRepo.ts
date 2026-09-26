import { getPool } from '../db/pool';
import { AppError } from '../lib/errors';
import type { Perfil, SessionRow, UserRow, UserStatus } from '@logenxoval/contracts';
import { newId } from '../lib/crypto';

export async function createUser(params: {
  matricula: string;
  nome: string;
  sobrenome: string;
  perfil: Perfil;
  senhaHash: string;
  status?: UserStatus;
}): Promise<UserRow> {
  const pool = getPool();
  const id = newId();
  const now = new Date().toISOString();
  const status = params.status ?? 'ATIVO';
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (id, matricula, nome, sobrenome, perfil, senha_hash, status, criado_em, atualizado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [id, params.matricula, params.nome, params.sobrenome, params.perfil, params.senhaHash, status, now, now],
    );
    return mapUser(rows[0]);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('duplicate key') && msg.includes('matricula')) {
      throw new AppError('CONFLITO', 'Matrícula já cadastrada', 409);
    }
    throw err;
  }
}

export async function findByMatricula(matricula: string): Promise<(UserRow & { senhaHash: string }) | null> {
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM users WHERE matricula = $1', [matricula]);
  return rows[0] ? { ...mapUser(rows[0]), senhaHash: rows[0].senha_hash } : null;
}

export async function findById(id: string): Promise<UserRow | null> {
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function listUsers(): Promise<UserRow[]> {
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM users ORDER BY matricula');
  return rows.map(mapUser);
}

export async function updateUserStatus(
  id: string,
  status: UserStatus,
  perfil?: Perfil,
): Promise<void> {
  const pool = getPool();
  const now = new Date().toISOString();
  await pool.query(
    'UPDATE users SET status = $2, perfil = COALESCE($3, perfil), atualizado_em = $4 WHERE id = $1',
    [id, status, perfil ?? null, now],
  );
}

function mapUser(row: Record<string, unknown>): UserRow {
  return {
    id: row.id as string,
    matricula: row.matricula as string,
    nome: row.nome as string,
    sobrenome: row.sobrenome as string,
    perfil: row.perfil as Perfil,
    status: row.status as UserStatus,
    criadoEm: (row.criado_em as Date).toISOString(),
    atualizadoEm: (row.atualizado_em as Date).toISOString(),
  };
}

export async function revokeSessionsByUser(userId: string): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

export { mapUser };

// Auxiliar para tipar SessionRow vinda do banco
export function mapSessionRow(row: Record<string, unknown>): SessionRow {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    deviceId: row.device_id as string,
    tokenHash: row.token_hash as string,
    criadoEm: (row.criado_em as Date).toISOString(),
    expiresAt: (row.expires_at as Date).toISOString(),
    lastActivityAt: (row.last_activity_at as Date).toISOString(),
  };
}