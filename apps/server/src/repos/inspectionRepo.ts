import {
  InspectionItemRow,
  InspectionRow,
  InspectionItemStatus,
  TipoCorrecao,
} from '@logenxoval/contracts';
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

function mapInspecao(row: Record<string, unknown>): InspectionRow {
  return {
    id: row.id as string,
    depositoId: row.deposito_id as string,
    versaoEnxoval: row.versao_enxoval as string,
    autorId: row.autor_id as string,
    matricula: row.matricula as string,
    dataEm: (row.data_em as Date).toISOString(),
    hora: row.hora as string,
    status: row.status as InspectionRow['status'],
    observacao: (row.observacao as string | null) ?? undefined,
    tipoCorrecao: (row.tipo_correcao as TipoCorrecao | null) ?? undefined,
    revisaoDe: (row.revisao_de as string | null) ?? undefined,
  };
}

function mapItem(row: Record<string, unknown>): InspectionItemRow {
  const ultima = row.ultima_baixa_goldbox as
    | { operationId?: string; dataHora?: string; quantidade?: number }
    | null
    | undefined;
  return {
    id: row.id as string,
    inspectionId: row.inspection_id as string,
    depositoId: row.deposito_id as string,
    codigoSap: row.codigo_sap as string,
    materialId: (row.material_id as string | null) ?? undefined,
    qtdSistema: Number(row.qtd_sistema),
    qtdFisica: Number(row.qtd_fisica),
    diferenca: Number(row.diferenca),
    status: row.status as InspectionItemStatus,
    observacao: (row.observacao as string | null) ?? undefined,
    ultimaBaixaGoldbox: ultima
      ? {
          operationId: ultima.operationId ?? '',
          dataHora: ultima.dataHora ?? '',
          quantidade: ultima.quantidade ?? 0,
        }
      : undefined,
    reposicaoPosterior: Boolean(row.reposicao_posterior),
    reposicaoPendente: Boolean(row.reposicao_pendente),
    corregido: Boolean(row.corregido),
    correcaoRef: (row.correcao_ref as string | null) ?? undefined,
  };
}

interface ItemInput {
  codigoSap: string;
  qtdFisica: number;
  observacao?: string;
}

function itemStatus(diferenca: number): InspectionItemStatus {
  if (diferenca === 0) return 'OK';
  return 'DIVERGENTE';
}

async function contextoDeDeposito(
  client: Client,
  depositoId: string,
): Promise<{ versaoAtual: string | null; status: string }> {
  const dep = await client.query('SELECT id, status, versao_atual_enxoval FROM deposits WHERE id = $1', [
    depositoId,
  ]);
  const row = rowsOf(dep)[0];
  if (!row) throw new AppError('NAO_ENCONTRADO', 'Depósito não encontrado', 404);
  return { versaoAtual: (row.versao_atual_enxoval as string) ?? null, status: row.status as string };
}

async function materialDoItem(
  client: Client,
  depositoId: string,
  codigoSap: string,
  versao: string | null,
): Promise<string | undefined> {
  const res = await client.query(
    `SELECT material_id FROM inventory_items
     WHERE deposito_id = $1 AND codigo_sap = $2 AND versao = $3 LIMIT 1`,
    [depositoId, codigoSap, versao],
  );
  const row = rowsOf(res)[0];
  return (row?.material_id as string | undefined) ?? undefined;
}

async function anexarContextoDeBaixas(
  client: Client,
  depositoId: string,
  itens: ItemInput[],
  saps: string[],
): Promise<Map<string, { ultima: { operationId: string; dataHora: string; quantidade: number }; reposicaoPosterior: boolean }>> {
  const map = new Map<
    string,
    { ultima: { operationId: string; dataHora: string; quantidade: number }; reposicaoPosterior: boolean }
  >();
  if (!saps.length) return map;

  const mov = await client.query(
    `SELECT codigo_sap, operation_id, data_hora, quantidade, reposicao FROM goldbox_movements
     WHERE deposito_id = $1 AND codigo_sap = ANY($2) AND estorno_de IS NULL
     ORDER BY data_hora ASC`,
    [depositoId, saps],
  );
  const porSap = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rowsOf(mov)) {
    const sap = row.codigo_sap as string;
    if (!porSap.has(sap)) porSap.set(sap, []);
    porSap.get(sap)!.push(row);
  }
  for (const [sap, lista] of porSap) {
    if (!lista.length) continue;
    const ultima = lista[lista.length - 1];
    const reposicaoPosterior = lista.some((m) => Boolean(m.reposicao) && (m.data_hora as Date) >= (ultima.data_hora as Date));
    map.set(sap, {
      ultima: {
        operationId: ultima.operation_id as string,
        dataHora: (ultima.data_hora as Date).toISOString(),
        quantidade: Number(ultima.quantidade),
      },
      reposicaoPosterior,
    });
  }
  return map;
}

