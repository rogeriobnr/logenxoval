import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { InspectionItemRow } from '@logenxoval/contracts';
import { statusDeItem, filtrarItens, resumoDeItens, TIPO_CORRECAO_LABEL } from '../src/lib/conferencia';

function item(over: Partial<InspectionItemRow> = {}): InspectionItemRow {
  return {
    id: 'i1',
    inspectionId: 'ins',
    depositoId: 'd1',
    codigoSap: '1002341',
    qtdOficial: 10,
    qtdSistema: 10,
    qtdFisica: 8,
    diferenca: -2,
    status: 'DIVERGENTE',
    corregido: false,
    ...over,
  };
}

test('statusDeItem: igual → OK, diferente → DIVERGENTE', () => {
  assert.equal(statusDeItem(5, 5), 'OK');
  assert.equal(statusDeItem(5, 4), 'DIVERGENTE');
});

test('filtrarItens: por status e busca', () => {
  const itens = [
    item({ id: 'a', status: 'DIVERGENTE' }),
    item({ id: 'b', status: 'OK' }),
    item({ id: 'c', status: 'PENDENTE' }),
    item({ id: 'd', status: 'DIVERGENTE', corregido: true }),
  ];
  assert.equal(filtrarItens(itens, 'todos', '').length, 4);
  assert.deepEqual(filtrarItens(itens, 'divergentes', '').map((i) => i.id).sort(), ['a', 'd']);
  assert.deepEqual(filtrarItens(itens, 'corrigidos', '').map((i) => i.id), ['d']);
  assert.deepEqual(filtrarItens(itens, 'conferidos', '').map((i) => i.id), ['b']);
  assert.deepEqual(filtrarItens(itens, 'todos', '2341').map((i) => i.id), ['a', 'b', 'c', 'd']);
});

test('resumoDeItens: contabiliza status e correções', () => {
  const r = resumoDeItens([
    item({ status: 'OK' }),
    item({ status: 'DIVERGENTE' }),
    item({ status: 'DIVERGENTE', corregido: true }),
    item({ status: 'PENDENTE' }),
  ]);
  assert.deepEqual(r, { total: 4, ok: 1, divergentes: 2, pendentes: 1, corrigidos: 1 });
});

test('TIPO_CORRECAO_LABEL cobre todos os tipos', () => {
  assert.equal(typeof TIPO_CORRECAO_LABEL.CORRIGIR_COM_PECA_AVULSA, 'string');
  assert.equal(Object.keys(TIPO_CORRECAO_LABEL).length, 5);
});