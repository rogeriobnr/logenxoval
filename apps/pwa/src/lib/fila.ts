import type { SyncQueueRow } from '@logenxoval/contracts';

export interface RespostaFila {
  ok: Set<string>;
  erros: Map<string, string>;
  conflitos: Set<string>;
}

/** Seleciona operações da fila que ainda precisam ser enviadas para um depósito. */
export function operacoesDaFila(fila: SyncQueueRow[], depositoId: string): SyncQueueRow[] {
  return fila
    .filter((q) => {
      if (q.status !== 'PENDENTE' && q.status !== 'ERRO') return false;
      const p = q.payload as { depositoId?: string } | null;
      return p?.depositoId === depositoId;
    })
    .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
}

/** Consolida a resposta do servidor /sync por operação (docs 7.3/8.5). */
export function processarRespostaFila(
  operacoes: Array<{ operationId: string }>,
  res: {
    acks?: Array<{ operationId: string; status: 'OK' | 'JA_PROCESSADO' }>;
    errors?: Array<{ operationId: string; code: string; message?: string }>;
    conflicts?: Array<{ operationId: string; tipo: string; detalhe?: string }>;
  },
): RespostaFila {
  const ok = new Set(res.acks?.map((a) => a.operationId) ?? []);
  const erros = new Map(res.errors?.map((e) => [e.operationId, e.message ?? e.code]) ?? []);
  const conflitos = new Set(res.conflicts?.map((c) => c.operationId) ?? []);
  // Operação sem ack e sem erro (ex.: lote parcial) deve permanecer pendente.
  for (const op of operacoes) {
    if (!ok.has(op.operationId) && !erros.has(op.operationId) && !conflitos.has(op.operationId)) {
      erros.set(op.operationId, 'Sem confirmação do servidor (reenviar)');
    }
  }
  return { ok, erros, conflitos };
}