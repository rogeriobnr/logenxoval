import type { GoldboxMovementRow } from '@logenxoval/contracts';
import { withDepositoContext } from '../db/pool';
import { newId, sha256Hex } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { insertAuditLogWith } from './auditLogRepo';

type Client = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

interface PgRows {
  rows?: Array<Record<string, unknown>>;
}

function rowsOf(res: unknown): Array<Record<string, unknown>> {
  return (res as PgRows).rows ?? [];
}

export function mapGoldboxMovimento(row: Record<string, unknown>): GoldboxMovementRow {
  return {
    id: row.id as string,
    operationId: row.operation_id as string,
    depositoId: row.deposito_id as string,
    codigoSap: row.codigo_sap as string,
    materialId: row.material_id as string | undefined,
    descricao: row.descricao as string | undefined,
    quantidade: Number(row.quantidade),
    dataHora: (row.data_hora as Date).toISOString(),
    usuarioId: row.usuario_id as string,
    nomeCompleto: row.nome_completo as string,
    matricula: row.matricula as string,
    reposicao: Boolean(row.reposicao),
    tipo: row.tipo === 'ENTRADA' ? 'ENTRADA' : 'BAIXA',
    origem: row.origem as GoldboxMovementRow['origem'],
    dispositivo: row.dispositivo as string,
    statusSync: row.status_sync as GoldboxMovementRow['statusSync'],
    assinaturaMatricula: row.assinatura_matricula as string | undefined,
    estornoDe: row.estorno_de as string | undefined,
  };
}

export interface ObservacaoBaixa {
  jaProcessada: boolean;
  movimento: GoldboxMovementRow;
  saldo: number;
  divergenciaCriada: boolean;
}

