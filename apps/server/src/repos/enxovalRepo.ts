import type { DepositVersionRow, InventoryItemRow } from '@logenxoval/contracts';
import { withDepositoContext } from '../db/pool';
import { newId } from '../lib/crypto';
import { AppError } from '../lib/errors';

export interface EnxovalItemDraft {
  codigoSap: string;
  materialId?: string;
  textoBreve: string;
  foto?: string;
  qtdOficial: number;
  qtdAtual: number;
  utilizacaoLivre: boolean;
  valorUnitario?: number;
  valorTotal?: number;
  unidadeMedida?: string;
  estoqueMinimo?: number;
  status?: InventoryItemRow['status'];
}

type Client = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

interface PgRows {
  rows?: Array<Record<string, unknown>>;
}

function rowsOf(res: unknown): Array<Record<string, unknown>> {
  return (res as PgRows).rows ?? [];
}

export function mapInventoryItem(row: Record<string, unknown>): InventoryItemRow {
  return {
    id: row.id as string,
    depositoId: row.deposito_id as string,
    codigoSap: row.codigo_sap as string,
    materialId: row.material_id as string | undefined,
    textoBreve: row.texto_breve as string,
    foto: row.foto as string | undefined,
    qtdOficial: Number(row.qtd_oficial ?? 0),
    qtdAtual: Number(row.qtd_atual ?? 0),
    utilizacaoLivre: Boolean(row.utilizacao_livre),
    valorUnitario: row.valor_unitario === null ? undefined : Number(row.valor_unitario),
    valorTotal: row.valor_total === null ? undefined : Number(row.valor_total),
    unidadeMedida: row.unidade_medida as string | undefined,
    estoqueMinimo: row.estoque_minimo === null ? undefined : Number(row.estoque_minimo),
    status: row.status as InventoryItemRow['status'],
    versao: row.versao as string,
    criadoEm: (row.criado_em as Date).toISOString(),
    atualizadoEm: (row.atualizado_em as Date).toISOString(),
    usuarioResponsavel: row.usuario_responsavel as string,
  };
}

export function mapVersion(row: Record<string, unknown>): DepositVersionRow {
  return {
    id: row.id as string,
    depositoId: row.deposito_id as string,
    versao: Number(row.versao),
    dataEm: (row.data_em as Date).toISOString(),
    usuarioId: row.usuario_id as string,
    matricula: row.matricula as string,
    documentoId: row.documento_id as string | undefined,
    alteracoes: row.alteracoes ?? undefined,
    motivo: row.motivo as string | undefined,
    refFolha: row.ref_folha as string | undefined,
    hashDocumento: row.hash_documento as string | undefined,
    status: row.status as DepositVersionRow['status'],
  };
}

async function findVersionById(client: Client, versionId: string): Promise<Record<string, unknown> | null> {
  const res = await client.query('SELECT * FROM deposit_versions WHERE id = $1', [versionId]);
  return rowsOf(res)[0] ?? null;
}

/** Itens de uma versão do depósito (contexto RLS já aplicado). */
export async function listItemsByVersion(
  depositoId: string,
  versionId: string,
  perfil: string,
): Promise<InventoryItemRow[]> {
  return withDepositoContext(depositoId, perfil, async (client) => {
    const res = await client.query(
      `SELECT * FROM inventory_items WHERE deposito_id = $1 AND versao = $2 ORDER BY texto_breve`,
      [depositoId, versionId],
    );
    return rowsOf(res).map(mapInventoryItem);
  });
}

/** Itens da versão atual do depósito. */
export async function listItemsAtual(depositoId: string, perfil: string): Promise<InventoryItemRow[]> {
  return withDepositoContext(depositoId, perfil, async (client) => {
    const res = await client.query(
      `SELECT ii.* FROM inventory_items ii
       JOIN deposits d ON d.versao_atual_enxoval = ii.versao
       WHERE ii.deposito_id = $1 ORDER BY ii.texto_breve`,
      [depositoId],
    );
    return rowsOf(res).map(mapInventoryItem);
  });
}

