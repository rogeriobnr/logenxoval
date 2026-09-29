import 'fake-indexeddb/auto';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SyncQueueRow } from '@logenxoval/contracts';
import { db } from '../src/db/db';
import {
  listOperacoesComErro,
  marcarFalhaFila,
  reativarOperacaoFila,
} from '../src/repos/local';
import { ENTIDADE_FILA_LABEL, orientacaoParaErro, resumoOperacaoFila } from '../src/lib/filaErros';

function row(over: Partial<SyncQueueRow> & { operationId: string }): SyncQueueRow {
  return {
    id: over.operationId,
    entidade: 'BAIXA',
    acao: 'CREATE',
    payload: {},
    criadoEm: '2026-09-23T10:00:00.000Z',
    tentativas: 0,
    proximaTentativaEm: '2026-09-23T10:00:00.000Z',
    status: 'PENDENTE',
    ...over,
  };
}

beforeEach(async () => {
  await db.syncQueue.clear();
});

test('listOperacoesComErro: só ERRO do depósito, mais tentadas primeiro', async () => {
  await db.syncQueue.bulkPut([
    row({ operationId: 'a', status: 'ERRO', tentativas: 1, payload: { depositoId: 'd1' } }),
    row({ operationId: 'b', status: 'ERRO', tentativas: 5, payload: { depositoId: 'd1' } }),
    row({ operationId: 'c', status: 'PENDENTE', payload: { depositoId: 'd1' } }),
    row({ operationId: 'd', status: 'ERRO', tentativas: 9, payload: { depositoId: 'd2' } }),
  ]);

  const d1 = await listOperacoesComErro('d1');
  assert.deepEqual(d1.map((q) => q.operationId), ['b', 'a']);
  const todos = await listOperacoesComErro();
  assert.equal(todos.length, 3);
});

test('reativarOperacaoFila: volta para PENDENTE e zera o erro', async () => {
  await db.syncQueue.put(row({ operationId: 'x', status: 'ERRO', tentativas: 4, erro: 'Saldo insuficiente' }));
  await reativarOperacaoFila('x');

  const q = await db.syncQueue.get('x');
  assert.equal(q?.status, 'PENDENTE');
  assert.equal(q?.tentativas, 0);
  assert.equal(q?.erro, undefined);
  assert.equal((await listOperacoesComErro()).length, 0);
});

test('marcarFalhaFila: acumula tentativas e guarda o erro', async () => {
  await db.syncQueue.put(row({ operationId: 'y' }));
  await marcarFalhaFila('y', 'conflito');
  await marcarFalhaFila('y', 'conflito');
  const q = await db.syncQueue.get('y');
  assert.equal(q?.status, 'ERRO');
  assert.equal(q?.tentativas, 2);
  assert.equal(q?.erro, 'conflito');
});

test('orientacaoParaErro: traduz os erros comuns em ação prática', () => {
  assert.match(orientacaoParaErro('Saldo insuficiente para baixa').orientacao, /Goldbox|descart/i);
  assert.match(orientacaoParaErro('PIN inválido').titulo, /PIN/i);
  assert.match(orientacaoParaErro('Matrícula de confirmação não confere').titulo, /matrícula/i);
  assert.match(orientacaoParaErro('registro não encontrada').orientacao, /descarte/i);
  assert.match(orientacaoParaErro(undefined).titulo, /sem detalhe/i);
});

test('resumoOperacaoFila: descreve a baixa e a solicitação', () => {
  assert.equal(
    resumoOperacaoFila(row({ operationId: 'z', entidade: 'BAIXA', payload: { codigoSap: 'A1', quantidade: 3 } })),
    'A1 · 3 un.',
  );
  assert.equal(
    resumoOperacaoFila(
      row({
        operationId: 'w',
        entidade: 'SOLICITACAO',
        payload: { itens: [{ qtd: 2, codigo: 'LUVA-40' }] },
      }),
    ),
    '2x LUVA-40',
  );
  assert.equal(ENTIDADE_FILA_LABEL.SOLICITACAO_TRANSICAO, 'Situação da solicitação');
});