async function reposicoesPendentes(client: Client, depositoId: string, saps: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  if (!saps.length) return set;
  const res = await client.query(
    `SELECT DISTINCT codigo_sap FROM divergences
     WHERE deposito_id = $1 AND tipo = 'REPOSICAO' AND status = 'ABERTA' AND codigo_sap = ANY($2)`,
    [depositoId, saps],
  );
  for (const row of rowsOf(res)) set.add(row.codigo_sap as string);
  return set;
}

export interface InspecaoCriada {
  inspecao: InspectionRow;
  itens: InspectionItemRow[];
}

export async function criarConferencia(params: {
  depositoId: string;
  perfil: string;
  usuarioId: string;
  matricula: string;
  hora: string;
  observacao?: string;
  itens: ItemInput[];
  assinaturaMatricula: string;
  origem: 'ONLINE' | 'OFFLINE';
  dispositivo: string;
}): Promise<InspecaoCriada> {
  return withDepositoContext(params.depositoId, params.perfil, async (client) => {
    const dep = await contextoDeDeposito(client, params.depositoId);
    if (dep.status === 'INATIVO') {
      throw new AppError('OPERACAO_NEGADA', 'Depósito inativo não aceita conferências', 409);
    }
    const versao = dep.versaoAtual;
    const saps = [...new Set(params.itens.map((i) => i.codigoSap))];
    const baixas = await anexarContextoDeBaixas(client, params.depositoId, params.itens, saps);
    const pendentes = await reposicoesPendentes(client, params.depositoId, saps);

    const inspecaoId = newId();
    await client.query(
      `INSERT INTO inspections
        (id, deposito_id, versao_enxoval, autor_id, matricula, data_em, hora, status, observacao)
       VALUES ($1,$2,$3,$4,$5,now(),$6,'EM_ANDAMENTO',$7)`,
      [inspecaoId, params.depositoId, versao, params.usuarioId, params.matricula, params.hora, params.observacao ?? null],
    );

    for (const item of params.itens) {
      const qtdRes = await client.query(
        `SELECT qtd_atual FROM inventory_items
         WHERE deposito_id = $1 AND codigo_sap = $2 AND versao = $3 LIMIT 1`,
        [params.depositoId, item.codigoSap, versao],
      );
      const qtdSistema = Number(rowsOf(qtdRes)[0]?.qtd_atual ?? 0);
      const diferenca = item.qtdFisica - qtdSistema;
      const ctx = baixas.get(item.codigoSap);
      const materialId = await materialDoItem(client, params.depositoId, item.codigoSap, versao);
      const itemId = newId();
      await client.query(
        `INSERT INTO inspection_items
          (id, inspection_id, deposito_id, codigo_sap, material_id, qtd_sistema, qtd_fisica,
           diferenca, status, observacao, ultima_baixa_goldbox, reposicao_posterior,
           reposicao_pendente, corregido)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,false)`,
        [
          itemId,
          inspecaoId,
          params.depositoId,
          item.codigoSap,
          materialId ?? null,
          qtdSistema,
          item.qtdFisica,
          diferenca,
          itemStatus(diferenca),
          item.observacao ?? null,
          ctx ? JSON.stringify(ctx.ultima) : null,
          Boolean(ctx?.reposicaoPosterior),
          pendentes.has(item.codigoSap),
        ],
      );
    }

    await insertAuditLogWith(client, {
      tipo: 'CONFERENCIA',
      usuarioId: params.usuarioId,
      matricula: params.matricula,
      depositoId: params.depositoId,
      entidade: 'inspections',
      operacaoId: inspecaoId,
      estadoPosterior: { itens: params.itens.length, assinatura: params.assinaturaMatricula },
      origem: params.origem,
      dispositivo: params.dispositivo,
    });

    const inspecao = await detalheComClient(client, params.depositoId, inspecaoId);
    return { inspecao: inspecao.inspecao, itens: inspecao.itens };
  });
}

