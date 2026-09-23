import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SyncQueueRow } from '@logenxoval/contracts';
import { operacoesDaFila, processarRespostaFila } from '../src/lib/fila';

const ENT: SyncQueueRow = {
  id: 'x',
  operationId: 'x',
  entidade: 'BAIXA',
  acao: 'CREATE',
  payload: {},
  criadoEm: '2026-09-22T10:00:00.000Z',
  tentativas: 0,
  proximaTentativaEm: '2026-09-22T10:00:00.000Z',
  status: 'PENDENTE',
};

function item(over: Partial<SyncQueueRow> = {}): SyncQueueRow {
  return { ...ENT, ...over };
}

test('operacoesDaFila: seleciona somente PENDENTE/ERRO do depósito', () => {
  const fila = [
    item({ operationId: 'a', payload: { depositoId: 'd1' } }),
    item({ operationId: 'b', payload: { depositoId: 'd1' }, status: 'ERRO' }),
    item({ operationId: 'c', payload: { depositoId: 'd2' } }),
    item({ operationId: 'd', payload: { depositoId: 'd1' }, status: 'ENVIADO' }),
    item({ operationId: 'e', payload: { depositoId: 'd1' }, status: 'ENVIANDO' }),
  ];
  const r = operacoesDaFila(fila, 'd1');
  assert.deepEqual(r.map((q) => q.operationId).sort(), ['a', 'b']);
});

test('operacoesDaFila: ordena por criadoEm ascendente', () => {
  const fila = [
    item({ operationId: 'later', payload: { depositoId: 'd1' }, criadoEm: '2026-09-22T12:00:00.000Z' }),
    item({ operationId: 'early', payload: { depositoId: 'd1' }, criadoEm: '2026-09-22T09:00:00.000Z' }),
  ];
  const r = operacoesDaFila(fila, 'd1');
  assert.equal(r[0].operationId, 'early');
});

test('processarRespostaFila: acks OK/JA_PROCESSADO → ok, erros → map, conflitos → set', () => {
  const operacoes = [{ operationId: 'ok' }, { operationId: 'dup' }, { operationId: 'bad' }, { operationId: 'conf' }];
  const res = processarRespostaFila(operacoes, {
    acks: [
      { operationId: 'ok', status: 'OK' },
      { operationId: 'dup', status: 'JA_PROCESSADO' },
    ],
    errors: [{ operationId: 'bad', code: 'ITEM_INDISPONIVEL', message: 'Item não encontrado' }],
    conflicts: [{ operationId: 'conf', tipo: 'CONFLITO_PENDENTE' }],
  });
  assert.deepEqual([...res.ok].sort(), ['dup', 'ok']);
  assert.equal(res.erros.get('bad'), 'Item não encontrado');
  assert.ok(res.conflitos.has('conf'));
});

test('processarRespostaFila: operação sem ack vira erro "reenviar"', () => {
  const res = processarRespostaFila([{ operationId: 'x' }], { acks: [] });
  assert.ok(res.erros.has('x'));
});