import type {
  DepositVersionRow,
  DepositoRow,
  DivergenceRow,
  GoldboxMovementRow,
  InventoryItemRow,
  SyncQueueRow,
  SyncStateRow,
} from '@logenxoval/contracts';
import { db } from '../db/db';

/** Acesso aos dados locais (espelho) — leituras offline e estado de sync. */

export async function upsertDepositos(depositos: DepositoRow[]): Promise<void> {
  await db.transaction('rw', db.deposits, async () => {
    for (const d of depositos) await db.deposits.put(d);
  });
}

export async function upsertVersions(versoes: DepositVersionRow[]): Promise<void> {
  await db.transaction('rw', db.depositVersions, async () => {
    for (const v of versoes) await db.depositVersions.put(v);
  });
}

export async function upsertInventoryItems(itens: InventoryItemRow[]): Promise<void> {
  await db.transaction('rw', db.inventoryItems, async () => {
    for (const i of itens) await db.inventoryItems.put(i);
  });
}

export async function listInventoryItemsLocal(depositoId: string): Promise<InventoryItemRow[]> {
  return db.inventoryItems.where('depositoId').equals(depositoId).toArray();
}

export async function listVersionsLocal(depositoId: string): Promise<DepositVersionRow[]> {
  return db.depositVersions.where('depositoId').equals(depositoId).sortBy('versao');
}

/** Itens da versão atual (por versãoAtualEnxoval do depósito local). */
export async function getEnxovalAtualLocal(
  depositoId: string,
): Promise<{ versao: DepositVersionRow | null; itens: InventoryItemRow[] }> {
  const dep = await db.deposits.get(depositoId);
  const versaoId = dep?.versaoAtualEnxoval;
  if (!versaoId) return { versao: null, itens: [] };
  const todos = await listInventoryItemsLocal(depositoId);
  const versao = await db.depositVersions.get(versaoId);
  return { versao: versao ?? null, itens: todos.filter((i) => i.versao === versaoId) };
}

export async function listDepositosLocal(): Promise<DepositoRow[]> {
  return db.deposits.orderBy('numero').toArray();
}

export async function getDepositoLocal(id: string): Promise<DepositoRow | undefined> {
  return db.deposits.get(id);
}

export async function contarPendenciasFila(): Promise<number> {
  return db.syncQueue.where('status').equals('PENDENTE').count();
}

export interface BaixaOfflineArgs {
  operationId: string;
  depositoId: string;
  codigoSap: string;
  descricao?: string;
  quantidade: number;
  reposicao: boolean;
  dataHora: string;
  usuarioId: string;
  nomeCompleto: string;
  matricula: string;
  dispositivo: string;
  assinaturaMatricula: string;
}

/**
 * Registra uma baixa offline: movimento local com statusSync PENDENTE,
 * débito otimista no saldo local e item na fila (fase 05).
 */
export async function registrarBaixaOffline(args: BaixaOfflineArgs): Promise<void> {
  const movimento: GoldboxMovementRow = {
    id: args.operationId,
    operationId: args.operationId,
    depositoId: args.depositoId,
    codigoSap: args.codigoSap,
    descricao: args.descricao,
    quantidade: args.quantidade,
    dataHora: args.dataHora,
    usuarioId: args.usuarioId,
    nomeCompleto: args.nomeCompleto,
    matricula: args.matricula,
    reposicao: args.reposicao,
    origem: 'OFFLINE',
    dispositivo: args.dispositivo,
    statusSync: 'PENDENTE',
    assinaturaMatricula: args.assinaturaMatricula,
  };
  const fila: SyncQueueRow = {
    id: args.operationId,
    operationId: args.operationId,
    entidade: 'BAIXA',
    acao: 'CREATE',
    payload: {
      depositoId: args.depositoId,
      codigoSap: args.codigoSap,
      descricao: args.descricao,
      quantidade: args.quantidade,
      reposicao: args.reposicao,
      origem: 'OFFLINE',
      dispositivo: args.dispositivo,
      dataHora: args.dataHora,
      assinaturaMatricula: args.assinaturaMatricula,
      matriculaConfirmacao: args.matricula,
    },
    criadoEm: args.dataHora,
    tentativas: 0,
    proximaTentativaEm: args.dataHora,
    status: 'PENDENTE',
  };
  await db.transaction('rw', [db.goldboxMovements, db.inventoryItems, db.syncQueue], async () => {
    await db.goldboxMovements.put(movimento);
    const item = await db.inventoryItems.where('[depositoId+codigoSap]').equals([args.depositoId, args.codigoSap]).first();
    if (item) {
      await db.inventoryItems.put({ ...item, qtdAtual: item.qtdAtual - args.quantidade });
    }
    await db.syncQueue.put(fila);
  });
}

