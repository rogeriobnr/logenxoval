import { withDepositoContext } from '../db/pool';
import { newId } from '../lib/crypto';

export interface CriarSnapshotParams {
  depositoId: string;
  titulo: string;
  tipo: 'ANTES' | 'DEPOIS';
  motivo?: string;
  usuarioId: string;
  matricula: string;
}

export async function criarSnapshot(
  params: CriarSnapshotParams,
  perfil: string,
): Promise<{ id: string }> {
  return withDepositoContext(params.depositoId, perfil, async (client) => {
    const dep = await client.query('SELECT versao_atual_enxoval FROM deposits WHERE id = $1', [
      params.depositoId,
    ]);
    const versaoAtual = (dep as { rows?: Array<Record<string, unknown>> }).rows?.[0]
      ?.versao_atual_enxoval as string | null;

    const versoes = await client.query(
      `SELECT * FROM deposit_versions WHERE deposito_id = $1 ORDER BY versao`,
      [params.depositoId],
    );
    const enxoval = versaoAtual
      ? await client.query(
          `SELECT codigo_sap, material_id, texto_breve, foto, qtd_oficial, qtd_atual,
                  utilizacao_livre, valor_unitario, valor_total, unidade_medida, estoque_minimo, status
           FROM inventory_items WHERE deposito_id = $1 AND versao = $2`,
          [params.depositoId, versaoAtual],
        )
      : { rows: [] };

    const pecas = await client.query(
      `SELECT codigo_sap, descricao, quantidade_atual, origem, status
       FROM spare_parts WHERE deposito_id = $1`,
      [params.depositoId],
    );
    const consumiveis = await client.query(
      `SELECT * FROM consumables WHERE deposito_id = $1`,
      [params.depositoId],
    );
    const epis = await client.query(`SELECT * FROM ppe_items WHERE deposito_id = $1`, [
      params.depositoId,
    ]);
    const config = await client.query(
      `SELECT chave, valor FROM settings WHERE deposito_id = $1`,
      [params.depositoId],
    );

    const id = newId();
    await client.query(
      `INSERT INTO snapshots (id, deposito_id, titulo, tipo, motivo, usuario_id, matricula, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [
        id,
        params.depositoId,
        params.titulo,
        params.tipo,
        params.motivo ?? null,
        params.usuarioId,
        params.matricula,
        JSON.stringify({
          versaoAtual,
          versoes: (versoes as { rows: unknown[] }).rows,
          enxoval: (enxoval as { rows: unknown[] }).rows,
          pecas: (pecas as { rows: unknown[] }).rows,
          consumiveis: (consumiveis as { rows: unknown[] }).rows,
          epis: (epis as { rows: unknown[] }).rows,
          configuracoes: (config as { rows: unknown[] }).rows,
        }),
      ],
    );
    return { id };
  });
}