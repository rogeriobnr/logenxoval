import type { ConsumableMovementRow, ConsumableRow, PpeItemRow, PpeMovementRow } from '@logenxoval/contracts';
import { withDepositoContext } from '../db/pool';
import { newId, sha256Hex } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { insertAuditLogWith } from './auditLogRepo';

function rowsOf(res: unknown): Array<Record<string, unknown>> {
  return (res as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

export function mapConsumable(row: Record<string, unknown>): ConsumableRow {
  return {
    id: row.id as string,
    depositoId: row.deposito_id as string,
    foto: (row.foto as string | null) ?? undefined,
    codigo: row.codigo as string,
    descricao: row.descricao as string,
    quantidade: Number(row.quantidade),
    unidade: row.unidade as string,
    estoqueAtual: Number(row.estoque_atual),
    estoqueMinimo: Number(row.estoque_minimo),
    historico: (row.historico as unknown[]) ?? [],
  };
}

export function mapPpeItem(row: Record<string, unknown>): PpeItemRow {
  return {
    id: row.id as string,
    depositoId: row.deposito_id as string,
    foto: (row.foto as string | null) ?? undefined,
    codigo: row.codigo as string,
    descricao: row.descricao as string,
    quantidade: Number(row.quantidade),
    unidade: 'unidade',
    estoqueAtual: Number(row.estoque_atual),
    estoqueMinimo: Number(row.estoque_minimo),
    historico: (row.historico as unknown[]) ?? [],
  };
}

export function mapConsumableMovement(row: Record<string, unknown>): ConsumableMovementRow {
  return {
    id: row.id as string,
    consumableId: row.consumable_id as string,
    depositoId: row.deposito_id as string,
    operationId: row.operation_id as string,
    tipo: row.tipo as ConsumableMovementRow['tipo'],
    quantidade: Number(row.quantidade),
    dataHora: (row.data_hora as Date).toISOString(),
    usuarioId: row.usuario_id as string,
    matricula: row.matricula as string,
    motivo: (row.motivo as string | null) ?? undefined,
  };
}

export function mapPpeMovement(row: Record<string, unknown>): PpeMovementRow {
  return {
    id: row.id as string,
    ppeItemId: row.ppe_item_id as string,
    depositoId: row.deposito_id as string,
    operationId: row.operation_id as string,
    tipo: row.tipo as PpeMovementRow['tipo'],
    quantidade: Number(row.quantidade),
    dataHora: (row.data_hora as Date).toISOString(),
    usuarioId: row.usuario_id as string,
    matricula: row.matricula as string,
    motivo: (row.motivo as string | null) ?? undefined,
  };
}

export async function listarConsumiveis(depositoId: string, perfil: string): Promise<ConsumableRow[]> {
  return withDepositoContext(depositoId, perfil, async (client) => {
    const res = await client.query(
      `SELECT * FROM consumables WHERE deposito_id = $1 ORDER BY codigo`,
      [depositoId],
    );
    return rowsOf(res).map(mapConsumable);
  });
}

export async function listarPpeItems(depositoId: string, perfil: string): Promise<PpeItemRow[]> {
  return withDepositoContext(depositoId, perfil, async (client) => {
    const res = await client.query(
      `SELECT * FROM ppe_items WHERE deposito_id = $1 ORDER BY codigo`,
      [depositoId],
    );
    return rowsOf(res).map(mapPpeItem);
  });
}

export async function listarMovimentosConsumivel(
  depositoId: string,
  consumableId: string,
  perfil: string,
): Promise<ConsumableMovementRow[]> {
  return withDepositoContext(depositoId, perfil, async (client) => {
    const res = await client.query(
      `SELECT * FROM consumable_movements WHERE deposito_id = $1 AND consumable_id = $2 ORDER BY data_hora DESC`,
      [depositoId, consumableId],
    );
    return rowsOf(res).map(mapConsumableMovement);
  });
}

export async function listarMovimentosPpe(
  depositoId: string,
  ppeItemId: string,
  perfil: string,
): Promise<PpeMovementRow[]> {
  return withDepositoContext(depositoId, perfil, async (client) => {
    const res = await client.query(
      `SELECT * FROM ppe_movements WHERE deposito_id = $1 AND ppe_item_id = $2 ORDER BY data_hora DESC`,
      [depositoId, ppeItemId],
    );
    return rowsOf(res).map(mapPpeMovement);
  });
}

export interface ObservacaoEntradaEstoque {
  jaProcessada: boolean;
  itemId: string;
  codigo: string;
  saldo: number;
  criado: boolean;
}

/**
 * Entrada (recebimento) de consumível ou EPI (docs 16): cria o item no catálogo
 * se o código ainda não existir no depósito, credita estoque_atual e registra o
 * movimento ENTRADA. Idempotente por operation_id.
 */
export async function aplicarEntradaEstoque(params: {
  depositoId: string;
  perfil: string;
  usuarioId: string;
  matricula: string;
  operationId: string;
  tipo: 'CONSUMIVEL' | 'EPI';
  codigo: string;
  descricao: string;
  unidade?: string;
  estoqueMinimo?: number;
  quantidade: number;
  observacao?: string;
  origem: 'ONLINE' | 'OFFLINE';
  dispositivo: string;
  dataHora: string;
  assinaturaMatricula: string;
}): Promise<ObservacaoEntradaEstoque> {
  const tabela = params.tipo === 'CONSUMIVEL' ? 'consumables' : 'ppe_items';
  const movTable = params.tipo === 'CONSUMIVEL' ? 'consumable_movements' : 'ppe_movements';
  const refCol = params.tipo === 'CONSUMIVEL' ? 'consumable_id' : 'ppe_item_id';
  const unidade = params.tipo === 'CONSUMIVEL' ? (params.unidade?.trim() || 'unidade') : 'unidade';
  const estoqueMinimo = params.estoqueMinimo ?? 0;

  return withDepositoContext(params.depositoId, params.perfil, async (client) => {
    const dup = await client.query(
      'SELECT resultado FROM processed_operations WHERE operation_id = $1',
      [params.operationId],
    );
    const dupRow = rowsOf(dup)[0];
    if (dupRow) {
      const r = (dupRow.resultado as unknown as Record<string, unknown>) ?? {};
      return {
        jaProcessada: true,
        itemId: (r.itemId as string) ?? '',
        codigo: (r.codigo as string) ?? params.codigo,
        saldo: Number(r.saldo ?? 0),
        criado: Boolean(r.criado),
      };
    }

    const dep = await client.query(
      'SELECT id, status FROM deposits WHERE id = $1',
      [params.depositoId],
    );
    const depRow = rowsOf(dep)[0];
    if (!depRow) throw new AppError('NAO_ENCONTRADO', 'Depósito não encontrado', 404);
    if (depRow.status === 'INATIVO') {
      throw new AppError('OPERACAO_NEGADA', 'Depósito inativo não aceita entradas', 409);
    }

    const find = await client.query(
      `SELECT id FROM ${tabela} WHERE deposito_id = $1 AND codigo = $2 FOR UPDATE`,
      [params.depositoId, params.codigo],
    );
    const existente = rowsOf(find)[0];
    const itemId = existente ? (existente.id as string) : newId();
    const criado = !existente;

    if (criado) {
      await client.query(
        `INSERT INTO ${tabela}
          (id, deposito_id, codigo, descricao, unidade, quantidade, estoque_atual, estoque_minimo)
         VALUES ($1,$2,$3,$4,$5,0,0,$6)`,
        [itemId, params.depositoId, params.codigo, params.descricao, unidade, estoqueMinimo],
      );
    } else {
      await client.query(
        `UPDATE ${tabela}
           SET descricao = $2,
               unidade = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE unidade END,
               estoque_minimo = CASE WHEN $4::int IS NOT NULL THEN $4 ELSE estoque_minimo END
         WHERE id = $1`,
        [itemId, params.descricao, unidade, estoqueMinimo],
      );
    }

    const upd = await client.query(
      `UPDATE ${tabela} SET estoque_atual = estoque_atual + $2, quantidade = estoque_atual + $2
       WHERE id = $1 RETURNING estoque_atual`,
      [itemId, params.quantidade],
    );
    const saldo = Number(rowsOf(upd)[0]?.estoque_atual ?? params.quantidade);

    await client.query(
      `INSERT INTO ${movTable}
        (id, ${refCol}, deposito_id, operation_id, tipo, quantidade, data_hora, usuario_id, matricula, motivo)
       VALUES ($1,$2,$3,$4,'ENTRADA',$5,$6,$7,$8,$9)`,
      [
        newId(),
        itemId,
        params.depositoId,
        params.operationId,
        params.quantidade,
        new Date(params.dataHora).toISOString(),
        params.usuarioId,
        params.matricula,
        params.observacao ?? null,
      ],
    );

    await client.query(
      `INSERT INTO processed_operations (operation_id, entidade, acao, payload_hash, processado_em, resultado)
       VALUES ($1,$2,'CREATE',$3,now(),$4::jsonb)`,
      [
        params.operationId,
        movTable,
        sha256Hex(JSON.stringify({ operationId: params.operationId, tipo: params.tipo, codigo: params.codigo, quantidade: params.quantidade })),
        JSON.stringify({ itemId, codigo: params.codigo, saldo, criado }),
      ],
    );

    await insertAuditLogWith(client, {
      tipo: 'ENTRADA_ESTOQUE',
      usuarioId: params.usuarioId,
      matricula: params.matricula,
      depositoId: params.depositoId,
      entidade: movTable,
      operacaoId: params.operationId,
      estadoAnterior: { codigo: params.codigo, criado },
      estadoPosterior: { codigo: params.codigo, tipo: params.tipo, quantidade: params.quantidade, saldo },
      motivo: params.observacao,
      origem: params.origem,
      dispositivo: params.dispositivo,
    });

    return { jaProcessada: false, itemId, codigo: params.codigo, saldo, criado };
  });
}