export async function listarConferencias(
  depositoId: string,
  perfil: string,
): Promise<Array<InspectionRow & { totalItens: number; divergentes: number }>> {
  return withDepositoContext(depositoId, perfil, async (client) => {
    const res = await client.query(
      `SELECT i.*, COUNT(it.id) AS total_itens,
              COUNT(it.id) FILTER (WHERE it.status = 'DIVERGENTE') AS divergentes
       FROM inspections i
       LEFT JOIN inspection_items it ON it.inspection_id = i.id
       WHERE i.deposito_id = $1
       GROUP BY i.id
       ORDER BY i.data_em DESC
       LIMIT 200`,
      [depositoId],
    );
    return rowsOf(res).map((row) => ({
      ...mapInspecao(row),
      totalItens: Number(row.total_itens),
      divergentes: Number(row.divergentes),
    }));
  });
}

async function buscarConferenciaRaw(client: Client, depositoId: string, inspecaoId: string) {
  const res = await client.query(
    'SELECT * FROM inspections WHERE id = $1 AND deposito_id = $2',
    [inspecaoId, depositoId],
  );
  const row = rowsOf(res)[0];
  if (!row) throw new AppError('NAO_ENCONTRADO', 'Conferência não encontrada', 404);
  return row;
}

async function detalheComClient(
  client: Client,
  depositoId: string,
  inspecaoId: string,
): Promise<ConferenciaDetalhe> {
  const raw = await buscarConferenciaRaw(client, depositoId, inspecaoId);
  return {
    inspecao: mapInspecao(raw),
    itens: await itensDaInspecao(client, depositoId, inspecaoId),
  };
}

export interface ConferenciaDetalhe {
  inspecao: InspectionRow;
  itens: Array<InspectionItemRow & { sparePartDisponivel?: number }>;
}

async function itensDaInspecao(
  client: Client,
  depositoId: string,
  inspecaoId: string,
): Promise<Array<InspectionItemRow & { sparePartDisponivel?: number }>> {
  const res = await client.query(
    'SELECT * FROM inspection_items WHERE inspection_id = $1 AND deposito_id = $2 ORDER BY codigo_sap',
    [inspecaoId, depositoId],
  );
  const rows = rowsOf(res);
  const saps = [...new Set(rows.map((r) => r.codigo_sap as string))];
  const disponiveis = new Map<string, number>();
  if (saps.length) {
    const sp = await client.query(
      `SELECT codigo_sap, SUM(quantidade_atual) AS disp FROM spare_parts
       WHERE deposito_id = $1 AND status = 'ATIVO' AND codigo_sap = ANY($2)
       GROUP BY codigo_sap`,
      [depositoId, saps],
    );
    for (const row of rowsOf(sp)) disponiveis.set(row.codigo_sap as string, Number(row.disp));
  }
  return rows.map((row) => {
    const item = mapItem(row);
    if (disponiveis.has(item.codigoSap)) {
      return { ...item, sparePartDisponivel: disponiveis.get(item.codigoSap) };
    }
    return item;
  });
}

export async function buscarConferencia(
  depositoId: string,
  perfil: string,
  inspecaoId: string,
): Promise<ConferenciaDetalhe> {
  return withDepositoContext(depositoId, perfil, async (client) => {
    return detalheComClient(client, depositoId, inspecaoId);
  });
}