export async function aplicarBaixa(params: {
  depositoId: string;
  perfil: string;
  usuarioId: string;
  matricula: string;
  nomeCompleto: string;
  operationId: string;
  codigoSap: string;
  materialId?: string;
  descricao?: string;
  quantidade: number;
  reposicao: boolean;
  origem: 'ONLINE' | 'OFFLINE';
  dispositivo: string;
  dataHora: string;
  assinaturaMatricula: string;
}): Promise<ObservacaoBaixa> {
  return withDepositoContext(params.depositoId, params.perfil, async (client) => {
    const dup = await client.query(
      'SELECT resultado FROM processed_operations WHERE operation_id = $1',
      [params.operationId],
    );
    const dupRow = rowsOf(dup)[0];
    if (dupRow) {
      const mov = await findByOperationId(client, params.operationId);
      return {
        jaProcessada: true,
        movimento: mov ?? (dupRow.resultado as unknown as GoldboxMovementRow),
        saldo: 0,
        divergenciaCriada: false,
      };
    }

    const dep = await client.query(
      'SELECT id, status, versao_atual_enxoval FROM deposits WHERE id = $1',
      [params.depositoId],
    );
    const depRow = rowsOf(dep)[0];
    if (!depRow) throw new AppError('NAO_ENCONTRADO', 'Depósito não encontrado', 404);
    if (depRow.status === 'INATIVO') {
      throw new AppError('OPERACAO_NEGADA', 'Depósito inativo não aceita baixas', 409);
    }

    const itRes = await client.query(
      `SELECT id, texto_breve, material_id, qtd_atual FROM inventory_items
       WHERE deposito_id = $1 AND codigo_sap = $2 AND versao = $3 FOR UPDATE`,
      [params.depositoId, params.codigoSap, depRow.versao_atual_enxoval ?? null],
    );
    const item = rowsOf(itRes)[0];
    if (!item) throw new AppError('ITEM_INDISPONIVEL', 'Item não encontrado no enxoval da versão atual', 404);

    const novoSaldo = Number(item.qtd_atual) - params.quantidade;
    const movimentoId = newId();

    await client.query(
      `INSERT INTO goldbox_movements
        (id, operation_id, deposito_id, codigo_sap, material_id, descricao, quantidade,
         data_hora, usuario_id, nome_completo, matricula, reposicao, origem, dispositivo,
         status_sync, assinatura_matricula, criado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'ENVIADO',$15,now())`,
      [
        movimentoId,
        params.operationId,
        params.depositoId,
        params.codigoSap,
        params.materialId ?? item.material_id ?? null,
        params.descricao ?? item.texto_breve,
        params.quantidade,
        new Date(params.dataHora).toISOString(),
        params.usuarioId,
        params.nomeCompleto,
        params.matricula,
        params.reposicao,
        params.origem,
        params.dispositivo,
        params.assinaturaMatricula,
      ],
    );

    await client.query('UPDATE inventory_items SET qtd_atual = $2, atualizado_em = now() WHERE id = $1', [
      item.id,
      novoSaldo,
    ]);

    let divergenciaCriada = false;
    if (novoSaldo < 0) {
      divergenciaCriada = true;
      await client.query(
        `INSERT INTO divergences
          (id, deposito_id, codigo_sap, tipo, quantidade, status, origem_operation_id, criado_em, criado_por)
         VALUES ($1,$2,$3,'SALDO_NEGATIVO',$4,'ABERTA',$5,now(),$6)`,
        [newId(), params.depositoId, params.codigoSap, novoSaldo, params.operationId, params.matricula],
      );
      await insertAuditLogWith(client, {
        tipo: 'DIVERGENCIA',
        usuarioId: params.usuarioId,
        matricula: params.matricula,
        depositoId: params.depositoId,
        entidade: 'divergences',
        operacaoId: params.operationId,
        estadoPosterior: { codigoSap: params.codigoSap, tipo: 'SALDO_NEGATIVO', quantidade: novoSaldo },
        origem: params.origem,
        dispositivo: params.dispositivo,
      });
    }

    // Baixa marcada como "é reposição" → item entra na lista de aguardando
    // reposição (divergência REPOSICAO ABERTA, resolvida pela entrada).
    if (params.reposicao) {
      const jaExiste = await client.query(
        `SELECT 1 FROM divergences
         WHERE deposito_id = $1 AND codigo_sap = $2 AND tipo = 'REPOSICAO' AND status = 'ABERTA' LIMIT 1`,
        [params.depositoId, params.codigoSap],
      );
      if (!rowsOf(jaExiste)[0]) {
        await client.query(
          `INSERT INTO divergences
            (id, deposito_id, codigo_sap, tipo, quantidade, status, origem_operation_id, criado_em, criado_por)
           VALUES ($1,$2,$3,'REPOSICAO',$4,'ABERTA',$5,now(),$6)`,
          [
            newId(),
            params.depositoId,
            params.codigoSap,
            params.quantidade,
            params.operationId,
            params.matricula,
          ],
        );
      }
    }

    await client.query(
      `INSERT INTO processed_operations (operation_id, entidade, acao, payload_hash, processado_em, resultado)
       VALUES ($1,'goldbox_movements','CREATE',$2,now(),$3::jsonb)`,
      [
        params.operationId,
        sha256Hex(JSON.stringify({ operationId: params.operationId, codigoSap: params.codigoSap, quantidade: params.quantidade })),
        JSON.stringify({
          id: movimentoId,
          codigoSap: params.codigoSap,
          quantidade: params.quantidade,
          saldo: novoSaldo,
        }),
      ],
    );

    await insertAuditLogWith(client, {
      tipo: 'BAIXA',
      usuarioId: params.usuarioId,
      matricula: params.matricula,
      depositoId: params.depositoId,
      entidade: 'goldbox_movements',
      operacaoId: params.operationId,
      estadoPosterior: {
        codigoSap: params.codigoSap,
        quantidade: params.quantidade,
        reposicao: params.reposicao,
        saldo: novoSaldo,
      },
      origem: params.origem,
      dispositivo: params.dispositivo,
    });

    const movimento = (await findByOperationIdRaw(client, params.operationId))!;
    return { jaProcessada: false, movimento: mapGoldboxMovimento(movimento), saldo: novoSaldo, divergenciaCriada };
  });
}

export interface ObservacaoEntrada {
  jaProcessada: boolean;
  movimento: GoldboxMovementRow;
  saldo: number;
  divergenciasFechadas: number;
}

/**
 * Entrada de material no enxoval (reposição recebida do almoxarifado):
 * credita qtd_atual, grava movimento tipo ENTRADA e RESOLVE as divergências
 * REPOSICAO ABERTAS do mesmo SAP (docs 16).
 */