export async function listFila(): Promise<SyncQueueRow[]> {
  return db.syncQueue.orderBy('criadoEm').toArray();
}

export async function removerDaFila(operationId: string): Promise<void> {
  await db.syncQueue.delete(operationId);
}

export async function marcarFalhaFila(operationId: string, erro: string, tentativas: number = 1): Promise<void> {
  const atual = await db.syncQueue.get(operationId);
  if (!atual) return;
  await db.syncQueue.put({
    ...atual,
    status: 'ERRO',
    tentativas: (atual.tentativas ?? 0) + tentativas,
    erro,
  });
}

export async function listMovimentosLocais(depositoId: string): Promise<GoldboxMovementRow[]> {
  const locais = await db.goldboxMovements.where('depositoId').equals(depositoId).sortBy('dataHora');
  return locais.reverse();
}

export async function listDivergenciasAbertas(depositoId?: string): Promise<DivergenceRow[]> {
  const base = depositoId ? db.divergences.where('depositoId').equals(depositoId) : db.divergences;
  return (await base.toArray()).filter((d) => d.status === 'ABERTA');
}

export async function listItensNegativos(): Promise<InventoryItemRow[]> {
  return (await db.inventoryItems.toArray()).filter((i) => i.qtdAtual < 0);
}

export interface PendenciasLocais {
  fila: number;
  divergencias: number;
  negativos: number;
  errosFila: number;
}

export async function getPendenciasLocais(depositoId?: string): Promise<PendenciasLocais> {
  const fila = await contarPendenciasFila();
  const errosFila = await db.syncQueue.where('status').equals('ERRO').count();
  const divergencias = (await listDivergenciasAbertas(depositoId)).length;
  const negativos = (await listItensNegativos()).length;
  return { fila, divergencias, negativos, errosFila };
}

export async function getSyncState(
  deviceId: string,
  depositoId: string,
): Promise<SyncStateRow | undefined> {
  return db.syncState.get([deviceId, depositoId]);
}

export async function setSyncState(
  deviceId: string,
  depositoId: string,
  patch: Partial<Pick<SyncStateRow, 'lastSyncAt' | 'status' | 'ultimaDivergenciaNaoLida'>>,
): Promise<void> {
  const atual = await db.syncState.get([deviceId, depositoId]);
  await db.syncState.put({
    deviceId,
    depositoId,
    lastSyncAt: patch.lastSyncAt ?? atual?.lastSyncAt ?? new Date().toISOString(),
    status: patch.status ?? atual?.status ?? 'OFFLINE_SEM_PENDENCIA',
    ...(patch.ultimaDivergenciaNaoLida ? { ultimaDivergenciaNaoLida: patch.ultimaDivergenciaNaoLida } : {}),
  });
}

/** Remove todos os dados de um depósito no dispositivo (perda de acesso/desativação). */
export async function clearDepositoLocalData(depositoId: string): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.deposits,
      db.depositVersions,
      db.inventoryItems,
      db.goldboxMovements,
      db.spareParts,
      db.sparePartMovements,
      db.consumables,
      db.consumableMovements,
      db.ppeItems,
      db.ppeMovements,
      db.inspections,
      db.inspectionItems,
      db.conversionSuggestions,
      db.divergences,
      db.auditLogs,
      db.snapshots,
      db.documents,
      db.settings,
      db.syncState,
    ],
    async () => {
      await db.deposits.where('id').equals(depositoId).delete();
      await db.depositVersions.where('depositoId').equals(depositoId).delete();
      await db.inventoryItems.where('depositoId').equals(depositoId).delete();
      await db.goldboxMovements.where('depositoId').equals(depositoId).delete();
      await db.spareParts.where('depositoId').equals(depositoId).delete();
      await db.sparePartMovements.where('depositoId').equals(depositoId).delete();
      await db.consumables.where('depositoId').equals(depositoId).delete();
      await db.consumableMovements.where('depositoId').equals(depositoId).delete();
      await db.ppeItems.where('depositoId').equals(depositoId).delete();
      await db.ppeMovements.where('depositoId').equals(depositoId).delete();
      await db.inspections.where('depositoId').equals(depositoId).delete();
      await db.inspectionItems.filter((it) => it.depositoId === depositoId).delete();
      await db.conversionSuggestions.where('depositoId').equals(depositoId).delete();
      await db.divergences.where('depositoId').equals(depositoId).delete();
      await db.auditLogs.where('depositoId').equals(depositoId).delete();
      await db.snapshots.where('depositoId').equals(depositoId).delete();
      await db.documents.where('depositoId').equals(depositoId).delete();
      await db.settings.filter((s) => s.depositoId === depositoId).delete();
      await db.syncState.filter((s) => s.depositoId === depositoId).delete();
    },
  );
}