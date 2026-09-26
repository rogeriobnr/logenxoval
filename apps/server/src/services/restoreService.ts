import type { FastifyInstance } from 'fastify';
import type { DepositVersionRow, InventoryItemRow, Perfil } from '@logenxoval/contracts';
import { AppError } from '../lib/errors';
import { insertAuditLog } from '../repos/auditLogRepo';
import { findDepositById } from '../repos/depositsRepo';
import { criarSnapshot, findSnapshot } from '../repos/snapshotRepo';
import { publicarVersao, type EnxovalItemDraft } from '../repos/enxovalRepo';

export interface RestoreServiceDeps {
  app: FastifyInstance;
  authUser: { sub: string; matricula: string; perfil: Perfil | string };
  dispositivo: string;
  origem: 'ONLINE' | 'OFFLINE';
}

/**
 * Fase 12 (docs 15): restaura o enxoval para o conteúdo de um snapshot.
 * Regras: NUNCA apaga goldbox/logs/correções/versões anteriores; cria UMA NOVA
 * versão (versao = MAX+1), marca a atual como SUBSTITUIDA e volta o ponteiro
 * deposits.versao_atual_enxoval para a nova versão.
 */
export async function restaurarSnapshot(
  deps: RestoreServiceDeps,
  params: {
    depositoId: string;
    snapshotId: string;
    motivo: string;
    matriculaConfirmacao: string;
    pin?: string;
  },
): Promise<{ versao: DepositVersionRow; itens: InventoryItemRow[] }> {
  if (deps.authUser.matricula !== params.matriculaConfirmacao) {
    throw new AppError('MATRICULA_INVALIDA', 'Matrícula de confirmação inválida', 403);
  }
  const { verificarPinDoUsuario } = await import('../plugins/auth');
  await verificarPinDoUsuario(params.pin, deps.app, deps.authUser.sub);

  const dep = await findDepositById(params.depositoId);
  if (!dep) throw new AppError('NAO_ENCONTRADO', 'Depósito não encontrado', 404);
  if (dep.status === 'INATIVO') {
    throw new AppError('OPERACAO_NEGADA', 'Depósito inativo não aceita restauração', 409);
  }

  const snapshot = await findSnapshot(params.depositoId, params.snapshotId, deps.authUser.perfil);
  if (!snapshot) {
    throw new AppError('NAO_ENCONTRADO', 'Snapshot não encontrado', 404);
  }

  const payload = snapshot.payload as {
    versaoAtual?: string | null;
    enxoval?: Array<Record<string, unknown>>;
  };
  const rows = payload.enxoval ?? [];
  if (rows.length === 0) {
    throw new AppError('OPERACAO_NEGADA', 'Snapshot sem itens de enxoval para restaurar', 409);
  }

  const itens: EnxovalItemDraft[] = rows.map((r) => ({
    codigoSap: r.codigo_sap as string,
    materialId: (r.material_id as string | null) ?? undefined,
    textoBreve: r.texto_breve as string,
    foto: (r.foto as string | null) ?? undefined,
    qtdOficial: Number(r.qtd_oficial ?? 0),
    qtdAtual: Number(r.qtd_atual ?? 0),
    utilizacaoLivre: Boolean(r.utilizacao_livre),
    valorUnitario: r.valor_unitario === null || r.valor_unitario === undefined ? undefined : Number(r.valor_unitario),
    valorTotal: r.valor_total === null || r.valor_total === undefined ? undefined : Number(r.valor_total),
    unidadeMedida: (r.unidade_medida as string | null) ?? undefined,
    estoqueMinimo: r.estoque_minimo === null || r.estoque_minimo === undefined ? undefined : Number(r.estoque_minimo),
    status: r.status as InventoryItemRow['status'],
  }));

  const resultado = await publicarVersao({
    depositoId: params.depositoId,
    perfil: deps.authUser.perfil,
    usuarioId: deps.authUser.sub,
    matricula: deps.authUser.matricula,
    motivo: params.motivo,
    itens,
  });

  await insertAuditLog({
    tipo: 'RESTAURACAO',
    usuarioId: deps.authUser.sub,
    matricula: deps.authUser.matricula,
    depositoId: params.depositoId,
    entidade: 'inventory_items',
    operacaoId: resultado.versao.id,
    estadoAnterior: {
      versao: resultado.versao.versao - 1,
      versaoRestaurada: snapshot.titulo,
    },
    estadoPosterior: {
      versao: resultado.versao.versao,
      itens: resultado.itens.length,
      origem: snapshot.titulo,
    },
    motivo: params.motivo,
    origem: deps.origem,
    dispositivo: deps.dispositivo,
  });

  await criarSnapshot(
    {
      depositoId: params.depositoId,
      titulo: `Enxoval pós-restauração v${resultado.versao.versao} (${snapshot.titulo})`,
      tipo: 'DEPOIS',
      motivo: params.motivo,
      usuarioId: deps.authUser.sub,
      matricula: deps.authUser.matricula,
    },
    deps.authUser.perfil,
  );

  return resultado;
}