export async function aplicarEntrada(params: {
  depositoId: string;
  perfil: string;
  usuarioId: string;
  matricula: string;
  nomeCompleto: string;
  operationId: string;
  codigoSap: string;
  materialId?: string;
  descricao?: string;
  quantidade: number;
  observacao?: string;
  origem: 'ONLINE' | 'OFFLINE';
  dispositivo: string;
  dataHora: string;
  assinaturaMatricula: string;
}): Promise<ObservacaoEntrada> {
  return withDepositoContext(params.depositoId, params.perfil, async (client) => {
    const dup = await client.query(
      'SELECT resultado FROM processed_operations WHERE operation_id = $1',
      [params.operationId],
    );
    const dupRow = rowsOf(dup)[0];
    if (dupRow) {
      const mov = await findByOperationId(client, params.operationId);
      return {
        jaProcessada: true,
        movimento: mov ?? (dupRow.resultado as unknown as GoldboxMovementRow),
        saldo: 0,
        divergenciasFechadas: 0,
      };
    }

    const dep = await client.query(
      'SELECT id, status, versao_atual_enxoval FROM deposits WHERE id = $1',
      [params.depositoId],
    );
    const depRow = rowsOf(dep)[0];
    if (!depRow) throw new AppError('NAO_ENCONTRADO', 'Depósito não encontrado', 404);
    if (depRow.status === 'INATIVO') {
      throw new AppError('OPERACAO_NEGADA', 'Depósito inativo não aceita entradas', 409);
    }

    const itRes = await client.query(
      `SELECT id, texto_breve, material_id, qtd_atual FROM inventory_items
       WHERE deposito_id = $1 AND codigo_sap = $2 AND versao = $3 FOR UPDATE`,
      [params.depositoId, params.codigoSap, depRow.versao_atual_enxoval ?? null],
    );
    const item = rowsOf(itRes)[0];
    if (!item) throw new AppError('ITEM_INDISPONIVEL', 'Item não encontrado no enxoval da versão atual', 404);

    const novoSaldo = Number(item.qtd_atual) + params.quantidade;
    const movimentoId = newId();

    await client.query(
      `INSERT INTO goldbox_movements
        (id, operation_id, deposito_id, codigo_sap, material_id, descricao, quantidade,
         data_hora, usuario_id, nome_completo, matricula, reposicao, tipo, origem, dispositivo,
         status_sync, assinatura_matricula, criado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,'ENTRADA',$12,$13,'ENVIADO',$14,now())`,
      [
        movimentoId,
        params.operationId,
        params.depositoId,
        params.codigoSap,
        params.materialId ?? item.material_id ?? null,
        params.descricao ?? item.texto_breve,
        params.quantidade,
        new Date(params.dataHora).toISOString(),
        params.usuarioId,
        params.nomeCompleto,
        params.matricula,
        params.origem,
        params.dispositivo,
        params.assinaturaMatricula,
      ],
    );

    await client.query('UPDATE inventory_items SET qtd_atual = $2, atualizado_em = now() WHERE id = $1', [
      item.id,
      novoSaldo,
    ]);

    const resolvidas = await client.query(
      `UPDATE divergences
        SET status = 'RESOLVIDA', resolvido_em = now(), resolvido_por = $3
       WHERE deposito_id = $1 AND codigo_sap = $2 AND tipo = 'REPOSICAO' AND status = 'ABERTA'
       RETURNING id`,
      [params.depositoId, params.codigoSap, params.matricula],
    );
    const divergenciasFechadas = rowsOf(resolvidas).length;

    if (divergenciasFechadas > 0) {
      await insertAuditLogWith(client, {
        tipo: 'REPOSICAO',
        usuarioId: params.usuarioId,
        matricula: params.matricula,
        depositoId: params.depositoId,
        entidade: 'divergences',
        operacaoId: params.operationId,
        estadoAnterior: { codigoSap: params.codigoSap, status: 'ABERTA' },
        estadoPosterior: { codigoSap: params.codigoSap, status: 'RESOLVIDA', quantidade: divergenciasFechadas },
        origem: params.origem,
        dispositivo: params.dispositivo,
      });
    }

    await client.query(
      `INSERT INTO processed_operations (operation_id, entidade, acao, payload_hash, processado_em, resultado)
       VALUES ($1,'goldbox_movements','ENTRADA',$2,now(),$3::jsonb)`,
      [
        params.operationId,
        sha256Hex(JSON.stringify({ operationId: params.operationId, codigoSap: params.codigoSap, quantidade: params.quantidade })),
        JSON.stringify({
          id: movimentoId,
          codigoSap: params.codigoSap,
          quantidade: params.quantidade,
          saldo: novoSaldo,
        }),
      ],
    );

    await insertAuditLogWith(client, {
      tipo: 'ENTRADA_MATERIAL',
      usuarioId: params.usuarioId,
      matricula: params.matricula,
      depositoId: params.depositoId,
      entidade: 'goldbox_movements',
      operacaoId: params.operationId,
      estadoPosterior: {
        codigoSap: params.codigoSap,
        quantidade: params.quantidade,
        saldo: novoSaldo,
        divergenciasFechadas,
      },
      motivo: params.observacao,
      origem: params.origem,
      dispositivo: params.dispositivo,
    });

    const movimento = (await findByOperationIdRaw(client, params.operationId))!;
    return {
      jaProcessada: false,
      movimento: mapGoldboxMovimento(movimento),
      saldo: novoSaldo,
      divergenciasFechadas,
    };
  });
}

