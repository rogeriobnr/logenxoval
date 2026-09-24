import type { ConsumableMovementRow, ConsumableRow, PpeItemRow, PpeMovementRow } from '@logenxoval/contracts';
import { withDepositoContext } from '../db/pool';

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