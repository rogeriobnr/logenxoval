import { getPool } from '../db/pool';
import type { DepositoRow } from '@logenxoval/contracts';
import { AppError } from '../lib/errors';
import { newId } from '../lib/crypto';

export interface DepositCreate {
  numero: string;
  nome: string;
  criadoPor: string;
}

export function mapDeposito(row: Record<string, unknown>): DepositoRow {
  return {
    id: row.id as string,
    numero: row.numero as string,
    nome: row.nome as string,
    status: row.status as DepositoRow['status'],
    criadoPor: row.criado_por as string,
    criadoEm: (row.criado_em as Date).toISOString(),
    alteradoPor: row.alterado_por as string | undefined,
    alteradoEm: row.alterado_em ? (row.alterado_em as Date).toISOString() : undefined,
    versaoAtualEnxoval: row.versao_atual_enxoval as string | undefined,
  };
}

export async function createDeposit(params: DepositCreate): Promise<DepositoRow> {
  const pool = getPool();
  const id = newId();
  const now = new Date().toISOString();
  try {
    const { rows } = await pool.query(
      `INSERT INTO deposits (id, numero, nome, status, criado_por, criado_em)
       VALUES ($1,$2,$3,'ATIVO',$4,$5)
       RETURNING *`,
      [id, params.numero, params.nome, params.criadoPor, now],
    );
    return mapDeposito(rows[0]);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('duplicate key') && (msg.includes('numero') || msg.includes('deposits'))) {
      throw new AppError('CONFLITO', 'Número de depósito já existe', 409);
    }
    throw err;
  }
}

export async function findDepositById(id: string): Promise<DepositoRow | null> {
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM deposits WHERE id = $1', [id]);
  return rows[0] ? mapDeposito(rows[0]) : null;
}

export async function findDepositByNumero(numero: string): Promise<DepositoRow | null> {
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM deposits WHERE numero = $1', [numero]);
  return rows[0] ? mapDeposito(rows[0]) : null;
}

export async function listDepositsByUser(userId: string, perfil: string): Promise<DepositoRow[]> {
  const pool = getPool();
  if (perfil === 'ADMIN') {
    const { rows } = await pool.query('SELECT * FROM deposits WHERE status = $1 ORDER BY numero', [
      'ATIVO',
    ]);
    return rows.map(mapDeposito);
  }
  const { rows } = await pool.query(
    `SELECT d.* FROM deposits d
     JOIN user_deposits ud ON ud.deposito_id = d.id
     WHERE ud.user_id = $1 AND d.status = 'ATIVO' ORDER BY d.numero`,
    [userId],
  );
  return rows.map(mapDeposito);
}

export async function userHasDepositAccess(
  userId: string,
  depositoId: string,
  perfil: string,
): Promise<boolean> {
  if (perfil === 'ADMIN') {
    const d = await findDepositById(depositoId);
    return d !== null;
  }
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT 1 FROM user_deposits WHERE user_id = $1 AND deposito_id = $2',
    [userId, depositoId],
  );
  return rows.length > 0;
}

export async function grantDepositAccess(params: {
  userId: string;
  depositoId: string;
  concedidoPor: string;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    'INSERT INTO user_deposits (user_id, deposito_id, concedido_por) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
    [params.userId, params.depositoId, params.concedidoPor],
  );
}

export async function revokeDepositAccess(params: {
  userId: string;
  depositoId: string;
  revogadoPor: string;
}): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM user_deposits WHERE user_id = $1 AND deposito_id = $2', [
    params.userId,
    params.depositoId,
  ]);
}

export async function listDepositsGrantedToUser(userId: string): Promise<string[]> {
  const pool = getPool();
  const { rows } = await pool.query('SELECT deposito_id FROM user_deposits WHERE user_id = $1', [userId]);
  return rows.map((r) => r.deposito_id as string);
}

export async function listUserDepositGrants(): Promise<Array<{ userId: string; depositoIds: string[] }>> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT user_id, array_agg(deposito_id ORDER BY deposito_id) AS deposito_ids
     FROM user_deposits GROUP BY user_id`,
  );
  return rows.map((r) => ({
    userId: r.user_id as string,
    depositoIds: (r.deposito_ids as string[]) ?? [],
  }));
}

export async function updateDepositMeta(params: {
  id: string;
  nome: string;
  alteradoPor: string;
}): Promise<DepositoRow> {
  const pool = getPool();
  const now = new Date().toISOString();
  const { rows } = await pool.query(
    'UPDATE deposits SET nome = $2, alterado_por = $3, alterado_em = $4 WHERE id = $1 RETURNING *',
    [params.id, params.nome, params.alteradoPor, now],
  );
  if (!rows[0]) throw new AppError('NAO_ENCONTRADO', 'Depósito não encontrado', 404);
  return mapDeposito(rows[0]);
}

export async function setDepositStatus(params: {
  id: string;
  status: 'ATIVO' | 'INATIVO';
  alteradoPor: string;
}): Promise<DepositoRow> {
  const pool = getPool();
  const now = new Date().toISOString();
  const { rows } = await pool.query(
    'UPDATE deposits SET status = $2, alterado_por = $3, alterado_em = $4 WHERE id = $1 RETURNING *',
    [params.id, params.status, params.alteradoPor, now],
  );
  if (!rows[0]) throw new AppError('NAO_ENCONTRADO', 'Depósito não encontrado', 404);
  return mapDeposito(rows[0]);
}