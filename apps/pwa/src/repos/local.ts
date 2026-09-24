import type {
  AuditLogRow,
  ConsumableRow,
  ConversionSuggestionRow,
  DepositVersionRow,
  DepositoRow,
  DivergenceRow,
  DocumentRow,
  DocumentoTipo,
  GoldboxMovementRow,
  InventoryItemRow,
  OrigemSparePart,
  PpeItemRow,
  RequestRow,
  RequestStatus,
  SolicitacaoTipo,
  SparePartMovementRow,
  SparePartRow,
  SugestaoStatus,
  SyncQueueRow,
  SyncStateRow,
  TipoMovimentacaoSparePart,
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
  sugestoesPendentes: number;
}

export async function getPendenciasLocais(depositoId?: string): Promise<PendenciasLocais> {
  const fila = await contarPendenciasFila();
  const errosFila = await db.syncQueue.where('status').equals('ERRO').count();
  const divergencias = (await listDivergenciasAbertas(depositoId)).length;
  const negativos = (await listItensNegativos()).length;
  const sugestoes = depositoId
    ? (await listSuggestionsLocal(depositoId)).filter((s) => s.status === 'PENDENTE').length
    : 0;
  return { fila, divergencias, negativos, errosFila, sugestoesPendentes: sugestoes };
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
      db.requests,
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
      await db.requests.where('depositoId').equals(depositoId).delete();
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

const LOCAL_ID = 'local:';

export async function upsertSpareParts(pecas: SparePartRow[]): Promise<void> {
  await db.transaction('rw', db.spareParts, async () => {
    for (const p of pecas) await db.spareParts.put(p);
  });
}

export async function upsertConversionSuggestions(sugestoes: ConversionSuggestionRow[]): Promise<void> {
  await db.transaction('rw', db.conversionSuggestions, async () => {
    for (const s of sugestoes) await db.conversionSuggestions.put(s);
  });
}

/**
 * Lista peças avulsas do espelho local. Entradas otimistas criadas offline usam
 * id `local:...`; quando o servidor já tem a verdade (id real) para o mesmo SAP,
 * a linha espelhada prevalece (evita duplicidade na listagem).
 */
export async function listSparePartsLocal(depositoId: string): Promise<SparePartRow[]> {
  const rows = await db.spareParts.where('depositoId').equals(depositoId).toArray();
  const porSap = new Map<string, SparePartRow>();
  for (const p of rows) {
    const atual = porSap.get(p.codigoSap);
    if (!atual) {
      porSap.set(p.codigoSap, p);
      continue;
    }
    const preferido = p.id.startsWith(LOCAL_ID);
    const atualPreferido = atual.id.startsWith(LOCAL_ID);
    if (!preferido && atualPreferido) porSap.set(p.codigoSap, p);
    else if (preferido === atualPreferido && !atualPreferido) porSap.set(p.codigoSap, p);
  }
  return Array.from(porSap.values()).sort((a, b) => a.codigoSap.localeCompare(b.codigoSap));
}

export async function listSuggestionsLocal(depositoId: string): Promise<ConversionSuggestionRow[]> {
  return db.conversionSuggestions.where('depositoId').equals(depositoId).toArray();
}

/** Fase 08: grava logs de auditoria no espelho local (leitura offline do calendário). */
export async function upsertAuditLogs(logs: AuditLogRow[]): Promise<void> {
  await db.transaction('rw', db.auditLogs, async () => {
    for (const l of logs) await db.auditLogs.put(l);
  });
}

export async function listAuditLogsLocal(depositoId: string): Promise<AuditLogRow[]> {
  const logs = await db.auditLogs.where('depositoId').equals(depositoId).toArray();
  return logs.sort((a, b) => b.dataHora.localeCompare(a.dataHora));
}

export async function upsertDocuments(documentos: DocumentRow[]): Promise<void> {
  await db.transaction('rw', db.documents, async () => {
    for (const d of documentos) await db.documents.put(d);
  });
}

export async function listDocumentsLocal(depositoId: string): Promise<DocumentRow[]> {
  const docs = await db.documents.where('depositoId').equals(depositoId).toArray();
  return docs.sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
}

export interface DocumentoOfflineArgs {
  operationId: string;
  depositoId: string;
  tipo: DocumentoTipo;
  nome: string;
  mime: string;
  tamanho: number;
  hashDocumento: string;
  bytes: ArrayBuffer;
  usuarioId: string;
  matricula: string;
}

/**
 * Captura offline: preserva o documento (blob + hash) no espelho local e
 * enfileira o upload para quando houver conexão (docs 6.1 e 12.6).
 */
export async function registrarDocumentoOffline(args: DocumentoOfflineArgs): Promise<void> {
  const criadoEm = new Date().toISOString();
  const localId = `${LOCAL_ID}${args.operationId}`;
  await db.transaction('rw', [db.documents, db.syncQueue], async () => {
    await db.documents.put({
      id: localId,
      depositoId: args.depositoId,
      tipo: args.tipo,
      nome: args.nome,
      mime: args.mime,
      tamanho: args.tamanho,
      hashDocumento: args.hashDocumento,
      bytes: new Blob([args.bytes], { type: args.mime }),
      criadoEm,
      usuarioId: args.usuarioId,
      matricula: args.matricula,
    });
    await db.syncQueue.put({
      id: args.operationId,
      operationId: args.operationId,
      entidade: 'DOCUMENTO',
      acao: 'CREATE',
      payload: {
        depositoId: args.depositoId,
        nome: args.nome,
        mime: args.mime,
        tamanho: args.tamanho,
        hashDocumento: args.hashDocumento,
      },
      criadoEm,
      tentativas: 0,
      proximaTentativaEm: criadoEm,
      status: 'PENDENTE',
    });
  });
}

export interface EntradaPecaOfflineArgs {
  operationId: string;
  depositoId: string;
  codigoSap: string;
  descricao: string;
  origem: OrigemSparePart;
  quantidade: number;
  observacao?: string;
  usuarioId: string;
  nomeCompleto: string;
  matricula: string;
  dispositivo: string;
  assinaturaMatricula: string;
}

/** Entrada otimista de peça avulsa offline: movimento ENTRADA local + fila. */
export async function registrarEntradaPecaOffline(args: EntradaPecaOfflineArgs): Promise<void> {
  const dataHora = new Date().toISOString();
  const localId = `${LOCAL_ID}${args.codigoSap}`;
  await db.transaction('rw', [db.spareParts, db.sparePartMovements, db.syncQueue], async () => {
    const atual = await db.spareParts.where('[depositoId+codigoSap]').equals([args.depositoId, args.codigoSap]).first();
    const anterior = atual?.quantidadeAtual ?? 0;
    await db.spareParts.put({
      id: atual?.id ?? localId,
      depositoId: args.depositoId,
      codigoSap: args.codigoSap,
      descricao: args.descricao,
      quantidadeAtual: anterior + args.quantidade,
      origem: args.origem,
      dataEntrada: atual?.dataEntrada ?? dataHora,
      responsavel: atual?.responsavel ?? args.matricula,
      observacao: args.observacao,
      status: 'ATIVO',
    });
    const movimento: SparePartMovementRow = {
      id: args.operationId,
      depositoId: args.depositoId,
      sparePartId: atual?.id ?? localId,
      operationId: args.operationId,
      tipo: 'ENTRADA',
      quantidade: args.quantidade,
      dataHora,
      usuarioId: args.usuarioId,
      matricula: args.matricula,
      motivo: args.observacao,
      estadoAnterior: { quantidade: anterior },
      estadoPosterior: { quantidade: anterior + args.quantidade },
    };
    await db.sparePartMovements.put(movimento);
    await db.syncQueue.put(enfileirar(args, 'SPARE_PART_ENTRADA', dataHora, {
      depositoId: args.depositoId,
      codigoSap: args.codigoSap,
      descricao: args.descricao,
      origem: args.origem,
      quantidade: args.quantidade,
      observacao: args.observacao,
      assinaturaMatricula: args.assinaturaMatricula,
      matriculaConfirmacao: args.matricula,
    }));
  });
}

export interface MovimentoPecaOfflineArgs {
  operationId: string;
  depositoId: string;
  sparePartId: string;
  tipo: Exclude<TipoMovimentacaoSparePart, 'ENTRADA' | 'AJUSTE_AUTORIZADO' | 'CONVERSAO_ACEITA' | 'DEVOLUCAO_CORRECAO'>;
  quantidade: number;
  motivo?: string;
  usuarioId: string;
  matricula: string;
  dispositivo: string;
  assinaturaMatricula: string;
}

/** Saída/descarte otimista offline: debita o saldo local + movimento + fila. */
export async function registrarMovimentoPecaOffline(args: MovimentoPecaOfflineArgs): Promise<void> {
  const dataHora = new Date().toISOString();
  await db.transaction('rw', [db.spareParts, db.sparePartMovements, db.syncQueue], async () => {
    const atual = await db.spareParts.get(args.sparePartId);
    if (!atual) throw new Error('Peça avulsa não encontrada no dispositivo');
    const anterior = atual.quantidadeAtual;
    const novo = Math.max(0, anterior - args.quantidade);
    await db.spareParts.put({ ...atual, quantidadeAtual: novo });
    await db.sparePartMovements.put({
      id: args.operationId,
      depositoId: args.depositoId,
      sparePartId: args.sparePartId,
      operationId: args.operationId,
      tipo: args.tipo,
      quantidade: args.quantidade,
      dataHora,
      usuarioId: args.usuarioId,
      matricula: args.matricula,
      motivo: args.motivo,
      estadoAnterior: { quantidade: anterior },
      estadoPosterior: { quantidade: novo },
    });
    await db.syncQueue.put(enfileirar(args, 'SPARE_PART_SAIDA', dataHora, {
      depositoId: args.depositoId,
      sparePartId: args.sparePartId,
      tipo: args.tipo,
      quantidade: args.quantidade,
      motivo: args.motivo,
      assinaturaMatricula: args.assinaturaMatricula,
      matriculaConfirmacao: args.matricula,
    }));
  });
}

export interface RespostaSugestaoOfflineArgs {
  operationId: string;
  depositoId: string;
  suggestionId: string;
  acao: SugestaoStatus;
  motivo?: string;
  usuarioId: string;
  matricula: string;
  dispositivo: string;
  assinaturaMatricula: string;
}

/** Resposta otimista a uma sugestão de conversão offline: marca local + fila. */
export async function registrarRespostaSugestaoOffline(args: RespostaSugestaoOfflineArgs): Promise<void> {
  const dataHora = new Date().toISOString();
  const entidade = args.acao === 'ACEITA' ? 'SUGESTAO_ACEITA' : 'SUGESTAO_RECUSADA';
  await db.transaction('rw', [db.conversionSuggestions, db.syncQueue], async () => {
    const atual = await db.conversionSuggestions.get(args.suggestionId);
    if (atual) {
      await db.conversionSuggestions.put({ ...atual, status: args.acao, motivo: args.motivo });
    }
    await db.syncQueue.put(enfileirar(args, entidade, dataHora, {
      depositoId: args.depositoId,
      suggestionId: args.suggestionId,
      acao: args.acao,
      motivo: args.motivo,
      assinaturaMatricula: args.assinaturaMatricula,
      matriculaConfirmacao: args.matricula,
    }));
  });
}

function enfileirar(
  args: { operationId: string; depositoId: string },
  entidade: string,
  criadoEm: string,
  payload: unknown,
): SyncQueueRow {
  return {
    id: args.operationId,
    operationId: args.operationId,
    entidade,
    acao: 'CREATE',
    payload: { ...(payload as object), depositoId: args.depositoId },
    criadoEm,
    tentativas: 0,
    proximaTentativaEm: criadoEm,
    status: 'PENDENTE',
  };
}

/** Fase 10: espelha consumíveis, EPIs e solicitações no IndexedDB. */
export async function upsertConsumiveis(consumiveis: ConsumableRow[]): Promise<void> {
  await db.transaction('rw', db.consumables, async () => {
    for (const c of consumiveis) await db.consumables.put(c);
  });
}

export async function upsertPpeItems(ppe: PpeItemRow[]): Promise<void> {
  await db.transaction('rw', db.ppeItems, async () => {
    for (const p of ppe) await db.ppeItems.put(p);
  });
}

export async function upsertRequests(requests: RequestRow[]): Promise<void> {
  await db.transaction('rw', db.requests, async () => {
    for (const r of requests) await db.requests.put(r);
  });
}

export async function listConsumiveisLocal(depositoId: string): Promise<ConsumableRow[]> {
  const rows = await db.consumables.where('depositoId').equals(depositoId).toArray();
  return rows.sort((a, b) => a.codigo.localeCompare(b.codigo));
}

export async function listPpeLocal(depositoId: string): Promise<PpeItemRow[]> {
  const rows = await db.ppeItems.where('depositoId').equals(depositoId).toArray();
  return rows.sort((a, b) => a.codigo.localeCompare(b.codigo));
}

export async function listRequestsLocal(depositoId: string): Promise<RequestRow[]> {
  const rows = await db.requests.where('depositoId').equals(depositoId).toArray();
  return rows.sort((a, b) => b.dataEm.localeCompare(a.dataEm));
}

export interface SolicitacaoOfflineArgs {
  operationId: string;
  depositoId: string;
  tipo: SolicitacaoTipo;
  itens: Array<{ qtd: number; codigo: string; descricao: string }>;
  solicitanteId: string;
  matricula: string;
  assinaturaMatricula: string;
}

/**
 * Criação otimista de solicitação offline: registra a linha local (id local:...)
 * e enfileira o envio (fase 10 / docs 12.6). O status permanece RASCUNHO até o
 * flush; a transição era feita pelo usuário antes da sincronização.
 */
export async function registrarSolicitacaoOffline(args: SolicitacaoOfflineArgs): Promise<void> {
  const criadoEm = new Date().toISOString();
  const localId = `${LOCAL_ID}${args.operationId}`;
  const req: RequestRow = {
    id: localId,
    depositoId: args.depositoId,
    tipo: args.tipo,
    solicitanteId: args.solicitanteId,
    matricula: args.matricula,
    status: 'RASCUNHO',
    dataEm: criadoEm,
    itens: args.itens,
  };
  await db.transaction('rw', [db.requests, db.syncQueue], async () => {
    await db.requests.put(req);
    await db.syncQueue.put(enfileirar(args, 'SOLICITACAO', criadoEm, {
      solicitanteId: args.solicitanteId,
      matricula: args.matricula,
      tipo: args.tipo,
      itens: args.itens,
      assinaturaMatricula: args.assinaturaMatricula,
    }));
  });
}

export interface TransicaoSolicitacaoOfflineArgs {
  operationId: string;
  depositoId: string;
  requestId: string;
  para: RequestStatus;
  motivo?: string;
  pin?: string;
  assinaturaMatricula: string;
}

/** Transição otimista offline: atualiza o status local e enfileira o sync (docs 12.6). */
export async function registrarTransicaoSolicitacaoOffline(args: TransicaoSolicitacaoOfflineArgs): Promise<void> {
  const criadoEm = new Date().toISOString();
  await db.transaction('rw', [db.requests, db.syncQueue], async () => {
    const atual = await db.requests.get(args.requestId);
    if (atual) await db.requests.put({ ...atual, status: args.para });
    await db.syncQueue.put(enfileirar(args, 'SOLICITACAO_TRANSICAO', criadoEm, {
      requestId: args.requestId,
      para: args.para,
      motivo: args.motivo,
      pin: args.pin,
      assinaturaMatricula: args.assinaturaMatricula,
    }));
  });
}