export async function listVersions(depositoId: string, perfil: string): Promise<DepositVersionRow[]> {
  return withDepositoContext(depositoId, perfil, async (client) => {
    const res = await client.query(
      `SELECT * FROM deposit_versions WHERE deposito_id = $1 ORDER BY versao DESC`,
      [depositoId],
    );
    return rowsOf(res).map(mapVersion);
  });
}

export interface VersionPublishResult {
  versao: DepositVersionRow;
  itens: InventoryItemRow[];
}

/**
 * Publica uma nova versão do enxoval (transação atômica, docs 2.3 item 3):
 * 1) grava a nova deposit_versions com versao = máxima + 1;
 * 2) marca a versão anterior como SUBSTITUIDA;
 * 3) insere os itens da nova versão (qtdAtual = qtdOficial na importação);
 * 4) atualiza deposits.versao_atual_enxoval;
 * 5) retorna a versão publicada e seus itens.
 */
export async function publicarVersao(params: {
  depositoId: string;
  perfil: string;
  usuarioId: string;
  matricula: string;
  documentoId?: string;
  refFolha?: string;
  motivo: string;
  itens: EnxovalItemDraft[];
}): Promise<VersionPublishResult> {
  return withDepositoContext(params.depositoId, params.perfil, async (client) => {
    const dep = await client.query('SELECT versao_atual_enxoval FROM deposits WHERE id = $1', [
      params.depositoId,
    ]);
    const depRow = rowsOf(dep)[0];
    if (!depRow) throw new AppError('NAO_ENCONTRADO', 'Depósito não encontrado', 404);
    const versaoAtual = (depRow.versao_atual_enxoval as string) ?? null;

    const maxRes = await client.query(
      'SELECT COALESCE(MAX(versao), 0) AS max FROM deposit_versions WHERE deposito_id = $1',
      [params.depositoId],
    );
    const numero = Number((rowsOf(maxRes)[0] as Record<string, unknown>).max) + 1;

    const versionId = newId();
    await client.query(
      `INSERT INTO deposit_versions
        (id, deposito_id, versao, data_em, usuario_id, matricula, documento_id, alteracoes, motivo, ref_folha, status)
       VALUES ($1,$2,$3,now(),$4,$5,$6,$7::jsonb,$8,$9,'PUBLICADA')`,
      [
        versionId,
        params.depositoId,
        numero,
        params.usuarioId,
        params.matricula,
        params.documentoId ?? null,
        JSON.stringify({ itens: params.itens.length }),
        params.motivo,
        params.refFolha ?? null,
      ],
    );

    if (versaoAtual) {
      await client.query(
        `UPDATE deposit_versions SET status = 'SUBSTITUIDA' WHERE id = $1 AND deposito_id = $2`,
        [versaoAtual, params.depositoId],
      );
    }

    for (const item of params.itens) {
      await client.query(
        `INSERT INTO inventory_items
          (id, deposito_id, codigo_sap, material_id, texto_breve, foto, qtd_oficial, qtd_atual,
           utilizacao_livre, valor_unitario, valor_total, unidade_medida, estoque_minimo,
           status, versao, criado_em, atualizado_em, usuario_responsavel)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now(),now(),$16)`,
        [
          newId(),
          params.depositoId,
          item.codigoSap,
          item.materialId ?? null,
          item.textoBreve,
          item.foto ?? null,
          item.qtdOficial,
          item.qtdAtual,
          item.utilizacaoLivre,
          item.valorUnitario ?? null,
          item.valorTotal ?? null,
          item.unidadeMedida ?? null,
          item.estoqueMinimo ?? null,
          item.status ?? 'ATIVO',
          versionId,
          params.matricula,
        ],
      );
    }

    await client.query(`UPDATE deposits SET versao_atual_enxoval = $2 WHERE id = $1`, [
      params.depositoId,
      versionId,
    ]);

    const ver = await findVersionById(client, versionId);
    if (!ver) throw new Error('Versão não encontrada após publicação');
    const itensRes = await client.query(
      `SELECT * FROM inventory_items WHERE versao = $1 ORDER BY texto_breve`,
      [versionId],
    );
    return {
      versao: mapVersion(ver),
      itens: rowsOf(itensRes).map(mapInventoryItem),
    };
  });
}