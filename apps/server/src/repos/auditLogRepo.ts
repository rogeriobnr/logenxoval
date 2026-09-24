import { getPool } from '../db/pool';
import type { AuditLogRow, LogTipo } from '@logenxoval/contracts';
import { newId, sha256Hex } from '../lib/crypto';

export interface AuditInput {
  tipo: LogTipo;
  usuarioId: string;
  matricula: string;
  depositoId?: string;
  entidade: string;
  operacaoId?: string;
  estadoAnterior?: unknown;
  estadoPosterior?: unknown;
  motivo?: string;
  origem: 'ONLINE' | 'OFFLINE';
  dispositivo: string;
}

export interface Queryable {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}

/** Insere log na conexão/transação informada (permite atomicidade com a operação). */
export async function insertAuditLogWith(q: Queryable, input: AuditInput): Promise<AuditLogRow> {
  const canonical = JSON.stringify({
    tipo: input.tipo,
    usuarioId: input.usuarioId,
    matricula: input.matricula,
    depositoId: input.depositoId,
    entidade: input.entidade,
    operacaoId: input.operacaoId,
    estadoAnterior: input.estadoAnterior,
    estadoPosterior: input.estadoPosterior,
    motivo: input.motivo,
    origem: input.origem,
    dispositivo: input.dispositivo,
  });
  const hash = sha256Hex(canonical);
  const res = await q.query(
    `INSERT INTO audit_logs
      (id, tipo, data_hora, usuario_id, matricula, deposito_id, entidade, operacao_id,
       estado_anterior, estado_posterior, motivo, origem, dispositivo, hash)
     VALUES ($1,$2,now(),$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13)
     RETURNING *`,
    [
      newId(),
      input.tipo,
      input.usuarioId,
      input.matricula,
      input.depositoId ?? null,
      input.entidade,
      input.operacaoId ?? null,
      input.estadoAnterior === undefined ? null : JSON.stringify(input.estadoAnterior),
      input.estadoPosterior === undefined ? null : JSON.stringify(input.estadoPosterior),
      input.motivo ?? null,
      input.origem,
      input.dispositivo,
      hash,
    ],
  );
  return mapAuditLog((res as { rows?: Array<Record<string, unknown>> }).rows?.[0]);
}

export async function insertAuditLog(input: AuditInput): Promise<AuditLogRow> {
  return insertAuditLogWith(getPool(), input);
}

function mapAuditLog(row?: Record<string, unknown>): AuditLogRow {
  if (!row) throw new Error('audit_logs: registro não retornado pelo banco');
  return {
    id: row.id as string,
    tipo: row.tipo as AuditLogRow['tipo'],
    dataHora: row.data_hora as string,
    usuarioId: row.usuario_id as string,
    matricula: row.matricula as string,
    depositoId: (row.deposito_id as string | null) ?? undefined,
    entidade: row.entidade as string,
    operacaoId: (row.operacao_id as string | null) ?? undefined,
    estadoAnterior: (row.estado_anterior as unknown) ?? undefined,
    estadoPosterior: (row.estado_posterior as unknown) ?? undefined,
    motivo: (row.motivo as string | null) ?? undefined,
    origem: row.origem as AuditLogRow['origem'],
    dispositivo: row.dispositivo as string,
    hash: row.hash as string,
  };
}

export async function listAuditLogs(params: {
  depositoId?: string;
  tipos?: string[];
  matricula?: string;
  dataIni?: string;
  dataFim?: string;
  limit?: number;
}): Promise<AuditLogRow[]> {
  const pool = getPool();
  const where: string[] = [];
  const values: unknown[] = [];
  if (params.depositoId) {
    values.push(params.depositoId);
    where.push(`deposito_id = $${values.length}`);
  }
  if (params.tipos && params.tipos.length > 0) {
    const lista = params.tipos.filter((t) => t);
    if (lista.length === 1) {
      values.push(lista[0]);
      where.push(`tipo = $${values.length}`);
    } else {
      values.push(lista);
      where.push(`tipo = ANY($${values.length})`);
    }
  }
  if (params.matricula) {
    values.push(params.matricula);
    where.push(`matricula = $${values.length}`);
  }
  if (params.dataIni) {
    values.push(params.dataIni);
    where.push(`data_hora >= $${values.length}`);
  }
  if (params.dataFim) {
    values.push(params.dataFim);
    where.push(`data_hora <= $${values.length}`);
  }
  values.push(params.limit ?? 500);
  const sql = `SELECT * FROM audit_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY data_hora DESC LIMIT $${values.length}`;
  const { rows } = await pool.query(sql, values);
  return rows.map((r) => mapAuditLog(r as Record<string, unknown>));
}