export async function finalizarConferencia(params: {
  depositoId: string;
  perfil: string;
  usuarioId: string;
  matricula: string;
  inspecaoId: string;
  observacao?: string;
  assinaturaMatricula: string;
  origem: 'ONLINE' | 'OFFLINE';
  dispositivo: string;
}): Promise<ConferenciaDetalhe> {
  return withDepositoContext(params.depositoId, params.perfil, async (client) => {
    const raw = await buscarConferenciaRaw(client, params.depositoId, params.inspecaoId);
    if (raw.status !== 'EM_ANDAMENTO') {
      throw new AppError('CONFLITO', 'Conferência já finalizada ou revisada', 409);
    }
    await client.query(
      'UPDATE inspections SET status = $2, observacao = COALESCE($3, observacao) WHERE id = $1',
      [params.inspecaoId, 'CONCLUIDA', params.observacao ?? null],
    );
    const itensRes = await client.query(
      `SELECT * FROM inspection_items WHERE inspection_id = $1 AND deposito_id = $2 AND diferenca <> 0`,
      [params.inspecaoId, params.depositoId],
    );
    for (const item of rowsOf(itensRes)) {
      const dup = await client.query(
        `SELECT 1 FROM divergences WHERE deposito_id = $1 AND codigo_sap = $2 AND tipo = 'CONFERENCIA' AND status = 'ABERTA' LIMIT 1`,
        [params.depositoId, item.codigo_sap],
      );
      if (rowsOf(dup)[0]) continue;
      await client.query(
        `INSERT INTO divergences
          (id, deposito_id, codigo_sap, tipo, quantidade, status, inspecao_id, criado_em, criado_por)
         VALUES ($1,$2,$3,'CONFERENCIA',$4,'ABERTA',$5,now(),$6)`,
        [newId(), params.depositoId, item.codigo_sap, Number(item.diferenca), params.inspecaoId, params.matricula],
      );
    }
    await insertAuditLogWith(client, {
      tipo: 'CONFERENCIA',
      usuarioId: params.usuarioId,
      matricula: params.matricula,
      depositoId: params.depositoId,
      entidade: 'inspections',
      operacaoId: params.inspecaoId,
      estadoPosterior: { status: 'CONCLUIDA' },
      origem: params.origem,
      dispositivo: params.dispositivo,
    });
    return detalheComClient(client, params.depositoId, params.inspecaoId);
  });
}

export async function criarRevisao(params: {
  depositoId: string;
  perfil: string;
  usuarioId: string;
  matricula: string;
  inspecaoId: string;
  hora: string;
  observacao?: string;
  itens: ItemInput[];
  assinaturaMatricula: string;
  origem: 'ONLINE' | 'OFFLINE';
  dispositivo: string;
}): Promise<InspecaoCriada> {
  return withDepositoContext(params.depositoId, params.perfil, async (client) => {
    await buscarConferenciaRaw(client, params.depositoId, params.inspecaoId);
    const revisao = await criarConferencia({
      depositoId: params.depositoId,
      perfil: params.perfil,
      usuarioId: params.usuarioId,
      matricula: params.matricula,
      hora: params.hora,
      observacao: params.observacao,
      itens: params.itens,
      assinaturaMatricula: params.assinaturaMatricula,
      origem: params.origem,
      dispositivo: params.dispositivo,
    });
    await client.query('UPDATE inspections SET status = $2, revisao_de = $3 WHERE id = $1', [
      revisao.inspecao.id,
      'REVISADA',
      params.inspecaoId,
    ]);
    const det = await detalheComClient(client, params.depositoId, revisao.inspecao.id);
    return { inspecao: det.inspecao, itens: det.itens };
  });
}

export interface CorrecaoAplicada {
  item: InspectionItemRow & { sparePartDisponivel?: number };
  saldo: number;
  sparePartMovimento?: Record<string, unknown>;
}

