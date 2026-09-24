import Dexie, { type Table } from 'dexie';
import type {
  AuditLogRow,
  ConsumableMovementRow,
  ConsumableRow,
  ConversionSuggestionRow,
  DepositVersionRow,
  DepositoRow,
  DivergenceRow,
  DocumentRow,
  GoldboxMovementRow,
  InspectionItemRow,
  InspectionRow,
  InventoryItemRow,
  PpeItemRow,
  PpeMovementRow,
  RequestRow,
  SnapshotRow,
  SparePartMovementRow,
  SparePartRow,
  SyncQueueRow,
  SyncStateRow,
  UserRow,
} from '@logenxoval/contracts';

/** Chave/valor persistido no IndexedDB (deviceId, salt, hash PBKDF2, etc.). */
export interface KvRecord {
  key: string;
  value: unknown;
}

export interface DepositoInfo {
  id: string;
  numero: string;
  nome: string;
}

/** Sessão local do dispositivo — única por device (docs 3.2). */
export interface SessionRecord {
  userId: string;
  matricula: string;
  nomeCompleto: string;
  perfil: string;
  depositos: DepositoInfo[];
  depositoAtivo: string;
  saltLocal: string;
  hashLocal: string;
  accessToken?: string;
  refreshToken?: string;
  loginEm: string;
  expiresAt: string;
  lastActivityAt: string;
}

/**
 * Espelho local (IndexedDB) — documents a fase 02 exige armazenar
 * o mesmo conjunto de entidades do servidor, isoladas por depositoId.
 */
class LogEnxovalDb extends Dexie {
  kv!: Table<KvRecord, string>;
  session!: Table<SessionRecord, string>;
  users!: Table<UserRow, string>;
  deposits!: Table<DepositoRow, string>;
  depositVersions!: Table<DepositVersionRow, string>;
  inventoryItems!: Table<InventoryItemRow, string>;
  goldboxMovements!: Table<GoldboxMovementRow, string>;
  spareParts!: Table<SparePartRow, string>;
  sparePartMovements!: Table<SparePartMovementRow, string>;
  consumables!: Table<ConsumableRow, string>;
  consumableMovements!: Table<ConsumableMovementRow, string>;
  ppeItems!: Table<PpeItemRow, string>;
  ppeMovements!: Table<PpeMovementRow, string>;
  requests!: Table<RequestRow, string>;
  inspections!: Table<InspectionRow, string>;
  inspectionItems!: Table<InspectionItemRow, string>;
  conversionSuggestions!: Table<ConversionSuggestionRow, string>;
  divergences!: Table<DivergenceRow, string>;
  auditLogs!: Table<AuditLogRow, string>;
  snapshots!: Table<SnapshotRow, string>;
  documents!: Table<DocumentRow, string>;
  syncQueue!: Table<SyncQueueRow, string>;
  processedOperations!: Table<{ operationId: string } & Record<string, unknown>, string>;
  settings!: Table<{ chave: string; depositoId?: string; valor?: unknown }, string>;
  syncState!: Table<SyncStateRow, [string, string]>;

  constructor() {
    super('logenxoval');
    this.version(1).stores({
      kv: 'key',
      session: 'userId',
    });
    this.version(2).stores({
      kv: 'key',
      session: 'userId',
      users: 'id, matricula, perfil, status',
      deposits: 'id, numero, status',
      depositVersions: 'id, depositoId, versao, status',
      inventoryItems: 'id, [depositoId+codigoSap], depositoId, codigoSap, versao, status, atualizadoEm',
      goldboxMovements: 'id, operationId, depositoId, codigoSap, dataHora, matricula, statusSync',
      spareParts: 'id, [depositoId+codigoSap], depositoId, codigoSap, status',
      sparePartMovements: 'id, operationId, sparePartId, depositoId',
      consumables: 'id, [depositoId+codigo], depositoId, codigo',
      consumableMovements: 'id, operationId, consumableId, depositoId',
      ppeItems: 'id, [depositoId+codigo], depositoId, codigo',
      ppeMovements: 'id, operationId, ppeItemId, depositoId',
      inspections: 'id, depositoId, status, dataEm',
      inspectionItems: 'id, inspectionId, codigoSap, status',
      conversionSuggestions: 'id, depositoId, status',
      divergences: 'id, depositoId, status, criadoEm',
      auditLogs: 'id, depositoId, tipo, dataHora',
      snapshots: 'id, depositoId, dataEm',
      documents: 'id, depositoId',
      syncQueue: 'id, operationId, entidade, acao, status, criadoEm, proximaTentativaEm',
      processedOperations: 'operationId',
      settings: '[chave+depositoId]',
      syncState: '[deviceId+depositoId], status',
    });
    this.version(3).stores({
      kv: 'key',
      session: 'userId',
      users: 'id, matricula, perfil, status',
      deposits: 'id, numero, status',
      depositVersions: 'id, depositoId, versao, status',
      inventoryItems: 'id, [depositoId+codigoSap], depositoId, codigoSap, versao, status, atualizadoEm',
      goldboxMovements: 'id, operationId, depositoId, codigoSap, dataHora, matricula, statusSync',
      spareParts: 'id, [depositoId+codigoSap], depositoId, codigoSap, status',
      sparePartMovements: 'id, operationId, sparePartId, depositoId',
      consumables: 'id, [depositoId+codigo], depositoId, codigo',
      consumableMovements: 'id, operationId, consumableId, depositoId',
      ppeItems: 'id, [depositoId+codigo], depositoId, codigo',
      ppeMovements: 'id, operationId, ppeItemId, depositoId',
      requests: 'id, depositoId, tipo, solicitanteId, matricula, status, dataEm',
      inspections: 'id, depositoId, status, dataEm',
      inspectionItems: 'id, inspectionId, codigoSap, status',
      conversionSuggestions: 'id, depositoId, status',
      divergences: 'id, depositoId, status, criadoEm',
      auditLogs: 'id, depositoId, tipo, dataHora',
      snapshots: 'id, depositoId, dataEm',
      documents: 'id, depositoId',
      syncQueue: 'id, operationId, entidade, acao, status, criadoEm, proximaTentativaEm',
      processedOperations: 'operationId',
      settings: '[chave+depositoId]',
      syncState: '[deviceId+depositoId], status',
    });
  }
}

export const db = new LogEnxovalDb();

export const kvGet = async <T>(key: string): Promise<T | undefined> =>
  (await db.kv.get(key))?.value as T | undefined;

export const kvSet = async (key: string, value: unknown): Promise<void> => {
  await db.kv.put({ key, value });
};

export const kvDel = async (key: string): Promise<void> => {
  await db.kv.delete(key);
};

export const SESSION_KEY = 'session:ativa';
export const DEVICE_KEY = 'deviceId';

export async function getStoredSession(): Promise<SessionRecord | undefined> {
  return db.session.get(SESSION_KEY);
}