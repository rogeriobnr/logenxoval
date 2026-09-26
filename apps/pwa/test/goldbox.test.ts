import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { InventoryItemRow } from '@logenxoval/contracts';
import { analisarBaixa } from '../src/lib/goldbox';

const item: InventoryItemRow = {
  id: 'i1',
  depositoId: 'd1',
  codigoSap: '1002341',
  textoBreve: 'Camiseta Básica',
  qtdOficial: 20,
  qtdAtual: 10,
  utilizacaoLivre: true,
  usuarioResponsavel: 'MEC-001',
  status: 'ATIVO',
  versao: 'v1',
  criadoEm: '2026-09-25T00:00:00.000Z',
  atualizadoEm: '2026-09-25T00:00:00.000Z',
};

test('sem item → sem_item', () => {
  assert.deepEqual(analisarBaixa(null, '1'), { status: 'sem_item' });
});

test('mostra disponível e projeção neutra com valor inválido (0)', () => {
  const a = analisarBaixa(item, '0');
  assert.equal(a.status, 'item');
  if (a.status === 'item') {
    assert.equal(a.disponivel, 10);
    assert.equal(a.validada, false);
    assert.equal(a.vaiNegativar, false);
    assert.equal(a.aposBaixa, 10);
  }
});

test('baixa dentro do saldo → não negativa e projeta o saldo', () => {
  const a = analisarBaixa(item, '3');
  assert.equal(a.status, 'item');
  if (a.status === 'item') {
    assert.equal(a.validada, true);
    assert.equal(a.aposBaixa, 7);
    assert.equal(a.vaiNegativar, false);
  }
});

test('baixa exata ao saldo → zera sem negativar', () => {
  const a = analisarBaixa(item, '10');
  if (a.status === 'item') {
    assert.equal(a.aposBaixa, 0);
    assert.equal(a.vaiNegativar, false);
  }
});

test('baixa maior que o disponível → avisa negativação', () => {
  const a = analisarBaixa(item, '12');
  assert.equal(a.status, 'item');
  if (a.status === 'item') {
    assert.equal(a.vaiNegativar, true);
    assert.equal(a.aposBaixa, -2);
  }
});

test('quantidade inválida (texto/não numérica) não negativa', () => {
  const a = analisarBaixa(item, 'abc');
  if (a.status === 'item') {
    assert.equal(a.validada, false);
    assert.equal(a.vaiNegativar, false);
  }
});