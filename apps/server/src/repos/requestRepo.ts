import type { LogTipo, RequestRow, RequestStatus, SolicitacaoTipo } from '@logenxoval/contracts';
import { withDepositoContext } from '../db/pool';
import { newId, sha256Hex } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { insertAuditLogWith, type Queryable } from './auditLogRepo';

type Client = Queryable;

function rowsOf(res: unknown): Array<Record<string, unknown>> {
  return (res as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

export function mapRequest(row: Record<string, unknown>): RequestRow {
  return {
    id: row.id as string,
    depositoId: row.deposito_id as string,
    tipo: row.tipo as SolicitacaoTipo,
    solicitanteId: row.solicitante_id as string,
    matricula: row.matricula as string,
    status: row.status as RequestStatus,
    dataEm: (row.data_em as Date).toISOString(),
    itens: (row.itens as Array<{ qtd: number; descricao: string; codigo: string }>) ?? [],
  };
}

export interface CriarSolicitacaoParams {
  depositoId: string;
  perfil: string;
  usuarioId: string;
  matricula: string;
  operationId: string;
  tipo: SolicitacaoTipo;
  itens: Array<{ qtd: number; descricao: string; codigo: string }>;
  assinaturaMatricula: string;
  origemMov: 'ONLINE' | 'OFFLINE';
  dispositivo: string;
}

/**
 * Cria uma solicitação de consumível/EPI em RASCUNHO com auditoria.
 * Idempotente por operationId (docs 7.6).
 */
export async function criarSolicitacao(
  params: CriarSolicitacaoParams,
): Promise<{ solicitacao: RequestRow; jaProcessada: boolean }> {
  return withDepositoContext(params.depositoId, params.perfil, async (client) => {
    const dup = await client.query('SELECT 1 FROM processed_operations WHERE operation_id = $1', [params.operationId]);
    if (rowsOf(dup)[0]) {
      const existente = await client.query(
        'SELECT * FROM requests WHERE deposito_id = $1 AND solicitante_id = $2 ORDER BY data_em DESC LIMIT 1',
        [params.depositoId, params.usuarioId],
      );
      return { solicitacao: mapRequest(rowsOf(existente)[0] ?? {}), jaProcessada: true };
    }

    const id = newId();
    const itens = params.itens.map((i) => ({ qtd: i.qtd, descricao: i.descricao, codigo: i.codigo }));
    await client.query(
      `INSERT INTO requests (id, deposito_id, tipo, solicitante_id, matricula, status, data_em, itens)
       VALUES ($1,$2,$3,$4,$5,'RASCUNHO',now(),$6::jsonb)`,
      [id, params.depositoId, params.tipo, params.usuarioId, params.matricula, JSON.stringify(itens)],
    );

    await insertAuditLogWith(client, {
      tipo: 'SOLICITACAO_CRIADA',
      usuarioId: params.usuarioId,
      matricula: params.matricula,
      depositoId: params.depositoId,
      entidade: 'requests',
      operacaoId: params.operationId,
      estadoAnterior: undefined,
      estadoPosterior: { requestId: id, tipo: params.tipo, itens },
      motivo: undefined,
      origem: params.origemMov,
      dispositivo: params.dispositivo,
    });

    await client.query(
      `INSERT INTO processed_operations (operation_id, entidade, acao, payload_hash, processado_em, resultado)
       VALUES ($1,'requests','CREATE',$2,now(),$3::jsonb)`,
      [
        params.operationId,
        sha256Hex(JSON.stringify({ operationId: params.operationId, tipo: params.tipo, itens })),
        JSON.stringify({ id, status: 'RASCUNHO', tipo: params.tipo }),
      ],
    );

    const final = await client.query('SELECT * FROM requests WHERE id = $1', [id]);
    return { solicitacao: mapRequest(rowsOf(final)[0]), jaProcessada: false };
  });
}

export interface TransicionarSolicitacaoParams {
  depositoId: string;
  perfil: string;
  usuarioId: string;
  matricula: string;
  operationId: string;
  requestId: string;
  para: RequestStatus;
  motivo?: string;
  assinaturaMatricula: string;
  origemMov: 'ONLINE' | 'OFFLINE';
  dispositivo: string;
}

const LOG_TIPO_POR_TRANSICAO: Partial<Record<RequestStatus, LogTipo>> = {
  PRONTA_PARA_ENVIO: 'SOLICITACAO_ATUALIZADA',
  ENVIADA: 'SOLICITACAO_ENVIADA',
  RECEBIDA_PELA_LIDERANCA: 'SOLICITACAO_ATUALIZADA',
  APROVADA: 'SOLICITACAO_APROVADA',
  ATENDIDA: 'SOLICITACAO_ATENDIDA',
  CANCELADA: 'SOLICITACAO_CANCELADA',
};

export async function obterSolicitacao(
  depositoId: string,
  perfil: string,
  requestId: string,
): Promise<RequestRow | null> {
  return withDepositoContext(depositoId, perfil, async (client) => {
    const res = await client.query('SELECT * FROM requests WHERE id = $1 AND deposito_id = $2', [
      requestId,
      depositoId,
    ]);
    const row = rowsOf(res)[0];
    return row ? mapRequest(row) : null;
  });
}

export async function transicionarSolicitacao(
  params: TransicionarSolicitacaoParams,
): Promise<{ solicitacao: RequestRow; jaProcessada: boolean }> {
  return withDepositoContext(params.depositoId, params.perfil, async (client) => {
    const dup = await client.query('SELECT 1 FROM processed_operations WHERE operation_id = $1', [params.operationId]);
    if (rowsOf(dup)[0]) {
      const res = await client.query('SELECT * FROM requests WHERE id = $1 AND deposito_id = $2', [
        params.requestId,
        params.depositoId,
      ]);
      return { solicitacao: mapRequest(rowsOf(res)[0] ?? {}), jaProcessada: true };
    }

    const res = await client.query('SELECT * FROM requests WHERE id = $1 AND deposito_id = $2 FOR UPDATE', [
      params.requestId,
      params.depositoId,
    ]);
    const row = rowsOf(res)[0];
    if (!row) throw new AppError('NAO_ENCONTRADO', 'Solicitação não encontrada', 404);
    const anterior = row.status as RequestStatus;

    await client.query('UPDATE requests SET status = $2 WHERE id = $1', [params.requestId, params.para]);

    const tipo = LOG_TIPO_POR_TRANSICAO[params.para] ?? 'SOLICITACAO_ATUALIZADA';
    await insertAuditLogWith(client, {
      tipo,
      usuarioId: params.usuarioId,
      matricula: params.matricula,
      depositoId: params.depositoId,
      entidade: 'requests',
      operacaoId: params.operationId,
      estadoAnterior: { requestId: params.requestId, status: anterior },
      estadoPosterior: { requestId: params.requestId, status: params.para },
      motivo: params.motivo,
      origem: params.origemMov,
      dispositivo: params.dispositivo,
    });

    await client.query(
      `INSERT INTO processed_operations (operation_id, entidade, acao, payload_hash, processado_em, resultado)
       VALUES ($1,'requests','TRANSICAO',$2,now(),$3::jsonb)`,
      [
        params.operationId,
        sha256Hex(JSON.stringify({ operationId: params.operationId, requestId: params.requestId, para: params.para })),
        JSON.stringify({ id: params.requestId, de: anterior, para: params.para }),
      ],
    );

    const novo = await client.query('SELECT * FROM requests WHERE id = $1', [params.requestId]);
    return { solicitacao: mapRequest(rowsOf(novo)[0]), jaProcessada: false };
  });
}

export async function listarSolicitacoes(
  depositoId: string,
  perfil: string,
  usuarioId: string,
  tipo?: SolicitacaoTipo,
): Promise<RequestRow[]> {
  return withDepositoContext(depositoId, perfil, async (client) => {
    const params: string[] = [depositoId];
    let sql = `SELECT * FROM requests WHERE deposito_id = $1`;
    if (perfil === 'MECANICO') {
      sql += ` AND solicitante_id = $${params.length + 1}`;
      params.push(usuarioId);
    }
    if (tipo) {
      sql += ` AND tipo = $${params.length + 1}`;
      params.push(tipo);
    }
    sql += ` ORDER BY data_em DESC`;
    const res = await client.query(sql, params);
    return rowsOf(res).map(mapRequest);
  });
}