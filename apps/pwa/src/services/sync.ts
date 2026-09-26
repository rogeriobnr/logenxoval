import type {
  AuditLogRow,
  ConsumableRow,
  ConversionSuggestionRow,
  DepositVersionRow,
  DepositoRow,
  DivergenceRow,
  InventoryItemRow,
  PpeItemRow,
  RequestRow,
  SparePartRow,
} from '@logenxoval/contracts';
import type { ApiClient } from '../lib/api';
import { emitSync } from '../lib/events';
import { operacoesDaFila, processarRespostaFila } from '../lib/fila';
import { db } from '../db/db';
import {
  clearDepositoLocalData,
  listDepositosLocal,
  listFila,
  listRequestsLocal,
  marcarFalhaFila,
  removerDaFila,
  setSyncState,
  upsertAuditLogs,
  upsertConsumiveis,
  upsertConversionSuggestions,
  upsertDepositos,
  upsertDivergences,
  upsertInventoryItems,
  upsertPpeItems,
  upsertRequests,
  upsertSpareParts,
  upsertVersions,
} from '../repos/local';

export interface EspelhoResult {
  sincronizados: number;
  lastSyncAt: string;
  enviadas: number;
  errosFila: number;
}

export interface SnapshotListado {
  id: string;
  depositoId: string;
  titulo: string;
  tipo: 'ANTES' | 'DEPOIS';
  motivo?: string;
  matricula: string;
  dataEm: string;
  versaoAtual?: string | null;
}

/** Fase 12: lista os pontos de restauração (metadados) de um depósito. */
export async function listarSnapshots(api: ApiClient, depositoId: string): Promise<SnapshotListado[]> {
  const res = await api.request<{ snapshots: SnapshotListado[] }>(
    'GET',
    `/deposits/${depositoId}/snapshots`,
  );
  return res.snapshots ?? [];
}

/** Fase 12: restaura o enxoval para o conteúdo do snapshot indicado. */
export async function restaurarSnapshotV12(
  api: ApiClient,
  params: {
    depositoId: string;
    snapshotId: string;
    motivo: string;
    matriculaConfirmacao: string;
    pin?: string;
  },
): Promise<{ versao: DepositVersionRow; itens: InventoryItemRow[] }> {
  return api.request<{ versao: DepositVersionRow; itens: InventoryItemRow[] }>(
    'POST',
    `/deposits/${params.depositoId}/snapshots/${params.snapshotId}/restore`,
    {
      motivo: params.motivo,
      matriculaConfirmacao: params.matriculaConfirmacao,
      pin: params.pin,
    },
  );
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
  const operacoes = operacoesDaFila(fila, depositoId).filter((o) => o.entidade !== 'DOCUMENTO');
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
 * Fase 10: espelha consumíveis, EPIs e solicitações. Solicitações criadas
 * offline (id `local:...`) que já não estão mais na fila (flushed) são
 * removidas — o servidor passa a ser a verdade com o id real.
 */
export async function espelharEstoque(api: ApiClient, depositoId: string): Promise<void> {
  const consumiveis = await api.request<{ consumiveis: ConsumableRow[] }>(
    'GET',
    `/deposits/${depositoId}/consumables`,
  );
  if (consumiveis.consumiveis.length > 0) await upsertConsumiveis(consumiveis.consumiveis);

  const ppe = await api.request<{ ppe: PpeItemRow[] }>('GET', `/deposits/${depositoId}/ppe`);
  if (ppe.ppe.length > 0) await upsertPpeItems(ppe.ppe);

  const reqs = await api.request<{ solicitacoes: RequestRow[] }>(
    'GET',
    `/deposits/${depositoId}/requests`,
  );
  if (reqs.solicitacoes.length > 0) await upsertRequests(reqs.solicitacoes);

  const fila = await listFila();
  const emFila = new Set(
    fila
      .filter((q) => q.entidade === 'SOLICITACAO' && (q.status === 'PENDENTE' || q.status === 'ERRO'))
      .map((q) => `local:${q.operationId}`),
  );
  const locais = (await listRequestsLocal(depositoId)).filter(
    (r) => r.id.startsWith('local:') && !emFila.has(r.id),
  );
  for (const r of locais) await db.requests.delete(r.id);
}

/**
 * Fase 09: faz upload dos documentos capturados offline (multipart) e sincroniza
 * o id local → id do servidor no espelho.
 */
export async function enviarDocumentosPendentes(
  api: ApiClient,
  depositoId: string,
  report?: (message: string) => void,
): Promise<FlushResult> {
  const fila = await listFila();
  const pendentes = fila.filter((q) => q.entidade === 'DOCUMENTO' && (q.status === 'PENDENTE' || q.status === 'ERRO'));
  if (pendentes.length === 0) return { enviadas: 0, erros: 0 };
  report?.(`Enviando ${pendentes.length} documento(s) pendente(s)`);

  let enviadas = 0;
  let erros = 0;
  for (const q of pendentes) {
    const payload = q.payload as {
      depositoId: string;
      nome: string;
      mime: string;
      tamanho: number;
      hashDocumento: string;
    };
    if (payload.depositoId !== depositoId) continue;
    const local = await db.documents.get(q.id);
    if (!local?.bytes) {
      await marcarFalhaFila(q.id, 'Documento sem conteúdo no dispositivo');
      erros++;
      continue;
    }
    const form = new FormData();
    const blob = local.bytes instanceof Blob ? local.bytes : new Blob([new Uint8Array(local.bytes)]);
    form.append('file', blob, local.nome);
    try {
      const res = await api.upload<{ documento: { id: string; hash: string } }>(
        `/documents?depositoId=${depositoId}`,
        form,
      );
      await db.documents.put({
        ...local,
        id: res.documento.id,
        hashDocumento: res.documento.hash,
        depositoId,
      });
      await db.documents.delete(local.id);
      await removerDaFila(q.id);
      enviadas++;
    } catch {
      await marcarFalhaFila(q.id, 'Falha ao enviar documento');
      erros++;
    }
  }
  return { enviadas, erros };
}

/**
 * Fase 19: espelha as divergências do depósito (pendências de reposição e
 * saldo negativo) no IndexedDB — todos os dispositivos do depósito veem as
 * mesmas pendências criadas em outros aparelhos.
 */
export async function espelharDivergencias(api: ApiClient, depositoId: string): Promise<void> {
  const res = await api.request<{ divergencias: DivergenceRow[] }>(
    'GET',
    `/deposits/${depositoId}/divergences`,
  );
  await upsertDivergences(res.divergencias);
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
      const docs = await enviarDocumentosPendentes(api, d.id, report);
      enviadas += docs.enviadas;
      errosFila += docs.erros;
    } catch {
      // documento requer conexão — segue com a fila
    }
    try {
      await espelharEnxoval(api, d.id);
      await espelharPecas(api, d.id);
      await espelharEstoque(api, d.id);
      await espelharDivergencias(api, d.id);
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