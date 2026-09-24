import type { DocumentRow, DocumentoTipo } from '@logenxoval/contracts';
import { withDepositoContext } from '../db/pool';
import { newId } from '../lib/crypto';

function mapDocumento(row: Record<string, unknown>): DocumentRow {
  return {
    id: row.id as string,
    depositoId: row.deposito_id as string,
    tipo: row.tipo as DocumentoTipo,
    nome: row.nome as string,
    mime: row.mime as string,
    tamanho: Number(row.tamanho),
    hashDocumento: row.hash_documento as string,
    bytes: (row.bytes as Buffer | null) ?? undefined,
    criadoEm: row.criado_em as string,
    usuarioId: row.usuario_id as string,
    matricula: row.matricula as string,
  };
}

export interface InsertDocumentoParams {
  depositoId: string;
  tipo: DocumentoTipo;
  nome: string;
  mime: string;
  tamanho: number;
  hashDocumento: string;
  bytes?: Buffer;
  usuarioId: string;
  matricula: string;
}

export async function insertDocumento(
  params: InsertDocumentoParams,
  perfil: string,
): Promise<DocumentRow> {
  return withDepositoContext(params.depositoId, perfil, async (client) => {
    const id = newId();
    const res = await client.query(
      `INSERT INTO documents
        (id, deposito_id, tipo, nome, mime, tamanho, hash_documento, bytes, usuario_id, matricula)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        id,
        params.depositoId,
        params.tipo,
        params.nome,
        params.mime,
        params.tamanho,
        params.hashDocumento,
        params.bytes ?? null,
        params.usuarioId,
        params.matricula,
      ],
    );
    return mapDocumento((res as { rows: Array<Record<string, unknown>> }).rows[0]);
  });
}

/**
 * Busca um documento dentro do contexto RLS do depósito (leitura confiável).
 */
export async function findDocumentoPorDeposito(
  depositoId: string,
  perfil: string,
  id: string,
): Promise<DocumentRow | null> {
  return withDepositoContext(depositoId, perfil, async (client) => {
    const res = await client.query('SELECT * FROM documents WHERE id = $1 AND deposito_id = $2', [
      id,
      depositoId,
    ]);
    const row = (res as { rows: Array<Record<string, unknown>> }).rows[0];
    return row ? mapDocumento(row) : null;
  });
}

export async function listDocumentosByDeposito(
  depositoId: string,
  perfil: string,
): Promise<DocumentRow[]> {
  return withDepositoContext(depositoId, perfil, async (client) => {
    const res = await client.query(
      `SELECT * FROM documents WHERE deposito_id = $1 ORDER BY criado_em DESC LIMIT 100`,
      [depositoId],
    );
    return (res as { rows: Array<Record<string, unknown>> }).rows.map(mapDocumento);
  });
}