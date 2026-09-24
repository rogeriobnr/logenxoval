import type { SparePartRow } from '@logenxoval/contracts';
import { withDepositoContext } from '../db/pool';

function rowsOf(res: unknown): Array<Record<string, unknown>> {
  return (res as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

export function mapSparePart(row: Record<string, unknown>): SparePartRow {
  return {
    id: row.id as string,
    depositoId: row.deposito_id as string,
    foto: (row.foto as string | null) ?? undefined,
    codigoSap: row.codigo_sap as string,
    descricao: row.descricao as string,
    quantidadeAtual: Number(row.quantidade_atual),
    origem: row.origem as SparePartRow['origem'],
    dataEntrada: (row.data_entrada as Date).toISOString(),
    responsavel: row.responsavel as string,
    observacao: (row.observacao as string | null) ?? undefined,
    status: row.status as SparePartRow['status'],
  };
}

export async function listarPecasAvulsas(depositoId: string, perfil: string): Promise<SparePartRow[]> {
  return withDepositoContext(depositoId, perfil, async (client) => {
    const res = await client.query(
      `SELECT * FROM spare_parts WHERE deposito_id = $1 AND status = 'ATIVO' ORDER BY codigo_sap, data_entrada`,
      [depositoId],
    );
    return rowsOf(res).map(mapSparePart);
  });
}