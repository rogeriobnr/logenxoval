import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RequestRow } from '@logenxoval/contracts';
import {
  acoesDaSolicitacao,
  filtrarPorBusca,
  resumoDeEstoque,
  solicitarMarkdown,
  REQUEST_STATUS_LABEL,
} from '../src/lib/estoque';

function req(over: Partial<RequestRow> = {}): RequestRow {
  return {
    id: 'r1',
    depositoId: 'd1',
    tipo: 'CONSUMIVEL',
    solicitanteId: 'u-dono',
    matricula: 'F10-MEC',
    status: 'RASCUNHO',
    dataEm: new Date().toISOString(),
    itens: [
      { qtd: 4, codigo: 'LUVA-40', descricao: 'Luvas descartáveis' },
      { qtd: 2, codigo: 'AD-ISOL', descricao: 'Adesivo isolante' },
    ],
    ...over,
  };
}

test('acoesDaSolicitacao: dono controla rascunho→pronta→enviada', () => {
  const dono = acoesDaSolicitacao(req(), 'MECANICO', 'u-dono');
  assert.deepEqual(
    dono.map((a) => a.para),
    ['PRONTA_PARA_ENVIO', 'CANCELADA'],
  );

  const pronta = acoesDaSolicitacao(
    req({ status: 'PRONTA_PARA_ENVIO' }),
    'MECANICO',
    'u-dono',
  );
  assert.deepEqual(
    pronta.map((a) => a.para),
    ['ENVIADA', 'CANCELADA'],
  );
});

test('acoesDaSolicitacao: liderança aprova/atende exige PIN; mecânico não vê essas ações', () => {
  const lider = acoesDaSolicitacao(req({ status: 'RECEBIDA_PELA_LIDERANCA' }), 'LIDER', 'u-outro');
  const aprova = lider.find((a) => a.para === 'APROVADA');
  assert.ok(aprova);
  assert.equal(aprova.precisaPin, true);

  const mec = acoesDaSolicitacao(req({ status: 'RECEBIDA_PELA_LIDERANCA' }), 'MECANICO', 'u-dono');
  assert.equal(mec.length, 0);
});

test('acoesDaSolicitacao: quem não é dono não controla rascunho', () => {
  const outras = acoesDaSolicitacao(req(), 'MECANICO', 'u-outro');
  assert.equal(outras.length, 0);
});

test('solicitarMarkdown: linhas com itens, status e assinatura (wireframe 10.6)', () => {
  const md = solicitarMarkdown(req());
  assert.match(md, /SOLICITAÇÃO/);
  assert.match(md, /4x LUVA-40 — Luvas descartáveis/);
  assert.match(md, /F10-MEC/);
  assert.ok(md.includes(REQUEST_STATUS_LABEL.RASCUNHO));
});

test('resumoDeEstoque: total, unidades e itens abaixo do mínimo', () => {
  const r = resumoDeEstoque([
    { estoqueAtual: 10, estoqueMinimo: 5 },
    { estoqueAtual: 2, estoqueMinimo: 5 },
  ]);
  assert.equal(r.totalItens, 2);
  assert.equal(r.totalUnidades, 12);
  assert.equal(r.abaixoMinimo, 1);
});

test('filtrarPorBusca: escapa espaços e é case-insensitive', () => {
  const rows = [{ codigo: 'LUVA-40' }, { codigo: 'CAP-5' }];
  assert.equal(filtrarPorBusca(rows, '  luva ', (r) => r.codigo).length, 1);
  assert.equal(filtrarPorBusca(rows, '', (r) => r.codigo).length, 2);
});
