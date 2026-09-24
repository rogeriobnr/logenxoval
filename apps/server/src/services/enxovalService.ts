import type { FastifyInstance } from 'fastify';
import type { DepositVersionRow, InventoryItemRow } from '@logenxoval/contracts';
import { AppError } from '../lib/errors';
import { insertAuditLog } from '../repos/auditLogRepo';
import { findDepositById } from '../repos/depositsRepo';
import { criarSnapshot } from '../repos/snapshotRepo';
import { gerarSugestoesParaVersao } from '../repos/suggestionRepo';
import {
  listItemsAtual,
  listItemsByVersion,
  listVersions,
  publicarVersao,
  type EnxovalItemDraft,
} from '../repos/enxovalRepo';

export interface EnxovalServiceDeps {
  app: FastifyInstance;
  authUser: { sub: string; matricula: string; perfil: string };
  dispositivo: string;
  origem: 'ONLINE' | 'OFFLINE';
}

export async function consultarEnxoval(
  deps: EnxovalServiceDeps,
  depositoId: string,
): Promise<{ versao: DepositVersionRow | null; itens: InventoryItemRow[] }> {
  const versoes = await listVersions(depositoId, deps.authUser.perfil);
  const atual = versoes.find((v) => v.status === 'PUBLICADA') ?? versoes[0] ?? null;
  if (!atual) return { versao: null, itens: [] };
  const itens = await listItemsByVersion(depositoId, atual.id, deps.authUser.perfil);
  return { versao: atual, itens };
}

export async function consultarVersoes(
  deps: EnxovalServiceDeps,
  depositoId: string,
): Promise<DepositVersionRow[]> {
  return listVersions(depositoId, deps.authUser.perfil);
}

export async function consultarVersao(
  deps: EnxovalServiceDeps,
  depositoId: string,
  versionId: string,
): Promise<{ versao: DepositVersionRow; itens: InventoryItemRow[] }> {
  const versoes = await listVersions(depositoId, deps.authUser.perfil);
  const versao = versoes.find((v) => v.id === versionId);
  if (!versao) throw new AppError('NAO_ENCONTRADO', 'Versão do enxoval não encontrada', 404);
  if (versao.depositoId !== depositoId) {
    throw new AppError('NAO_ENCONTRADO', 'Versão do enxoval não encontrada', 404);
  }
  const itens = await listItemsByVersion(depositoId, versionId, deps.authUser.perfil);
  return { versao, itens };
}

export async function importarEnxoval(
  deps: EnxovalServiceDeps,
  params: {
    depositoId: string;
    documentoId?: string;
    refFolha?: string;
    motivo: string;
    matriculaConfirmacao: string;
    pin?: string;
    itens: EnxovalItemDraft[];
  },
): Promise<{ versao: DepositVersionRow; itens: InventoryItemRow[] }> {
  if (deps.authUser.matricula !== params.matriculaConfirmacao) {
    throw new AppError('MATRICULA_INVALIDA', 'Matrícula de confirmação inválida', 403);
  }
  const { verificarPinSeConfigurado } = await import('../plugins/auth');
  await verificarPinSeConfigurado(params.pin, deps.app);

  const dep = await findDepositById(params.depositoId);
  if (!dep) throw new AppError('NAO_ENCONTRADO', 'Depósito não encontrado', 404);
  if (dep.status === 'INATIVO') {
    throw new AppError('OPERACAO_NEGADA', 'Depósito inativo não aceita importação', 409);
  }

  const resultado = await publicarVersao({
    depositoId: params.depositoId,
    perfil: deps.authUser.perfil,
    usuarioId: deps.authUser.sub,
    matricula: deps.authUser.matricula,
    documentoId: params.documentoId,
    refFolha: params.refFolha,
    motivo: params.motivo,
    itens: params.itens.map((i) => ({
      ...i,
      qtdAtual: i.qtdAtual === undefined ? i.qtdOficial : i.qtdAtual,
    })),
  });

  await insertAuditLog({
    tipo: 'PUBLICACAO_ENXOVAL',
    usuarioId: deps.authUser.sub,
    matricula: deps.authUser.matricula,
    depositoId: params.depositoId,
    entidade: 'inventory_items',
    operacaoId: resultado.versao.id,
    estadoAnterior: { versao: resultado.versao.versao - 1 },
    estadoPosterior: {
      versao: resultado.versao.versao,
      itens: resultado.itens.length,
      referenciaFolha: params.refFolha ?? null,
    },
    motivo: params.motivo,
    origem: deps.origem,
    dispositivo: deps.dispositivo,
  });

  // Fase 09 (docs 6.6): ponto de restauração (snapshot DEPOIS) + sugestões de
  // conversão para SAPs da nova lista com peça avulsa disponível.
  await criarSnapshot(
    {
      depositoId: params.depositoId,
      titulo: `Enxoval pós-publicação v${resultado.versao.versao}`,
      tipo: 'DEPOIS',
      motivo: params.motivo,
      usuarioId: deps.authUser.sub,
      matricula: deps.authUser.matricula,
    },
    deps.authUser.perfil,
  );
  await gerarSugestoesParaVersao(
    {
      depositoId: params.depositoId,
      perfil: deps.authUser.perfil,
      usuarioId: deps.authUser.sub,
      matricula: deps.authUser.matricula,
      origemMov: deps.origem,
      dispositivo: deps.dispositivo,
    },
    resultado.versao.id,
  );

  if (params.documentoId) {
    await insertAuditLog({
      tipo: 'IMPORTACAO_FOLHA',
      usuarioId: deps.authUser.sub,
      matricula: deps.authUser.matricula,
      depositoId: params.depositoId,
      entidade: 'documents',
      operacaoId: resultado.versao.id,
      estadoAnterior: { versao: resultado.versao.versao - 1 },
      estadoPosterior: {
        versao: resultado.versao.versao,
        documentoId: params.documentoId,
        referenciaFolha: params.refFolha ?? null,
      },
      motivo: params.motivo,
      origem: deps.origem,
      dispositivo: deps.dispositivo,
    });
  }

  return resultado;
}