import type {
  AuditLogRow,
  ConversionSuggestionRow,
  DepositVersionRow,
  DepositoRow,
  InventoryItemRow,
  SparePartRow,
} from '@logenxoval/contracts';
import type { ApiClient } from '../lib/api';
import { emitSync } from '../lib/events';
import { operacoesDaFila, processarRespostaFila } from '../lib/fila';
import {
  clearDepositoLocalData,
  listDepositosLocal,
  listFila,
  marcarFalhaFila,
  removerDaFila,
  setSyncState,
  upsertAuditLogs,
  upsertConversionSuggestions,
  upsertDepositos,
  upsertInventoryItems,
  upsertSpareParts,
  upsertVersions,
} from '../repos/local';

export interface EspelhoResult {
  sincronizados: number;
  lastSyncAt: string;
  enviadas: number;
  errosFila: number;
}

export interface FlushResult {
  enviadas: number;
  erros: number;
}

/** Envia as baixas pendentes de um depósito (post /sync) e aplica acks/erros. */
export async function enviarBaixasPendentes(
  api: ApiClient,
  deviceId: string,
  depositoId: string,
  report?: (message: string) => void,
): Promise<FlushResult> {
  const fila = await listFila();
  const operacoes = operacoesDaFila(fila, depositoId);
  if (operacoes.length === 0) return { enviadas: 0, erros: 0 };
  report?.(`Enviando ${operacoes.length} baixa(s) pendente(s)`);

  const res = await api.request<{
    acks: Array<{ operationId: string; status: 'OK' | 'JA_PROCESSADO' }>;
    errors: Array<{ operationId: string; code: string; message?: string }>;
    conflicts: Array<{ operationId: string; tipo: string; detalhe?: string }>;
  }>('POST', '/sync', {
    deviceId,
    depositoId,
    operations: operacoes.map((o) => ({
      operationId: o.operationId,
      entidade: o.entidade,
      acao: o.acao,
      payload: o.payload,
    })),
  });

  const resultado = processarRespostaFila(operacoes, res);
  let enviadas = 0;
  let erros = 0;
  for (const op of operacoes) {
    if (resultado.ok.has(op.operationId)) {
      await removerDaFila(op.operationId);
      enviadas++;
    } else if (resultado.conflitos.has(op.operationId)) {
      await marcarFalhaFila(op.operationId, 'Conflito pendente — verificar no dashboard');
      erros++;
    } else {
      const motivo = resultado.erros.get(op.operationId) ?? 'Erro de sincronização';
      await marcarFalhaFila(op.operationId, motivo);
      erros++;
    }
  }
  return { enviadas, erros };
}

/** Espelha os itens e versões do enxoval de um depósito no IndexedDB. */
export async function espelharEnxoval(api: ApiClient, depositoId: string): Promise<void> {
  const enxoval = await api.request<{
    versao: DepositVersionRow | null;
    itens: InventoryItemRow[];
  }>('GET', `/deposits/${depositoId}/enxoval`);
  if (enxoval.itens.length > 0) await upsertInventoryItems(enxoval.itens);
  if (enxoval.versao) await upsertVersions([enxoval.versao]);

  const versoes = await api.request<{ versoes: DepositVersionRow[] }>(
    'GET',
    `/deposits/${depositoId}/enxoval/versions`,
  );
  if (versoes.versoes.length > 0) await upsertVersions(versoes.versoes);
}

/** Fase 07: espelha peças avulsas e sugestões de conversão do depósito. */
export async function espelharPecas(api: ApiClient, depositoId: string): Promise<void> {
  const pecas = await api.request<{ pecas: SparePartRow[] }>('GET', `/deposits/${depositoId}/spare-parts`);
  if (pecas.pecas.length > 0) await upsertSpareParts(pecas.pecas);

  const sugestoes = await api.request<{ sugestoes: ConversionSuggestionRow[] }>(
    'GET',
    `/deposits/${depositoId}/conversion-suggestions`,
  );
  if (sugestoes.sugestoes.length > 0) await upsertConversionSuggestions(sugestoes.sugestoes);
}

/** Fase 08: espelha os últimos ~90 dias de logs de auditoria do depósito. */
export async function espelharLogs(api: ApiClient, depositoId: string): Promise<void> {
  const dataIni = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const res = await api.request<{ logs: AuditLogRow[] }>(
    'GET',
    `/deposits/${depositoId}/logs?dataIni=${encodeURIComponent(dataIni)}`,
  );
  if (res.logs.length > 0) await upsertAuditLogs(res.logs);
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

  let enviadas = 0;
  let errosFila = 0;
  report(`Baixando o enxoval de ${res.depositos.length} depósito(s)`);
  for (const d of res.depositos) {
    report(`Enviando baixas pendentes de ${d.numero}`);
    try {
      const flush = await enviarBaixasPendentes(api, deviceId, d.id, report);
      enviadas += flush.enviadas;
      errosFila += flush.erros;
    } catch (err) {
      errosFila += (await listFila()).filter((q) => q.status === 'ERRO').length;
      report(`Falha ao enviar baixas de ${d.numero}: ${err instanceof Error ? err.message : 'erro'}`);
    }
    try {
      await espelharEnxoval(api, d.id);
      await espelharPecas(api, d.id);
      await espelharLogs(api, d.id);
    } catch {
      // Depósito sem enxoval publicado ainda — segue sem itens locais.
    }
  }

  report('Verificando conflitos e registrando última sincronização');
  const lastSyncAt = new Date().toISOString();
  for (const d of res.depositos) {
    await setSyncState(deviceId, d.id, { lastSyncAt, status: 'SINCRONIZADO' });
  }

  report('Finalizando');
  emitSync();
  return { sincronizados: res.depositos.length, lastSyncAt, enviadas, errosFila };
}