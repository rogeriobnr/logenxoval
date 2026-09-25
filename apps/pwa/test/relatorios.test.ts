import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GoldboxMovementRow, InventoryItemRow } from '@logenxoval/contracts';
import {
  formatarData,
  relatorioAuditLogs,
  relatorioConsumiveis,
  relatorioDivergencias,
  relatorioEnxoval,
  relatorioMovimentacoes,
  relatorioSolicitacoes,
  type RelatorioTabela,
} from '../src/lib/relatorios';
import { gerarPdf, layoutPng } from '../src/lib/exportar';

function item(over: Partial<InventoryItemRow> = {}): InventoryItemRow {
  return {
    id: 'i1',
    depositoId: 'd1',
    codigoSap: '00001234',
    materialId: 'm1',
    textoBreve: 'Luva de segurança',
    qtdOficial: 50,
    qtdAtual: 42,
    utilizacaoLivre: false,
    estoqueMinimo: 10,
    status: 'ATIVO',
    versao: 'v1',
    criadoEm: '2026-09-20T10:00:00.000Z',
    atualizadoEm: '2026-09-20T10:00:00.000Z',
    usuarioResponsavel: 'F11',
    ...over,
  };
}

function mov(over: Partial<GoldboxMovementRow> = {}): GoldboxMovementRow {
  return {
    id: 'm1',
    operationId: 'm1',
    depositoId: 'd1',
    codigoSap: '00001234',
    descricao: 'Luva de segurança',
    quantidade: 4,
    dataHora: '2026-09-20T10:30:00.000Z',
    usuarioId: 'u1',
    nomeCompleto: 'Mecânico Um',
    matricula: 'F11-MEC',
    reposicao: false,
    origem: 'ONLINE',
    dispositivo: 'dev-1',
    ...over,
  };
}

test('relatorioEnxoval: tabela com colunas, ordenação por SAP e rodapé (docs 4.2)', () => {
  const r = relatorioEnxoval(
    [item({ codigoSap: '00009999' }), item({ codigoSap: '00001111' })],
    'Dep A',
    'LE-01',
    '12',
  );
  assert.equal(r.titulo, 'Enxoval');
  assert.match(r.subtitulo, /Dep A \(LE-01\) · Versão 12/);
  assert.equal(r.linhas[0][0], '00001111');
  assert.equal(r.linhas[0][3], '42');
  assert.match(r.rodape ?? '', /2 item/);
});

test('relatorioMovimentacoes: filtros por período, tipo e total (docs 4.5)', () => {
  const base = [
    mov({ dataHora: '2026-09-19T10:00:00.000Z', quantidade: 4 }),
    mov({ dataHora: '2026-09-20T10:00:00.000Z', quantidade: 6, reposicao: true }),
    mov({ dataHora: '2026-09-21T10:00:00.000Z', quantidade: 2, matricula: 'F11-LD', codigoSap: '00005555' }),
  ];
  const r = relatorioMovimentacoes(base, 'Dep A', 'LE-01', {
    dataIni: '2026-09-20T00:00:00.000Z',
    dataFim: '2026-09-20T00:00:00.000Z',
  });
  assert.equal(r.linhas.length, 1);
  assert.equal(r.linhas[0][3], 'Reposição');

  const r2 = relatorioMovimentacoes(base, 'Dep A', 'LE-01', { codigo: 'F11-LD' });
  assert.equal(r2.linhas.length, 1);
  assert.match(r2.rodape ?? '', /total 2/);
});

test('relatorioConsumiveis: abaixo do mínimo sinalizado (docs 10.6)', () => {
  const r = relatorioConsumiveis(
    [
      { id: 'c1', depositoId: 'd1', codigo: 'LUVA-40', descricao: 'Luvas', quantidade: 20, unidade: 'CZ', estoqueAtual: 3, estoqueMinimo: 5, historico: [] },
      { id: 'c2', depositoId: 'd1', codigo: 'AD-ISOL', descricao: 'Adesivo', quantidade: 30, unidade: 'UN', estoqueAtual: 10, estoqueMinimo: 2, historico: [] },
    ],
    'Dep A',
    'LE-01',
  );
  assert.equal(r.linhas[0][0], 'AD-ISOL');
  assert.equal(r.linhas[0][4], 'Ok');
  assert.equal(r.linhas[1][4], 'Abaixo do mínimo');
  assert.match(r.rodape ?? '', /1 abaixo do mínimo/);
});

test('relatorioSolicitacoes e relatorioDivergencias: listagem com rodapé', () => {
  const s = relatorioSolicitacoes(
    [
      { id: 'r1', depositoId: 'd1', tipo: 'CONSUMIVEL', solicitanteId: 'u1', matricula: 'F11-MEC', status: 'RASCUNHO', dataEm: '2026-09-20T10:00:00.000Z', itens: [{ qtd: 4, codigo: 'LUVA-40', descricao: 'Luvas' }] },
    ],
    'Dep A',
    'LE-01',
  );
  assert.equal(s.linhas.length, 1);
  assert.equal(s.linhas[0][4], 'Rascunho');

  const d = relatorioDivergencias(
    [{ id: 'dv1', depositoId: 'd1', codigoSap: '00001234', tipo: 'CONFERENCIA', quantidade: 2, status: 'ABERTA', criadoEm: '2026-09-20T10:00:00.000Z', criadoPor: 'F11-MEC' }],
    'Dep A',
    'LE-01',
  );
  assert.equal(d.linhas.length, 1);
  assert.match(d.rodape ?? '', /1 divergência/);
});

test('relatorioAuditLogs: tipo com rótulo pt-BR', () => {
  const r = relatorioAuditLogs(
    [{ id: 'l1', tipo: 'BAIXA', dataHora: '2026-09-20T10:00:00.000Z', usuarioId: 'u1', matricula: 'F11-MEC', entidade: 'GoldboxMovement', origem: 'ONLINE', dispositivo: 'dev-1', hash: 'abc', motivo: 'baixa de 4' }],
    'Dep A',
    'LE-01',
  );
  assert.equal(r.linhas[0][1], 'Baixa (goldbox)');
  assert.match(r.linhas[0][3], /baixa de 4/);
});

test('#28 geração local de PDF via jsPDF (magic bytes e conteúdo)', () => {
  const tab: RelatorioTabela = relatorioEnxoval([item()], 'Dep A', 'LE-01', '12');
  const doc = gerarPdf(tab);
  const saida = doc.output('arraybuffer');
  const bytes = new Uint8Array(saida);
  const header = String.fromCharCode(...bytes.slice(0, 5));
  assert.equal(header, '%PDF-');
  const texto = doc.output(); // text output para inspeção
  assert.match(texto, /Enxoval/);
});

test('#29 layout PNG: comandos de desenho paginados (título + linhas)', () => {
  const tab: RelatorioTabela = relatorioMovimentacoes(
    Array.from({ length: 3 }, (_, i) => mov({ dataHora: `2026-09-2${i + 1}T10:00:00.000Z`, quantidade: i + 1 })),
    'Dep A',
    'LE-01',
  );
  const layout = layoutPng(tab);
  assert.ok(layout.largura > 0);
  assert.ok(layout.altura > 0);
  const textos = layout.comandos.filter((c) => c.tipo === 'texto').map((c) => (c as { s: string }).s);
  assert.ok(textos.includes('Movimentações (goldbox)'));
  assert.ok(textos.some((s) => s.includes('3 movimentação')));
});

test('formatarData: saída dd/mm/aaaa pt-BR', () => {
  assert.equal(formatarData('2026-09-20T10:00:00.000Z'), '20/09/2026');
});