import 'fake-indexeddb/auto';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db/db';
import { listDivergenciasAbertas, upsertDivergences, upsertInventoryItems } from '../src/repos/local';
import { espelharDivergencias } from '../src/services/sync';
import type { ApiClient } from '../src/lib/api';

beforeEach(async () => {
  await db.transaction('rw', db.divergences, db.inventoryItems, async () => {
    await Promise.all([db.divergences.clear(), db.inventoryItems.clear()]);
  });
});

test('upsertDivergences espelha pendências e listDivergenciasAbertas filtra só ABERTA (fase 19)', async () => {
  await upsertDivergences([
    {
      id: 'd1',
      depositoId: 'd1',
      codigoSap: '1002341',
      descricao: 'Parafuso M8x20',
      tipo: 'REPOSICAO',
      quantidade: 2,
      status: 'ABERTA',
      criadoEm: '2026-09-26T08:00:00.000Z',
      criadoPor: 'F9-LDR',
    },
    {
      id: 'd2',
      depositoId: 'd1',
      codigoSap: '1002341',
      descricao: 'Parafuso M8x20',
      tipo: 'REPOSICAO',
      quantidade: 0,
      status: 'RESOLVIDA',
      criadoEm: '2026-09-25T08:00:00.000Z',
      criadoPor: 'F9-LDR',
      resolvidoEm: '2026-09-25T10:00:00.000Z',
      resolvidoPor: 'F9-LDR',
    },
  ]);

  const abertas = await listDivergenciasAbertas('d1');
  assert.equal(abertas.length, 1);
  assert.equal(abertas[0].id, 'd1');
  assert.equal(abertas[0].status, 'ABERTA');
  assert.equal(abertas[0].descricao, 'Parafuso M8x20');
});

test('espelharDivergencias traz as pendências do servidor para o espelho local', async () => {
  const api = {
    request: async () => ({
      divergencias: [
        {
          id: 'srv-1',
          depositoId: 'd1',
          codigoSap: '1002343',
          descricao: 'Arruela M8',
          tipo: 'REPOSICAO',
          quantidade: 3,
          status: 'ABERTA',
          criadoEm: '2026-09-26T09:00:00.000Z',
          criadoPor: 'F9-LDR',
        },
      ],
    }),
  } as unknown as ApiClient;

  await espelharDivergencias(api, 'd1');
  const abertas = await listDivergenciasAbertas('d1');
  assert.equal(abertas.length, 1);
  assert.equal(abertas[0].id, 'srv-1');
  assert.equal(abertas[0].codigoSap, '1002343');
  assert.equal(abertas[0].quantidade, 3);
});

test('dashboard combina pendência com a descrição do enxoval local (mirror)', async () => {
  await upsertInventoryItems([
    {
      id: 'i1',
      depositoId: 'd1',
      codigoSap: '1002341',
      textoBreve: 'Parafuso M8x20',
      qtdOficial: 10,
      qtdAtual: 8,
      utilizacaoLivre: true,
      usuarioResponsavel: 'F9-LDR',
      status: 'ATIVO',
      versao: 'v1',
      criadoEm: '2026-09-26T00:00:00.000Z',
      atualizadoEm: '2026-09-26T00:00:00.000Z',
    },
  ]);
  await upsertDivergences([
    {
      id: 'd1',
      depositoId: 'd1',
      codigoSap: '1002341',
      tipo: 'REPOSICAO',
      quantidade: 2,
      status: 'ABERTA',
      criadoEm: '2026-09-26T08:00:00.000Z',
      criadoPor: 'F9-LDR',
    },
  ]);

  const abertas = await listDivergenciasAbertas('d1');
  assert.equal(abertas.length, 1);
  assert.equal(abertas[0].status, 'ABERTA');
});