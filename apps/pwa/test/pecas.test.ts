import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SparePartRow } from '@logenxoval/contracts';
import {
  qtdSugerida,
  filtrarPecas,
  resumoDePecas,
  SUGESTAO_STATUS_LABEL,
  ORIGEM_SPARE_PART_LABEL,
} from '../src/lib/pecas';

function peca(over: Partial<SparePartRow> = {}): SparePartRow {
  return {
    id: 'p1',
    depositoId: 'd1',
    codigoSap: '1002341',
    descricao: 'Parafuso M8x20',
    quantidadeAtual: 3,
    origem: 'BACKLOG',
    dataEntrada: '2026-09-01T10:00:00.000Z',
    responsavel: 'F7-LDR',
    status: 'ATIVO',
    ...over,
  };
}

test('qtdSugerida: respeita limite do déficit e do disponível', () => {
  assert.equal(qtdSugerida(3, 10, 2), 3);
  assert.equal(qtdSugerida(99, 10, 2), 8);
  assert.equal(qtdSugerida(5, 10, 10), 0);
  assert.equal(qtdSugerida(0, 10, 2), 0);
  assert.equal(qtdSugerida(5, 10, 12), 0);
});

test('filtrarPecas: busca por SAP/descrição e soComSaldo', () => {
  const pecas = [
    peca(),
    peca({ id: 'p2', codigoSap: '1002344', descricao: 'Arruela M8', quantidadeAtual: 0 }),
  ];
  assert.equal(filtrarPecas(pecas, { busca: 'arruela', soComSaldo: false }).length, 1);
  assert.equal(filtrarPecas(pecas, { busca: '10023', soComSaldo: false }).length, 2);
  assert.equal(filtrarPecas(pecas, { busca: '', soComSaldo: true }).length, 1);
});

test('resumoDePecas: total, itens e com saldo', () => {
  const r = resumoDePecas([peca(), peca({ id: 'p2', quantidadeAtual: 0 }), peca({ id: 'p3', quantidadeAtual: 5 })]);
  assert.equal(r.total, 3);
  assert.equal(r.totalItens, 8);
  assert.equal(r.comSaldo, 2);
});

test('rótulos de sugestões e origens', () => {
  assert.equal(SUGESTAO_STATUS_LABEL.PENDENTE, 'Pendente');
  assert.equal(ORIGEM_SPARE_PART_LABEL.BACKLOG, 'Backlog (material parado)');
});