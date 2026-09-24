import type { ConversionSuggestionRow } from '@logenxoval/contracts';
import { withDepositoContext } from '../db/pool';
import { newId, sha256Hex } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { insertAuditLogWith, type Queryable } from './auditLogRepo';

type Client = Queryable;

function rowsOf(res: unknown): Array<Record<string, unknown>> {
  return (res as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

function mapSugestao(row: Record<string, unknown>): ConversionSuggestionRow {
  return {
    id: row.id as string,
    depositoId: row.deposito_id as string,
    codigoSap: row.codigo_sap as string,
    descricao: row.descricao as string,
    qtdDisponivelPecas: Number(row.qtd_disponivel_pecas),
    qtdPrevistaLista: Number(row.qtd_prevista_lista),
    qtdSugerida: Number(row.qtd_sugerida),
    status: row.status as ConversionSuggestionRow['status'],
    motivo: (row.motivo as string | null) ?? undefined,
    criadoPor: row.criado_por as string,
    versaoEnxoval: row.versao_enxoval as string,
    processadaOperationId: (row.processada_operation_id as string | null) ?? undefined,
  };
}

interface GerarParams {
  depositoId: string;
  perfil: string;
  usuarioId: string;
  matricula: string;
  origemMov: 'ONLINE' | 'OFFLINE';
  dispositivo: string;
}

/**
 * Gera sugestões de conversão (peça avulsa → enxoval) quando há peça disponível
 * para um SAP com saldo abaixo do previsto na lista, e não existe sugestão PENDENTE.
 * Retorna todas as sugestões do depósito.
 */
export async function gerarEListarSugestoes(params: GerarParams): Promise<ConversionSuggestionRow[]> {
  return withDepositoContext(params.depositoId, params.perfil, async (client) => {
    const dep = (await client.query('SELECT versao_atual_enxoval FROM deposits WHERE id = $1', [
      params.depositoId,
    ])) as unknown;
    const versao = rowsOf(dep)[0]?.versao_atual_enxoval as string | null;

    const pecas = await client.query(
      `SELECT codigo_sap, SUM(quantidade_atual) AS disponivel
       FROM spare_parts WHERE deposito_id = $1 AND status = 'ATIVO'
       GROUP BY codigo_sap`,
      [params.depositoId],
    );

    if (versao) {
      const itens = await client.query(
        `SELECT codigo_sap, texto_breve, qtd_oficial, qtd_atual
         FROM inventory_items WHERE deposito_id = $1 AND versao = $2`,
        [params.depositoId, versao],
      );
      const porSap = new Map<string, { disponivel: number }>();
      for (const p of rowsOf(pecas)) porSap.set(p.codigo_sap as string, { disponivel: Number(p.disponivel) });

      for (const item of rowsOf(itens)) {
        const codigoSap = item.codigo_sap as string;
        const disponivel = porSap.get(codigoSap)?.disponivel ?? 0;
        const prevista = Number(item.qtd_oficial);
        const atual = Number(item.qtd_atual);
        if (disponivel <= 0 || atual >= prevista) continue;
        const deficit = prevista - atual;
        const qtdSugerida = Math.min(disponivel, deficit);
        if (qtdSugerida <= 0) continue;

        const pendente = await client.query(
          `SELECT 1 FROM conversion_suggestions
           WHERE deposito_id = $1 AND codigo_sap = $2 AND status = 'PENDENTE' LIMIT 1`,
          [params.depositoId, codigoSap],
        );
        if (rowsOf(pendente)[0]) continue;

        const sug = await client.query(
          `INSERT INTO conversion_suggestions
            (id, deposito_id, codigo_sap, descricao, qtd_disponivel_pecas, qtd_prevista_lista, qtd_sugerida, status, criado_por, versao_enxoval)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDENTE',$8,$9)`,
          [
            newId(),
            params.depositoId,
            codigoSap,
            item.texto_breve as string,
            disponivel,
            prevista,
            qtdSugerida,
            params.matricula,
            versao,
          ],
        );
        await insertAuditLogWith(client, {
          tipo: 'SUGESTAO_CRIADA',
          usuarioId: params.usuarioId,
          matricula: params.matricula,
          depositoId: params.depositoId,
          entidade: 'conversion_suggestions',
          estadoPosterior: { codigoSap, qtdSugerida, disponivel, prevista },
          origem: params.origemMov,
          dispositivo: params.dispositivo,
        });
      }
    }

    const todas = await client.query(
      `SELECT * FROM conversion_suggestions WHERE deposito_id = $1 ORDER BY id DESC LIMIT 100`,
      [params.depositoId],
    );
    return rowsOf(todas).map(mapSugestao);
  });
}

/**
 * Fase 09: após publicar uma nova versão do enxoval, gera sugestões PENDENTE
 * para SAPs da nova lista que tenham peça avulsa disponível e saldo abaixo do
 * previsto (nunca converte automaticamente — docs 6.6).
 */
export async function gerarSugestoesParaVersao(
  params: GerarParams,
  versaoId: string,
): Promise<number> {
  return withDepositoContext(params.depositoId, params.perfil, async (client) => {
    const pecas = await client.query(
      `SELECT codigo_sap, SUM(quantidade_atual) AS disponivel
       FROM spare_parts WHERE deposito_id = $1 AND status = 'ATIVO'
       GROUP BY codigo_sap`,
      [params.depositoId],
    );
    const porSap = new Map<string, number>();
    for (const p of rowsOf(pecas)) porSap.set(p.codigo_sap as string, Number(p.disponivel));

    const itens = await client.query(
      `SELECT codigo_sap, texto_breve, qtd_oficial, qtd_atual
       FROM inventory_items WHERE deposito_id = $1 AND versao = $2`,
      [params.depositoId, versaoId],
    );

    let criadas = 0;
    for (const item of rowsOf(itens)) {
      const codigoSap = item.codigo_sap as string;
      const disponivel = porSap.get(codigoSap) ?? 0;
      const prevista = Number(item.qtd_oficial);
      const atual = Number(item.qtd_atual);
      if (disponivel <= 0 || atual >= prevista) continue;
      const qtdSugerida = Math.min(disponivel, prevista - atual);
      if (qtdSugerida <= 0) continue;

      const pendente = await client.query(
        `SELECT 1 FROM conversion_suggestions
         WHERE deposito_id = $1 AND codigo_sap = $2 AND status = 'PENDENTE' LIMIT 1`,
        [params.depositoId, codigoSap],
      );
      if (rowsOf(pendente)[0]) continue;

      await client.query(
        `INSERT INTO conversion_suggestions
          (id, deposito_id, codigo_sap, descricao, qtd_disponivel_pecas, qtd_prevista_lista, qtd_sugerida, status, criado_por, versao_enxoval)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDENTE',$8,$9)`,
        [
          newId(),
          params.depositoId,
          codigoSap,
          item.texto_breve as string,
          disponivel,
          prevista,
          qtdSugerida,
          params.matricula,
          versaoId,
        ],
      );
      await insertAuditLogWith(client, {
        tipo: 'SUGESTAO_CRIADA',
        usuarioId: params.usuarioId,
        matricula: params.matricula,
        depositoId: params.depositoId,
        entidade: 'conversion_suggestions',
        estadoPosterior: { codigoSap, qtdSugerida, disponivel, prevista, origem: 'PUBLICACAO' },
        origem: params.origemMov,
        dispositivo: params.dispositivo,
      });
      criadas++;
    }
    return criadas;
  });
}

export interface ResponderSugestaoParams {
  depositoId: string;
  perfil: string;
  usuarioId: string;
  matricula: string;
  suggestionId: string;
  operationId: string;
  acao: 'ACEITA' | 'RECUSADA';
  motivo?: string;
  assinaturaMatricula: string;
  origemMov: 'ONLINE' | 'OFFLINE';
  dispositivo: string;
}

/** Aceita (converte peça em enxoval) ou recusa a sugestão — transação atômica. */
export async function responderSugestao(
  params: ResponderSugestaoParams,
): Promise<{ sugestao: ConversionSuggestionRow; jaProcessada: boolean }> {
  return withDepositoContext(params.depositoId, params.perfil, async (client) => {
    const res = await client.query(
      'SELECT * FROM conversion_suggestions WHERE id = $1 AND deposito_id = $2 FOR UPDATE',
      [params.suggestionId, params.depositoId],
    );
    const row = rowsOf(res)[0];
    if (!row) throw new AppError('NAO_ENCONTRADO', 'Sugestão não encontrada', 404);
    const sugestao = mapSugestao(row);

    if (sugestao.processadaOperationId === params.operationId) {
      return { sugestao, jaProcessada: true };
    }
    if (sugestao.status !== 'PENDENTE') {
      throw new AppError('CONFLITO', `Sugestão já ${sugestao.status.toLowerCase()}`, 409);
    }

    if (params.acao === 'ACEITA') {
      const sp = await client.query(
        `SELECT * FROM spare_parts WHERE deposito_id = $1 AND codigo_sap = $2 AND status = 'ATIVO' FOR UPDATE`,
        [params.depositoId, sugestao.codigoSap],
      );
      const spRow = rowsOf(sp)[0];
      if (!spRow) throw new AppError('ITEM_INDISPONIVEL', 'Peça avulsa não encontrada para conversão', 409);
      const saldoSpare = Number(spRow.quantidade_atual);
      if (saldoSpare < sugestao.qtdSugerida) {
        throw new AppError('SALDO_CONFLITO', `Saldo insuficiente de peça avulsa (disponível ${saldoSpare})`, 409);
      }
      await client.query('UPDATE spare_parts SET quantidade_atual = $2 WHERE id = $1', [
        spRow.id,
        saldoSpare - sugestao.qtdSugerida,
      ]);

      const dep = (await client.query('SELECT versao_atual_enxoval FROM deposits WHERE id = $1', [
        params.depositoId,
      ])) as unknown;
      const versao = rowsOf(dep)[0]?.versao_atual_enxoval as string | null;
      const it = versao
        ? await client.query(
            `SELECT id, qtd_atual FROM inventory_items
             WHERE deposito_id = $1 AND codigo_sap = $2 AND versao = $3 FOR UPDATE`,
            [params.depositoId, sugestao.codigoSap, versao],
          )
        : null;
      const itRow = it ? rowsOf(it)[0] : undefined;
      if (!itRow) throw new AppError('INCOMPATIVEL', 'Item do enxoval não encontrado para conversão', 409);
      await client.query('UPDATE inventory_items SET qtd_atual = $2 WHERE id = $1', [
        itRow.id,
        Number(itRow.qtd_atual) + sugestao.qtdSugerida,
      ]);

      await client.query(
        `INSERT INTO spare_part_movements
          (id, deposito_id, spare_part_id, operation_id, tipo, quantidade, data_hora, usuario_id, matricula, motivo, estado_anterior, estado_posterior)
         VALUES ($1,$2,$3,$4,'CONVERSAO_ACEITA',$5,now(),$6,$7,$8,$9::jsonb,$10::jsonb)`,
        [
          newId(),
          params.depositoId,
          spRow.id,
          params.operationId,
          sugestao.qtdSugerida,
          params.usuarioId,
          params.matricula,
          `Conversão para enxoval ${sugestao.codigoSap}`,
          JSON.stringify({ spare: saldoSpare, enxoval: Number(itRow.qtd_atual) }),
          JSON.stringify({ spare: saldoSpare - sugestao.qtdSugerida, enxoval: Number(itRow.qtd_atual) + sugestao.qtdSugerida }),
        ],
      );

      await client.query(
        `UPDATE conversion_suggestions
         SET status = 'ACEITA', motivo = $2, processada_operation_id = $3 WHERE id = $1`,
        [sugestao.id, params.motivo ?? null, params.operationId],
      );

      await insertAuditLogWith(client, {
        tipo: 'CONVERSAO_PECA_AVULSA',
        usuarioId: params.usuarioId,
        matricula: params.matricula,
        depositoId: params.depositoId,
        entidade: 'conversion_suggestions',
        operacaoId: params.operationId,
        estadoAnterior: { spare: saldoSpare, enxoval: Number(itRow.qtd_atual), sugestaoId: sugestao.id },
        estadoPosterior: { spare: saldoSpare - sugestao.qtdSugerida, enxoval: Number(itRow.qtd_atual) + sugestao.qtdSugerida, sugestaoId: sugestao.id },
        motivo: params.motivo,
        origem: params.origemMov,
        dispositivo: params.dispositivo,
      });
    } else {
      if (!params.motivo) throw new AppError('VALIDATION_FAILED', 'motivo é obrigatório para recusar sugestão', 400);
      await client.query(
        `UPDATE conversion_suggestions
         SET status = 'RECUSADA', motivo = $2, processada_operation_id = $3 WHERE id = $1`,
        [sugestao.id, params.motivo, params.operationId],
      );
      await insertAuditLogWith(client, {
        tipo: 'SUGESTAO_RECUSADA',
        usuarioId: params.usuarioId,
        matricula: params.matricula,
        depositoId: params.depositoId,
        entidade: 'conversion_suggestions',
        operacaoId: params.operationId,
        estadoAnterior: { sugestaoId: sugestao.id, status: 'PENDENTE' },
        estadoPosterior: { sugestaoId: sugestao.id, status: 'RECUSADA', motivo: params.motivo },
        motivo: params.motivo,
        origem: params.origemMov,
        dispositivo: params.dispositivo,
      });
    }

    await client.query(
      `INSERT INTO processed_operations (operation_id, entidade, acao, payload_hash, processado_em, resultado)
       VALUES ($1,'conversion_suggestions','CREATE',$2,now(),$3::jsonb)`,
      [
        params.operationId,
        sha256Hex(JSON.stringify({ operationId: params.operationId, sugestaoId: sugestao.id, acao: params.acao })),
        JSON.stringify({ sugestaoId: sugestao.id, acao: params.acao }),
      ],
    );
    const final = await client.query('SELECT * FROM conversion_suggestions WHERE id = $1', [sugestao.id]);
    return { sugestao: mapSugestao(rowsOf(final)[0]), jaProcessada: false };
  });
}