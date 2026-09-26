import type { DivergenceRow } from '@logenxoval/contracts';
import { withDepositoContext } from '../db/pool';

export interface FiltroDivergencias {
  status?: string;
  tipo?: string;
  limit?: number;
}

function rowsOf(res: unknown): Array<Record<string, unknown>> {
  return ((res as { rows: Array<Record<string, unknown>> }).rows ?? []) as Array<Record<string, unknown>>;
}

function mapDivergencia(row: Record<string, unknown>): DivergenceRow {
  return {
    id: row.id as string,
    depositoId: row.deposito_id as string,
    codigoSap: row.codigo_sap as string,
    descricao: (row.descricao as string) ?? null,
    tipo: row.tipo as DivergenceRow['tipo'],
    quantidade: Number(row.quantidade),
    status: row.status as DivergenceRow['status'],
    origemOperationId: (row.origem_operation_id as string) ?? undefined,
    inspecaoId: (row.inspecao_id as string) ?? undefined,
    criadoEm: new Date(row.criado_em as string).toISOString(),
    criadoPor: row.criado_por as string,
    resolvidoEm: row.resolvido_em ? new Date(row.resolvido_em as string).toISOString() : undefined,
    resolvidoPor: (row.resolvido_por as string) ?? undefined,
  };
}

/**
 * Fase 19: lista as divergências do depósito (pendências de reposição,
 * saldo negativo e conferência) para o espelho local dos dispositivos.
 * Join no enxoval corrente para expor a descrição do item.
 */
export async function listarDivergencias(
  depositoId: string,
  perfil: string,
  filtro: FiltroDivergencias = {},
): Promise<DivergenceRow[]> {
  const limit = filtro.limit ?? 500;
  return withDepositoContext(depositoId, perfil, async (client) => {
    const res = await client.query(
      `SELECT d.id, d.deposito_id, d.codigo_sap, i.texto_breve AS descricao, d.tipo,
              d.quantidade, d.status, d.origem_operation_id, d.inspecao_id,
              d.criado_em, d.criado_por, d.resolvido_em, d.resolvido_por
       FROM divergences d
       LEFT JOIN deposits dep ON dep.id = d.deposito_id
       LEFT JOIN inventory_items i
         ON i.deposito_id = d.deposito_id
        AND i.codigo_sap = d.codigo_sap
        AND i.versao = dep.versao_atual_enxoval
       WHERE d.deposito_id = $1
         AND ($2::text IS NULL OR d.status = $2)
         AND ($3::text IS NULL OR d.tipo = $3)
       ORDER BY d.criado_em DESC
       LIMIT $4`,
      [depositoId, filtro.status ?? null, filtro.tipo ?? null, limit],
    );
    return rowsOf(res).map(mapDivergencia);
  });
}