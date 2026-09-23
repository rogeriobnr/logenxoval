import type { DepositoRow } from '@logenxoval/contracts';
import type { ApiClient } from '../lib/api';
import { emitSync } from '../lib/events';
import {
  clearDepositoLocalData,
  listDepositosLocal,
  setSyncState,
  upsertDepositos,
} from '../repos/local';

export interface EspelhoResult {
  sincronizados: number;
  lastSyncAt: string;
}

/**
 * Fase 02: espelha os depósitos autorizados no IndexedDB.
 * A sync completa (push+fila+conflitos) chega na fase 05.
 */
export async function espelharDepositos(params: {
  api: ApiClient;
  deviceId: string;
  report?: (message: string) => void;
}): Promise<EspelhoResult> {
  const { api, deviceId } = params;
  const report = params.report ?? (() => undefined);

  report('Verificando conexão');
  const res = await api.request<{ depositos: DepositoRow[] }>('GET', '/deposits');

  report(`Baixando ${res.depositos.length} depósito(s)`);
  await upsertDepositos(res.depositos);

  report('Removendo depósitos sem acesso');
  const locais = await listDepositosLocal();
  const ids = new Set(res.depositos.map((d) => d.id));
  for (const d of locais) {
    if (!ids.has(d.id)) await clearDepositoLocalData(d.id);
  }

  report('Registrando última sincronização');
  const lastSyncAt = new Date().toISOString();
  for (const d of res.depositos) {
    await setSyncState(deviceId, d.id, { lastSyncAt, status: 'SINCRONIZADO' });
  }

  report('Finalizando');
  emitSync();
  return { sincronizados: res.depositos.length, lastSyncAt };
}