export async function aplicarCorrecao(params: {
  depositoId: string;
  perfil: string;
  usuarioId: string;
  matricula: string;
  inspecaoId: string;
  itemId: string;
  tipo: TipoCorrecao;
  sparePartId?: string;
  quantidade?: number;
  observacao?: string;
  operationId: string;
  assinaturaMatricula: string;
  origem: 'ONLINE' | 'OFFLINE';
  dispositivo: string;
}): Promise<CorrecaoAplicada> {
  return withDepositoContext(params.depositoId, params.perfil, async (client) => {
    const inspecaoRaw = await buscarConferenciaRaw(client, params.depositoId, params.inspecaoId);
    if (inspecaoRaw.status === 'REVISADA') {
      throw new AppError('OPERACAO_NEGADA', 'Conferência revisada não aceita correções', 409);
    }
    const itemRes = await client.query(
      'SELECT * FROM inspection_items WHERE id = $1 AND inspection_id = $2 AND deposito_id = $3',
      [params.itemId, params.inspecaoId, params.depositoId],
    );
    const itemRaw = rowsOf(itemRes)[0];
    if (!itemRaw) throw new AppError('NAO_ENCONTRADO', 'Item da conferência não encontrado', 404);

    const dup = await client.query('SELECT 1 FROM processed_operations WHERE operation_id = $1', [
      params.operationId,
    ]);
    if (rowsOf(dup)[0]) {
      const detalhe = await detalheComClient(client, params.depositoId, params.inspecaoId);
      const item = detalhe.itens.find((i) => i.id === params.itemId)!;
      return { item, saldo: Number(item.qtdSistema), sparePartMovimento: undefined };
    }

    if (Boolean(itemRaw.corregido)) {
      throw new AppError('CONFLITO', 'Item já corrigido nesta conferência', 409);
    }

    const dep = await contextoDeDeposito(client, params.depositoId);
    const codigoSap = itemRaw.codigo_sap as string;
    const versao = dep.versaoAtual;
    let novoSaldo = Number(itemRaw.qtd_sistema);
    let spareMovimento: Record<string, unknown> | undefined;

    if (params.tipo === 'CORRIGIR_COM_PECA_AVULSA') {
      if (!params.sparePartId || params.quantidade === undefined) {
        throw new AppError('VALIDATION_FAILED', 'sparePartId e quantidade obrigatórios para CORRIGIR_COM_PECA_AVULSA', 400);
      }
      const spRes = await client.query(
        'SELECT * FROM spare_parts WHERE id = $1 AND deposito_id = $2 AND status = $3 FOR UPDATE',
        [params.sparePartId, params.depositoId, 'ATIVO'],
      );
      const spRaw = rowsOf(spRes)[0];
      if (!spRaw) throw new AppError('NAO_ENCONTRADO', 'Peça avulsa não encontrada no depósito', 404);
      if ((spRaw.codigo_sap as string) !== codigoSap) {
        throw new AppError('INCOMPATIVEL', 'Código SAP da peça avulsa difere do item conferido', 409);
      }
      const quantidadeAtual = Number(spRaw.quantidade_atual);
      if (quantidadeAtual < params.quantidade) {
        throw new AppError('ITEM_INDISPONIVEL', `Peça avulsa disponível: ${quantidadeAtual}`, 409);
      }
      const saldoAnterior = quantidadeAtual;
      const saldoPosterior = saldoAnterior - params.quantidade;
      await client.query('UPDATE spare_parts SET quantidade_atual = $2 WHERE id = $1', [
        spRaw.id,
        saldoPosterior,
      ]);
      const movId = newId();
      await client.query(
        `INSERT INTO spare_part_movements
          (id, deposito_id, spare_part_id, operation_id, tipo, quantidade, data_hora,
           usuario_id, matricula, motivo, estado_anterior, estado_posterior)
         VALUES ($1,$2,$3,$4,'USO_CORRECAO',$5,now(),$6,$7,$8,$9::jsonb,$10::jsonb)`,
        [
          movId,
          params.depositoId,
          spRaw.id,
          params.operationId,
          params.quantidade,
          params.usuarioId,
          params.matricula,
          params.observacao ?? 'Correção de conferência',
          JSON.stringify({ quantidade: saldoAnterior }),
          JSON.stringify({ quantidade: saldoPosterior }),
        ],
      );
      spareMovimento = { id: movId, sparePartId: spRaw.id, quantidade: params.quantidade };

      const itRes = await client.query(
        `SELECT id, qtd_atual FROM inventory_items
         WHERE deposito_id = $1 AND codigo_sap = $2 AND versao = $3 FOR UPDATE`,
        [params.depositoId, codigoSap, versao],
      );
      const itRaw = rowsOf(itRes)[0];
      if (!itRaw) throw new AppError('ITEM_INDISPONIVEL', 'Item não encontrado no enxoval da versão atual', 404);
      novoSaldo = Number(itRaw.qtd_atual) + params.quantidade;
      await client.query('UPDATE inventory_items SET qtd_atual = $2, atualizado_em = now() WHERE id = $1', [
        itRaw.id,
        novoSaldo,
      ]);
    } else if (params.tipo === 'ACAO_LIDERANCA') {
      const delta = Number(itemRaw.qtd_fisica) - Number(itemRaw.qtd_sistema);
      const itRes = await client.query(
        `SELECT id, qtd_atual FROM inventory_items
         WHERE deposito_id = $1 AND codigo_sap = $2 AND versao = $3 FOR UPDATE`,
        [params.depositoId, codigoSap, versao],
      );
      const itRaw = rowsOf(itRes)[0];
      if (!itRaw) throw new AppError('ITEM_INDISPONIVEL', 'Item não encontrado no enxoval da versão atual', 404);
      novoSaldo = Number(itRaw.qtd_atual) + delta;
      await client.query('UPDATE inventory_items SET qtd_atual = $2, atualizado_em = now() WHERE id = $1', [
        itRaw.id,
        novoSaldo,
      ]);
    } else if (params.tipo === 'AGUARDAR_REPOSICAO') {
      const dup = await client.query(
        `SELECT 1 FROM divergences WHERE deposito_id = $1 AND codigo_sap = $2 AND tipo = 'REPOSICAO' AND status = 'ABERTA' LIMIT 1`,
        [params.depositoId, codigoSap],
      );
      if (!rowsOf(dup)[0]) {
        await client.query(
          `INSERT INTO divergences
            (id, deposito_id, codigo_sap, tipo, quantidade, status, inspecao_id, criado_em, criado_por)
           VALUES ($1,$2,$3,'REPOSICAO',0,'ABERTA',$4,now(),$5)`,
          [newId(), params.depositoId, codigoSap, params.inspecaoId, params.matricula],
        );
      }
      await client.query('UPDATE inspection_items SET observacao = COALESCE($2, observacao) WHERE id = $1', [
        params.itemId,
        params.observacao ?? null,
      ]);
    }

    const complemento = params.tipo === 'CORRIGIR_COM_PECA_AVULSA' || params.tipo === 'ACAO_LIDERANCA';
    if (complemento) {
      await client.query(
        `UPDATE inspection_items SET corregido = true, correcao_ref = $2, observacao = COALESCE($3, observacao) WHERE id = $1`,
        [params.itemId, params.operationId, params.observacao ?? null],
      );
    }

    await insertAuditLogWith(client, {
      tipo: 'CORRECAO',
      usuarioId: params.usuarioId,
      matricula: params.matricula,
      depositoId: params.depositoId,
      entidade: 'inspection_items',
      operacaoId: params.operationId,
      estadoAnterior: { codigoSap, qtdSistema: Number(itemRaw.qtd_sistema) },
      estadoPosterior: {
        codigoSap,
        tipo: params.tipo,
        quantidade: params.quantidade,
        saldo: novoSaldo,
        assinatura: params.assinaturaMatricula,
      },
      motivo: params.observacao,
      origem: params.origem,
      dispositivo: params.dispositivo,
    });

    await client.query(
      `INSERT INTO processed_operations (operation_id, entidade, acao, payload_hash, processado_em, resultado)
       VALUES ($1,'inspection_items','CORRECAO',$2,now(),$3::jsonb)`,
      [
        params.operationId,
        sha256Hex(JSON.stringify({ operationId: params.operationId, tipo: params.tipo, codigoSap })),
        JSON.stringify({ itemId: params.itemId, tipo: params.tipo, saldo: novoSaldo }),
      ],
    );

    const detalhe = await detalheComClient(client, params.depositoId, params.inspecaoId);
    const item = detalhe.itens.find((i) => i.id === params.itemId)!;
    return { item, saldo: novoSaldo, sparePartMovimento: spareMovimento };
  });
}

