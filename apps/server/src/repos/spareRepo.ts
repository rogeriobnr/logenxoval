import type { SparePartMovementRow, SparePartRow, TipoMovimentacaoSparePart } from '@logenxoval/contracts';
import { withDepositoContext } from '../db/pool';
import { newId, sha256Hex } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { insertAuditLogWith, type Queryable } from './auditLogRepo';

type Client = Queryable;

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

export function mapMovement(row: Record<string, unknown>): SparePartMovementRow {
  return {
    id: row.id as string,
    depositoId: row.deposito_id as string,
    sparePartId: row.spare_part_id as string,
    operationId: row.operation_id as string,
    tipo: row.tipo as TipoMovimentacaoSparePart,
    quantidade: Number(row.quantidade),
    dataHora: (row.data_hora as Date).toISOString(),
    usuarioId: row.usuario_id as string,
    matricula: row.matricula as string,
    motivo: (row.motivo as string | null) ?? undefined,
    estadoAnterior: (row.estado_anterior as unknown) ?? undefined,
    estadoPosterior: (row.estado_posterior as unknown) ?? undefined,
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

export interface EntradaPecaParams {
  depositoId: string;
  perfil: string;
  usuarioId: string;
  matricula: string;
  operationId: string;
  codigoSap: string;
  descricao: string;
  foto?: string;
  origem: SparePartRow['origem'];
  quantidade: number;
  observacao?: string;
  assinaturaMatricula: string;
  origemMov: 'ONLINE' | 'OFFLINE';
  dispositivo: string;
}

/**
 * Entrada de peça avulsa: vincula a um item do enxoval (SAP), incrementa o saldo
 * (ou cria a peça) e registra movimentação ENTRADA + auditoria — atômico.
 * Idempotente por operationId.
 */
export async function criarPecaAvulsa(params: EntradaPecaParams): Promise<{ peca: SparePartRow; jaProcessada: boolean }> {
  return withDepositoContext(params.depositoId, params.perfil, async (client) => {
    const dup = await client.query('SELECT 1 FROM processed_operations WHERE operation_id = $1', [params.operationId]);
    if (rowsOf(dup)[0]) {
      const existente = await client.query(
        'SELECT * FROM spare_parts WHERE deposito_id = $1 AND codigo_sap = $2 LIMIT 1',
        [params.depositoId, params.codigoSap],
      );
      if (!rowsOf(existente)[0]) throw new AppError('OPERATION_DUPLICADA', 'Operação já processada sem peça correspondente', 409);
      return { peca: mapSparePart(rowsOf(existente)[0]), jaProcessada: true };
    }

    const contexto = (await client.query(
      'SELECT versao_atual_enxoval FROM deposits WHERE id = $1',
      [params.depositoId],
    )) as unknown;
    const versao = rowsOf(contexto)[0]?.versao_atual_enxoval as string | null;
    if (versao) {
      const itemEnxoval = await client.query(
        `SELECT 1 FROM inventory_items WHERE deposito_id = $1 AND codigo_sap = $2 AND versao = $3 LIMIT 1`,
        [params.depositoId, params.codigoSap, versao],
      );
      if (!rowsOf(itemEnxoval)[0]) {
        throw new AppError('INCOMPATIVEL', 'SAP não existe no enxoval vigente', 409);
      }
    }

    const existente = await client.query(
      'SELECT * FROM spare_parts WHERE deposito_id = $1 AND codigo_sap = $2 FOR UPDATE',
      [params.depositoId, params.codigoSap],
    );
    const row = rowsOf(existente)[0];
    let spareId: string;
    let anterior: number;
    if (row) {
      spareId = row.id as string;
      anterior = Number(row.quantidade_atual);
      await client.query('UPDATE spare_parts SET quantidade_atual = $2, descricao = $3 WHERE id = $1', [
        spareId,
        anterior + params.quantidade,
        params.descricao,
      ]);
    } else {
      spareId = newId();
      anterior = 0;
      await client.query(
        `INSERT INTO spare_parts
          (id, deposito_id, foto, codigo_sap, descricao, quantidade_atual, origem, data_entrada, responsavel, observacao, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,now(),$8,$9,'ATIVO')`,
        [
          spareId,
          params.depositoId,
          params.foto ?? null,
          params.codigoSap,
          params.descricao,
          params.quantidade,
          params.origem,
          params.matricula,
          params.observacao ?? null,
        ],
      );
    }

    await client.query(
      `INSERT INTO spare_part_movements
        (id, deposito_id, spare_part_id, operation_id, tipo, quantidade, data_hora, usuario_id, matricula, motivo, estado_anterior, estado_posterior)
       VALUES ($1,$2,$3,$4,'ENTRADA',$5,now(),$6,$7,$8,$9::jsonb,$10::jsonb)`,
      [
        newId(),
        params.depositoId,
        spareId,
        params.operationId,
        params.quantidade,
        params.usuarioId,
        params.matricula,
        params.observacao ?? null,
        JSON.stringify({ quantidade: anterior }),
        JSON.stringify({ quantidade: anterior + params.quantidade }),
      ],
    );

    await insertAuditLogWith(client, {
      tipo: 'ENTRADA_PECA_AVULSA',
      usuarioId: params.usuarioId,
      matricula: params.matricula,
      depositoId: params.depositoId,
      entidade: 'spare_parts',
      operacaoId: params.operationId,
      estadoAnterior: { codigoSap: params.codigoSap, quantidade: anterior },
      estadoPosterior: { codigoSap: params.codigoSap, quantidade: anterior + params.quantidade },
      motivo: params.observacao,
      origem: params.origemMov,
      dispositivo: params.dispositivo,
    });

    await client.query(
      `INSERT INTO processed_operations (operation_id, entidade, acao, payload_hash, processado_em, resultado)
       VALUES ($1,'spare_parts','CREATE',$2,now(),$3::jsonb)`,
      [
        params.operationId,
        sha256Hex(JSON.stringify({ operationId: params.operationId, codigoSap: params.codigoSap, quantidade: params.quantidade })),
        JSON.stringify({ id: spareId, codigoSap: params.codigoSap, quantidade: anterior + params.quantidade }),
      ],
    );
    const final = await client.query('SELECT * FROM spare_parts WHERE id = $1', [spareId]);
    return { peca: mapSparePart(rowsOf(final)[0]), jaProcessada: false };
  });
}

export interface MovimentoPecaParams {
  depositoId: string;
  perfil: string;
  usuarioId: string;
  matricula: string;
  sparePartId: string;
  operationId: string;
  tipo: TipoMovimentacaoSparePart;
  quantidade?: number;
  novoSaldo?: number;
  motivo?: string;
  assinaturaMatricula: string;
  origemMov: 'ONLINE' | 'OFFLINE';
  dispositivo: string;
}

export async function movimentarPeca(
  params: MovimentoPecaParams,
): Promise<{ peca: SparePartRow; movement: SparePartMovementRow }> {
  return withDepositoContext(params.depositoId, params.perfil, async (client) => {
    const dup = await client.query('SELECT 1 FROM processed_operations WHERE operation_id = $1', [params.operationId]);
    if (rowsOf(dup)[0]) {
      const res = await client.query('SELECT * FROM spare_parts WHERE id = $1 AND deposito_id = $2', [
        params.sparePartId,
        params.depositoId,
      ]);
      return { peca: mapSparePart(rowsOf(res)[0]), movement: { operationId: params.operationId } as SparePartMovementRow };
    }

    const res = await client.query('SELECT * FROM spare_parts WHERE id = $1 AND deposito_id = $2 FOR UPDATE', [
      params.sparePartId,
      params.depositoId,
    ]);
    const row = rowsOf(res)[0];
    if (!row) throw new AppError('NAO_ENCONTRADO', 'Peça avulsa não encontrada', 404);
    const anterior = Number(row.quantidade_atual);

    let novoSaldo: number;
    let quantidade: number;
    switch (params.tipo) {
      case 'AJUSTE_AUTORIZADO':
        if (params.novoSaldo === undefined) throw new AppError('VALIDATION_FAILED', 'novoSaldo obrigatório', 400);
        novoSaldo = params.novoSaldo;
        quantidade = novoSaldo - anterior;
        break;
      case 'TRANSFERENCIA_INFORMATIVA':
        novoSaldo = anterior; // movimentação informativa: não altera saldo
        quantidade = params.quantidade ?? 0;
        break;
      default:
        quantidade = params.quantidade ?? 0;
        if (quantidade <= 0) throw new AppError('VALIDATION_FAILED', 'quantidade obrigatória', 400);
        if (anterior < quantidade) {
          throw new AppError('SALDO_CONFLITO', `Saldo insuficiente de peça avulsa (disponível ${anterior})`, 409);
        }
        novoSaldo = anterior - quantidade;
    }

    await client.query('UPDATE spare_parts SET quantidade_atual = $2 WHERE id = $1', [
      params.sparePartId,
      novoSaldo,
    ]);

    await client.query(
      `INSERT INTO spare_part_movements
        (id, deposito_id, spare_part_id, operation_id, tipo, quantidade, data_hora, usuario_id, matricula, motivo, estado_anterior, estado_posterior)
       VALUES ($1,$2,$3,$4,$5,$6,now(),$7,$8,$9,$10::jsonb,$11::jsonb)`,
      [
        newId(),
        params.depositoId,
        params.sparePartId,
        params.operationId,
        params.tipo,
        quantidade,
        params.usuarioId,
        params.matricula,
        params.motivo ?? null,
        JSON.stringify({ quantidade: anterior }),
        JSON.stringify({ quantidade: novoSaldo }),
      ],
    );

    await insertAuditLogWith(client, {
      tipo: 'SAIDA_PECA_AVULSA',
      usuarioId: params.usuarioId,
      matricula: params.matricula,
      depositoId: params.depositoId,
      entidade: 'spare_part_movements',
      operacaoId: params.operationId,
      estadoAnterior: { sparePartId: params.sparePartId, quantidade: anterior, tipo: params.tipo },
      estadoPosterior: { sparePartId: params.sparePartId, quantidade: novoSaldo, tipo: params.tipo },
      motivo: params.motivo,
      origem: params.origemMov,
      dispositivo: params.dispositivo,
    });

    await client.query(
      `INSERT INTO processed_operations (operation_id, entidade, acao, payload_hash, processado_em, resultado)
       VALUES ($1,'spare_part_movements','CREATE',$2,now(),$3::jsonb)`,
      [
        params.operationId,
        sha256Hex(JSON.stringify({ operationId: params.operationId, sparePartId: params.sparePartId, tipo: params.tipo })),
        JSON.stringify({ sparePartId: params.sparePartId, tipo: params.tipo, quantidade: novoSaldo }),
      ],
    );
    const mv = await client.query(
      `SELECT * FROM spare_part_movements WHERE operation_id = $1 AND deposito_id = $2 LIMIT 1`,
      [params.operationId, params.depositoId],
    );
    const nova = await client.query('SELECT * FROM spare_parts WHERE id = $1', [params.sparePartId]);
    return { peca: mapSparePart(rowsOf(nova)[0]), movement: mapMovement(rowsOf(mv)[0] ?? {}) };
  });
}