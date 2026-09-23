import { getPool } from '../db/pool';
import type { SessionRow } from '@logenxoval/contracts';
import { newId, sha256Hex } from '../lib/crypto';
import { mapSessionRow } from './usersRepo';

export function hashToken(token: string): string {
  return sha256Hex(token);
}

export async function upsertSession(params: {
  userId: string;
  deviceId: string;
  refreshTokenHash: string;
  expiresAtIso: string;
}): Promise<void> {
  const pool = getPool();
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO sessions (id, user_id, device_id, token_hash, criado_em, expires_at, last_activity_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (device_id) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           token_hash = EXCLUDED.token_hash,
           expires_at = EXCLUDED.expires_at,
           last_activity_at = now()`,
    [newId(), params.userId, params.deviceId, params.refreshTokenHash, now, params.expiresAtIso, now],
  );
}

export async function findByDeviceId(
  deviceId: string,
): Promise<SessionRow | null> {
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM sessions WHERE device_id = $1', [deviceId]);
  return rows[0] ? mapSessionRow(rows[0]) : null;
}

export async function revokeByDeviceId(deviceId: string): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM sessions WHERE device_id = $1', [deviceId]);
}

export async function touchActivity(deviceId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    "UPDATE sessions SET last_activity_at = now() WHERE device_id = $1",
    [deviceId],
  );
}