export interface ObservacaoEstorno {
  jaProcessada: boolean;
  movimento: GoldboxMovementRow;
  saldo: number;
}

export async function aplicarEstorno(params: {
  depositoId: string;
  perfil: string;
  usuarioId: string;
  matricula: string;
  nomeCompleto: string;
  operationId: string;
  operationIdOriginal: string;
  motivo: string;
  origem: 'ONLINE' | 'OFFLINE';
  dispositivo: string;
  assinaturaMatricula: string;
}): Promise<ObservacaoEstorno> {
  return withDepositoContext(params.depositoId, params.perfil, async (client) => {
    const dup = await client.query(
      'SELECT resultado FROM processed_operations WHERE operation_id = $1',
      [params.operationId],
    );
    const dupRow = rowsOf(dup)[0];
    if (dupRow) {
      const mov = await findByOperationId(client, params.operationId);
      return {
        jaProcessada: true,
        movimento: mov ?? (dupRow.resultado as unknown as GoldboxMovementRow),
        saldo: 0,
      };
    }

    const jaEstornado = await client.query(
      'SELECT 1 FROM goldbox_movements WHERE deposito_id = $1 AND estorno_de = $2 LIMIT 1',
      [params.depositoId, params.operationIdOriginal],
    );
    if (rowsOf(jaEstornado)[0]) {
      throw new AppError('CONFLITO', 'Movimento já estornado', 409);
    }

    const orig = await client.query(
      'SELECT * FROM goldbox_movements WHERE operation_id = $1 AND deposito_id = $2',
      [params.operationIdOriginal, params.depositoId],
    );
    const origRow = rowsOf(orig)[0];
    if (!origRow) throw new AppError('NAO_ENCONTRADO', 'Movimento original não encontrado', 404);
    if (origRow.estorno_de) {
      throw new AppError('OPERACAO_NEGADA', 'Não é possível estornar um estorno', 409);
    }

    const dep = await client.query('SELECT id, status, versao_atual_enxoval FROM deposits WHERE id = $1', [
      params.depositoId,
    ]);
    const depRow = rowsOf(dep)[0];
    if (!depRow) throw new AppError('NAO_ENCONTRADO', 'Depósito não encontrado', 404);
    if (depRow.status === 'INATIVO') {
      throw new AppError('OPERACAO_NEGADA', 'Depósito inativo não aceita estornos', 409);
    }

    const itRes = await client.query(
      `SELECT id, qtd_atual FROM inventory_items
       WHERE deposito_id = $1 AND codigo_sap = $2 AND versao = $3 FOR UPDATE`,
      [params.depositoId, origRow.codigo_sap, depRow.versao_atual_enxoval ?? null],
    );
    const item = rowsOf(itRes)[0];

    const quantidadeOriginal = Number(origRow.quantidade);
    const quantidadeEstorno = -quantidadeOriginal;
    const novoSaldo = item ? Number(item.qtd_atual) - quantidadeEstorno : 0;

    const movimentoId = newId();
    await client.query(
      `INSERT INTO goldbox_movements
        (id, operation_id, deposito_id, codigo_sap, material_id, descricao, quantidade,
         data_hora, usuario_id, nome_completo, matricula, reposicao, origem, dispositivo,
         status_sync, assinatura_matricula, estorno_de, criado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,now(),$8,$9,$10,false,$11,$12,'ENVIADO',$13,$14,now())`,
      [
        movimentoId,
        params.operationId,
        params.depositoId,
        origRow.codigo_sap,
        origRow.material_id,
        origRow.descricao,
        quantidadeEstorno,
        params.usuarioId,
        params.nomeCompleto,
        params.matricula,
        params.origem,
        params.dispositivo,
        params.assinaturaMatricula,
        params.operationIdOriginal,
      ],
    );

    if (item) {
      await client.query('UPDATE inventory_items SET qtd_atual = $2, atualizado_em = now() WHERE id = $1', [
        item.id,
        novoSaldo,
      ]);
    }

    await client.query(
      `INSERT INTO processed_operations (operation_id, entidade, acao, payload_hash, processado_em, resultado)
       VALUES ($1,'goldbox_movements','ESTORNO',$2,now(),$3::jsonb)`,
      [
        params.operationId,
        sha256Hex(JSON.stringify({ operationId: params.operationId, operationIdOriginal: params.operationIdOriginal })),
        JSON.stringify({ id: movimentoId, estornoDe: params.operationIdOriginal, saldo: novoSaldo }),
      ],
    );

    await insertAuditLogWith(client, {
      tipo: 'ESTORNO',
      usuarioId: params.usuarioId,
      matricula: params.matricula,
      depositoId: params.depositoId,
      entidade: 'goldbox_movements',
      operacaoId: params.operationId,
      estadoAnterior: { operationId: params.operationIdOriginal, quantidade: quantidadeOriginal },
      estadoPosterior: { quantidade: quantidadeEstorno, saldo: novoSaldo },
      motivo: params.motivo,
      origem: params.origem,
      dispositivo: params.dispositivo,
    });

    const movimento = (await findByOperationIdRaw(client, params.operationId))!;
    return { jaProcessada: false, movimento: mapGoldboxMovimento(movimento), saldo: novoSaldo };
  });
}

