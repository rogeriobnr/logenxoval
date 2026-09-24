import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { InventoryItemRow } from '@logenxoval/contracts';
import {
  confiancaDoCampo,
  extrairLinhas,
  itensParaPublicacao,
  revisarLinhas,
  tamanhoDeDocumento,
} from '../src/lib/ocr';

function item(over: Partial<InventoryItemRow>): InventoryItemRow {
  return {
    id: 'i1',
    depositoId: 'd1',
    codigoSap: '1002341',
    textoBreve: 'PARAFUSO M8X20',
    qtdOficial: 10,
    qtdAtual: 10,
    unidadeMedida: 'PÇ',
    utilizacaoLivre: true,
    status: 'ATIVO',
    versao: 'v1',
    criadoEm: '2026-09-01T00:00:00.000Z',
    atualizadoEm: '2026-09-01T00:00:00.000Z',
    usuarioResponsavel: 'F7-LDR',
    ...over,
  };
}

test('extrairLinhas: SAP 8 dígitos + quantidade isolada => confiança ALTA', () => {
  const linhas = extrairLinhas('10023410 | PARAFUSO M8X20 | 10');
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].codigoSap, '10023410');
  assert.equal(linhas[0].quantidade, 10);
  assert.equal(linhas[0].confiancaCodigo, 'ALTA');
  assert.equal(linhas[0].confiancaQtd, 'ALTA');
});

test('extrairLinhas: linha sem SAP => BAIXA/AUSENTE para revisão', () => {
  const linhas = extrairLinhas('PARAFUSO M8X20 10');
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].codigoSap, '');
  assert.equal(linhas[0].confiancaCodigo, 'BAIXA');
  assert.equal(linhas[0].confiancaQtd, 'BAIXA');
});

test('extrairLinhas: ignora linhas vazias', () => {
  const linhas = extrairLinhas('\n  \n1002341 DX 2\n\n');
  assert.equal(linhas.length, 1);
});

test('revisarLinhas: sinaliza novo, alterado por qtd, removido e sem alteração', () => {
  const folha = extrairLinhas('1002341 | PARAFUSO M8X20 | 12\n1002342 | PORCA M8 | 20\n2000001 | ANILHA 10 | 5');
  const atuais = [
    item({ codigoSap: '1002341', textoBreve: 'PARAFUSO M8X20', qtdOficial: 10 }),
    item({ codigoSap: '1002342', textoBreve: 'PORCA M8', qtdOficial: 20 }),
    item({ codigoSap: '9999999', textoBreve: 'REMOVIDA', qtdOficial: 3 }),
  ];
  const { linhas, comparacao } = revisarLinhas(folha, atuais);

  const sap2341 = linhas.find((l) => l.codigoSap === '1002341')!;
  assert.ok(!sap2341.ehNovo);

  assert.equal(linhas.find((l) => l.codigoSap === '2000001')!.ehNovo, true);
  assert.equal(comparacao.novos, 1);
  assert.equal(comparacao.qtdAlterados, 1);
  assert.equal(comparacao.removidos, 1);
  assert.equal(comparacao.semAlteracao, 1);
});

test('revisarLinhas: duplicado marcado quando SAP se repete', () => {
  const folha = extrairLinhas('1002341 A 5\n1002341 A 6');
  const { linhas, comparacao } = revisarLinhas(folha, []);
  assert.equal(linhas.filter((l) => l.duplicado).length, 1);
  assert.equal(comparacao.duplicados, 1);
});

test('itensParaPublicacao: usa qtdOficial = qtdAtual e filtra linhas sem código', () => {
  const folha = extrairLinhas('1002341 | PARAFUSO | 7\nDESCRICAO SEM CODIGO 3');
  const { linhas } = revisarLinhas(folha, []);
  const itens = itensParaPublicacao(linhas);
  assert.equal(itens.length, 1);
  assert.equal(itens[0].codigoSap, '1002341');
  assert.equal(itens[0].qtdOficial, 7);
  assert.equal(itens[0].qtdAtual, 7);
});

test('confiancaDoCampo: ALTA ok, BAIXA warn, demais err', () => {
  assert.equal(confiancaDoCampo('ALTA'), 'ok');
  assert.equal(confiancaDoCampo('BAIXA'), 'warn');
  assert.equal(confiancaDoCampo('AUSENTE'), 'err');
  assert.equal(confiancaDoCampo('INVALIDO'), 'err');
});

test('tamanhoDeDocumento: identifica FOTO e PDF pelo MIME', () => {
  const foto = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
  const pdf = new File(['%PDF'], 'b.pdf', { type: 'application/pdf' });
  assert.equal(tamanhoDeDocumento(foto).tipo, 'FOTO');
  assert.equal(tamanhoDeDocumento(pdf).tipo, 'PDF');
});