export async function reverterCorrecao(params: {
  depositoId: string;
  perfil: string;
  usuarioId: string;
  matricula: string;
  inspecaoId: string;
  itemId: string;
  motivo: string;
  operationId: string;
  assinaturaMatricula: string;
  origem: 'ONLINE' | 'OFFLINE';
  dispositivo: string;
}): Promise<ConferenciaDetalhe> {
  return withDepositoContext(params.depositoId, params.perfil, async (client) => {
    await buscarConferenciaRaw(client, params.depositoId, params.inspecaoId);
    const itemRes = await client.query(
      'SELECT * FROM inspection_items WHERE id = $1 AND inspection_id = $2 AND deposito_id = $3',
      [params.itemId, params.inspecaoId, params.depositoId],
    );
    const itemRaw = rowsOf(itemRes)[0];
    if (!itemRaw) throw new AppError('NAO_ENCONTRADO', 'Item da conferência não encontrado', 404);
    const correcaoRef = itemRaw.correcao_ref as string | null;
    if (!correcaoRef || !Boolean(itemRaw.corregido)) {
      throw new AppError('CONFLITO', 'Item sem correção a estornar', 409);
    }

    const dup = await client.query('SELECT 1 FROM processed_operations WHERE operation_id = $1', [
      params.operationId,
    ]);
    if (rowsOf(dup)[0]) {
      return detalheComClient(client, params.depositoId, params.inspecaoId);
    }

    const movRes = await client.query(
      `SELECT * FROM spare_part_movements WHERE operation_id = $1 AND deposito_id = $2 AND tipo = 'USO_CORRECAO'`,
      [correcaoRef, params.depositoId],
    );
    const movRaw = rowsOf(movRes)[0];
    if (!movRaw) {
      throw new AppError('OPERACAO_NEGADA', 'Estorno suportado apenas para correção com peça avulsa', 409);
    }
    const quantidade = Number(movRaw.quantidade);
    const spareId = movRaw.spare_part_id as string;

    const spRes = await client.query('SELECT * FROM spare_parts WHERE id = $1 AND deposito_id = $2 FOR UPDATE', [
      spareId,
      params.depositoId,
    ]);
    const spRaw = rowsOf(spRes)[0];
    if (!spRaw) throw new AppError('NAO_ENCONTRADO', 'Peça avulsa não encontrada', 404);
    const spAnterior = Number(spRaw.quantidade_atual);
    await client.query('UPDATE spare_parts SET quantidade_atual = $2 WHERE id = $1', [spRaw.id, spAnterior + quantidade]);
    await client.query(
      `INSERT INTO spare_part_movements
        (id, deposito_id, spare_part_id, operation_id, tipo, quantidade, data_hora,
         usuario_id, matricula, motivo, estado_anterior, estado_posterior)
       VALUES ($1,$2,$3,$4,'DEVOLUCAO_CORRECAO',$5,now(),$6,$7,$8,$9::jsonb,$10::jsonb)`,
      [
        newId(),
        params.depositoId,
        spRaw.id,
        params.operationId,
        quantidade,
        params.usuarioId,
        params.matricula,
        `Estorno de correção ${correcaoRef}: ${params.motivo}`,
        JSON.stringify({ quantidade: spAnterior }),
        JSON.stringify({ quantidade: spAnterior + quantidade }),
      ],
    );

    const dep = await contextoDeDeposito(client, params.depositoId);
    const itRes = await client.query(
      `SELECT id, qtd_atual FROM inventory_items
       WHERE deposito_id = $1 AND codigo_sap = $2 AND versao = $3 FOR UPDATE`,
      [params.depositoId, itemRaw.codigo_sap as string, dep.versaoAtual],
    );
    const itRaw = rowsOf(itRes)[0];
    if (itRaw) {
      const saldo = Number(itRaw.qtd_atual) - quantidade;
      await client.query('UPDATE inventory_items SET qtd_atual = $2, atualizado_em = now() WHERE id = $1', [
        itRaw.id,
        saldo,
      ]);
    }

    await client.query('UPDATE inspection_items SET corregido = false, correcao_ref = NULL WHERE id = $1', [
      params.itemId,
    ]);

    await insertAuditLogWith(client, {
      tipo: 'ESTORNO',
      usuarioId: params.usuarioId,
      matricula: params.matricula,
      depositoId: params.depositoId,
      entidade: 'inspection_items',
      operacaoId: params.operationId,
      estadoAnterior: { correcaoRef, codigoSap: itemRaw.codigo_sap as string },
      estadoPosterior: { corregido: false, devolvidoPecaAvulsa: quantidade, assinatura: params.assinaturaMatricula },
      motivo: params.motivo,
      origem: params.origem,
      dispositivo: params.dispositivo,
    });

    return detalheComClient(client, params.depositoId, params.inspecaoId);
  });
}