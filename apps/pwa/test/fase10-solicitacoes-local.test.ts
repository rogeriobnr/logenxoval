import 'fake-indexeddb/auto';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db/db';
import {
  listConsumiveisLocal,
  listPpeLocal,
  listRequestsLocal,
  registrarSolicitacaoOffline,
  registrarTransicaoSolicitacaoOffline,
  upsertConsumiveis,
  upsertPpeItems,
  upsertRequests,
} from '../src/repos/local';

beforeEach(async () => {
  await db.transaction('rw', db.consumables, db.ppeItems, db.requests, db.syncQueue, async () => {
    await Promise.all([
      db.consumables.clear(),
      db.ppeItems.clear(),
      db.requests.clear(),
      db.syncQueue.clear(),
    ]);
  });
});

test('espelhos locais de consumíveis, EPIs e solicitações (fase 10)', async () => {
  await upsertConsumiveis([
    { id: 'c1', depositoId: 'd1', codigo: 'LUVA-40', descricao: 'Luvas', unidade: 'CZ', quantidade: 10, estoqueAtual: 10, estoqueMinimo: 5, historico: [] },
    { id: 'c2', depositoId: 'd1', codigo: 'AD-ISOL', descricao: 'Adesivo', unidade: 'UN', quantidade: 5, estoqueAtual: 5, estoqueMinimo: 2, historico: [] },
  ]);
  await upsertPpeItems([
    { id: 'p1', depositoId: 'd1', codigo: 'CAP-5', descricao: 'Capacete', unidade: 'unidade', quantidade: 3, estoqueAtual: 3, estoqueMinimo: 2, historico: [] },
  ]);
  await upsertRequests([
    {
      id: 'r1',
      depositoId: 'd1',
      tipo: 'CONSUMIVEL',
      solicitanteId: 'u1',
      matricula: 'F10-MEC',
      status: 'ENVIADA',
      dataEm: '2026-09-23T10:00:00.000Z',
      itens: [{ qtd: 4, codigo: 'LUVA-40', descricao: 'Luvas' }],
    },
    {
      id: 'r-excluida',
      depositoId: 'd1',
      tipo: 'CONSUMIVEL',
      solicitanteId: 'u-admin',
      matricula: 'F10-LDR',
      status: 'EXCLUIDA',
      dataEm: '2026-09-23T09:00:00.000Z',
      itens: [{ qtd: 1, codigo: 'AD-ISOL', descricao: 'Adesivo' }],
    },
  ]);

  assert.equal((await listConsumiveisLocal('d1'))[0].codigo, 'AD-ISOL');
  assert.equal((await listPpeLocal('d1'))[0].codigo, 'CAP-5');
  const reqs = await listRequestsLocal('d1');
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0].status, 'ENVIADA');
});

test('registrarSolicitacaoOffline: espelho id local + fila SOLICITACAO', async () => {
  const op = crypto.randomUUID();
  await registrarSolicitacaoOffline({
    operationId: op,
    depositoId: 'd1',
    tipo: 'EPI',
    itens: [{ qtd: 2, codigo: 'CAP-5', descricao: 'Capacete' }],
    solicitanteId: 'u1',
    matricula: 'F10-MEC',
    assinaturaMatricula: 'F10-MEC',
  });

  const [req] = await listRequestsLocal('d1');
  assert.equal(req.id, `local:${op}`);
  assert.equal(req.status, 'RASCUNHO');
  assert.equal(req.tipo, 'EPI');
  assert.equal(req.itens[0].codigo, 'CAP-5');

  const fila = await filaDoDeposito('d1');
  assert.equal(fila.length, 1);
  assert.equal(fila[0].entidade, 'SOLICITACAO');
  assert.deepEqual(fila[0].payload, {
    depositoId: 'd1',
    solicitanteId: 'u1',
    matricula: 'F10-MEC',
    tipo: 'EPI',
    itens: [{ qtd: 2, codigo: 'CAP-5', descricao: 'Capacete' }],
    assinaturaMatricula: 'F10-MEC',
  });
});

async function filaDoDeposito(depositoId: string) {
  const rows = await db.syncQueue.toArray();
  return rows.filter((q) => (q.payload as { depositoId?: string }).depositoId === depositoId);
}

test('registrarTransicaoSolicitacaoOffline: atualiza espelho + fila SOLICITACAO_TRANSICAO', async () => {
  await upsertRequests([
    {
      id: 'r1',
      depositoId: 'd1',
      tipo: 'CONSUMIVEL',
      solicitanteId: 'u1',
      matricula: 'F10-MEC',
      status: 'RASCUNHO',
      dataEm: '2026-09-23T10:00:00.000Z',
      itens: [{ qtd: 4, codigo: 'LUVA-40', descricao: 'Luvas' }],
    },
  ]);
  const op = crypto.randomUUID();
  await registrarTransicaoSolicitacaoOffline({
    operationId: op,
    depositoId: 'd1',
    requestId: 'r1',
    para: 'ENVIADA',
    assinaturaMatricula: 'F10-MEC',
  });

  const [req] = await listRequestsLocal('d1');
  assert.equal(req.id, 'r1');
  assert.equal(req.status, 'ENVIADA');

  const fila = await filaDoDeposito('d1');
  assert.equal(fila.length, 1);
  assert.equal(fila[0].entidade, 'SOLICITACAO_TRANSICAO');
  assert.deepEqual(fila[0].payload, {
    depositoId: 'd1',
    requestId: 'r1',
    para: 'ENVIADA',
    motivo: undefined,
    naoRecebidos: undefined,
    pin: undefined,
    assinaturaMatricula: 'F10-MEC',
  });
});

test('registrarTransicaoSolicitacaoOffline: RECEBIDA marca itens não recebidos no espelho', async () => {
  await upsertRequests([
    {
      id: 'r2',
      depositoId: 'd1',
      tipo: 'CONSUMIVEL',
      solicitanteId: 'u1',
      matricula: 'F10-MEC',
      status: 'ENVIADA',
      dataEm: '2026-09-23T10:00:00.000Z',
      itens: [
        { qtd: 4, codigo: 'LUVA-40', descricao: 'Luvas' },
        { qtd: 2, codigo: 'AD-ISOL', descricao: 'Adesivo' },
      ],
    },
  ]);
  await registrarTransicaoSolicitacaoOffline({
    operationId: crypto.randomUUID(),
    depositoId: 'd1',
    requestId: 'r2',
    para: 'RECEBIDA',
    naoRecebidos: ['AD-ISOL'],
    assinaturaMatricula: 'F10-LDR',
  });

  const [req] = await listRequestsLocal('d1');
  assert.equal(req.status, 'RECEBIDA');
  assert.equal(req.itens[0].recebido, true);
  assert.equal(req.itens[1].recebido, false);

  const fila = await filaDoDeposito('d1');
  assert.equal(fila[0].entidade, 'SOLICITACAO_TRANSICAO');
  assert.deepEqual((fila[0].payload as { naoRecebidos?: string[] }).naoRecebidos, ['AD-ISOL']);
});