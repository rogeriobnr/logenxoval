import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLinhasEnxoval } from '../src/lib/enxoval';

test('parseLinhasEnxoval: linha válida completa', () => {
  const r = parseLinhasEnxoval('1002341|Parafuso M8x20|10|pç');
  assert.equal(r.erros.length, 0);
  assert.equal(r.itens.length, 1);
  assert.deepEqual(r.itens[0], {
    codigoSap: '1002341',
    textoBreve: 'Parafuso M8x20',
    qtdOficial: 10,
    unidadeMedida: 'pç',
  });
});

test('parseLinhasEnxoval: unidade opcional e ignorando linhas vazias', () => {
  const r = parseLinhasEnxoval('A|B|2\n\nC|D|3|L\n');
  assert.equal(r.itens.length, 2);
  assert.equal(r.itens[0].unidadeMedida, undefined);
  assert.equal(r.itens[1].unidadeMedida, 'L');
});

test('parseLinhasEnxoval: aceita vírgula como separador decimal de quantidade', () => {
  const r = parseLinhasEnxoval('X|Item|2,0');
  assert.equal(r.itens[0].qtdOficial, 2);
});

test('parseLinhasEnxoval: linha incompleta gera erro', () => {
  const r = parseLinhasEnxoval('1002341|sem quantidade');
  assert.equal(r.itens.length, 0);
  assert.equal(r.erros.length, 1);
  assert.match(r.erros[0], /Linha 1/);
});

test('parseLinhasEnxoval: quantidade negativa ou não inteira rejeitada', () => {
  const r1 = parseLinhasEnxoval('A|B|-3');
  assert.equal(r1.itens.length, 0);
  const r2 = parseLinhasEnxoval('A|B|1.5');
  assert.equal(r2.itens.length, 0);
  assert.equal(r2.erros.length, 1);
});

test('parseLinhasEnxoval: mistura de válidas e inválidas mantém as válidas', () => {
  const r = parseLinhasEnxoval('A|Primeiro|5\nB|Segundo\nC|Terceiro|9|pç');
  assert.equal(r.itens.length, 2);
  assert.equal(r.erros.length, 1);
  assert.equal(r.itens[0].codigoSap, 'A');
  assert.equal(r.itens[1].codigoSap, 'C');
});