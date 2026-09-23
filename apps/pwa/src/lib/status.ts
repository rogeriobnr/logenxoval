import type { SyncStatus } from '@logenxoval/contracts';

/** Entradas para calcular o estado do dashboard (docs 7.5). */
export interface StateInput {
  online: boolean;
  filaPendente: number;
  erro: boolean;
  sincronizando: boolean;
  conflitoPendente: boolean;
}

export function statusSync(d: StateInput): SyncStatus {
  if (d.sincronizando) return 'SINCRONIZANDO';
  if (d.conflitoPendente) return 'CONFLITO_PENDENTE';
  if (!d.online) return d.filaPendente > 0 ? 'OFFLINE_COM_PENDENCIA' : 'OFFLINE_SEM_PENDENCIA';
  if (d.erro) return 'ERRO_SINCRONIZACAO';
  return 'SINCRONIZADO';
}