async function findByOperationIdRaw(client: Client, operationId: string): Promise<Record<string, unknown> | undefined> {
  const res = await client.query(
    'SELECT * FROM goldbox_movements WHERE operation_id = $1',
    [operationId],
  );
  return rowsOf(res)[0];
}

async function findByOperationId(client: Client, operationId: string): Promise<GoldboxMovementRow | undefined> {
  const row = await findByOperationIdRaw(client, operationId);
  return row ? mapGoldboxMovimento(row) : undefined;
}

export interface GoldboxFilter {
  dataIni?: string;
  dataFim?: string;
  codigoSap?: string;
  usuario?: string;
  reposicao?: boolean;
  tipo?: 'BAIXA' | 'ESTORNO' | 'ENTRADA';
}

export async function listGoldbox(
  depositoId: string,
  perfil: string,
  filtro: GoldboxFilter,
): Promise<GoldboxMovementRow[]> {
  return withDepositoContext(depositoId, perfil, async (client) => {
    const where: string[] = [];
    const values: unknown[] = [];
    const bind = (v: unknown): string => {
      values.push(v);
      return `$${values.length}`;
    };
    where.push(`deposito_id = ${bind(depositoId)}`);
    if (filtro.dataIni) where.push(`data_hora >= ${bind(new Date(filtro.dataIni).toISOString())}`);
    if (filtro.dataFim) where.push(`data_hora <= ${bind(new Date(filtro.dataFim).toISOString())}`);
    if (filtro.codigoSap) where.push(`codigo_sap = ${bind(filtro.codigoSap)}`);
    if (filtro.usuario) where.push(`matricula = ${bind(filtro.usuario)}`);
    if (filtro.reposicao !== undefined) where.push(`reposicao = ${bind(filtro.reposicao)}`);
    if (filtro.tipo === 'ESTORNO') where.push('estorno_de IS NOT NULL');
    if (filtro.tipo === 'ENTRADA') where.push(`tipo = 'ENTRADA'`);
    if (filtro.tipo === 'BAIXA') where.push(`tipo <> 'ENTRADA' AND estorno_de IS NULL`);

    const res = await client.query(
      `SELECT * FROM goldbox_movements WHERE ${where.join(' AND ')} ORDER BY data_hora DESC LIMIT 500`,
      values,
    );
    return rowsOf(res).map(mapGoldboxMovimento);
  });
}