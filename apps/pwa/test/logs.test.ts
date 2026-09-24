import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AuditLogRow, LogTipo } from '@logenxoval/contracts';
import {
  agruparPorDia,
  chaveDoDia,
  filtrarLogs,
  formatarDataHora,
  grupoDeLog,
  malhaDoMes,
  marcasUnicas,
  resumirMes,
} from '../src/lib/logs';

function log(over: Partial<AuditLogRow> & { tipo: LogTipo }): AuditLogRow {
  return {
    id: 'l1',
    dataHora: '2026-09-12T09:04:00.000Z',
    usuarioId: 'u1',
    matricula: 'F7-LDR',
    depositoId: 'd1',
    entidade: 'BAIXA',
    origem: 'ONLINE',
    dispositivo: 'dev',
    hash: 'abc',
    ...over,
  };
}

test('grupoDeLog: mapa de cor por tipo', () => {
  assert.equal(grupoDeLog('ENTRADA_PECA_AVULSA'), 'peca');
  assert.equal(grupoDeLog('BAIXA'), 'reposicao');
  assert.equal(grupoDeLog('CONFERENCIA'), 'conferencia');
  assert.equal(grupoDeLog('DIVERGENCIA'), 'divergencia');
  assert.equal(grupoDeLog('LOGIN'), 'lideranca');
});

test('marcasUnicas: emoji único por grupo, na ordem da legenda', () => {
  const logs = [
    log({ id: 'a', tipo: 'BAIXA' }),
    log({ id: 'b', tipo: 'REPOSICAO' }),
    log({ id: 'c', tipo: 'ENTRADA_PECA_AVULSA' }),
  ];
  assert.deepEqual(marcasUnicas(logs), ['🟠', '🟢']);
});

test('resumirMes: agrupa por dia com contagem e marcas', () => {
  const logs = [
    log({ id: 'a', dataHora: '2026-09-12T09:04:00.000Z', tipo: 'BAIXA' }),
    log({ id: 'b', dataHora: '2026-09-12T10:00:00.000Z', tipo: 'SUGESTAO_ACEITA' }),
    log({ id: 'c', dataHora: '2026-09-13T08:00:00.000Z', tipo: 'IMPORTACAO_FOLHA' }),
  ];
  const r = resumirMes(logs);
  const dia12 = r.get('2026-09-12');
  assert.ok(dia12);
  assert.equal(dia12.total, 2);
  assert.deepEqual(dia12.marcas, ['🟠', '🟢']);
  assert.equal(r.get('2026-09-13')!.marcas[0], '🔵');
});

test('malhaDoMes: 42 células, segunda-feira primeiro, primeiro dia alinhado', () => {
  const set2026 = malhaDoMes(2026, 8); // setembro 2026
  assert.equal(set2026.length, 42);
  const primeiro = set2026.find((c) => c.dia === 1);
  // 01/09/2026 é terça-feira → índice 1
  assert.equal(set2026.indexOf(primeiro!), 1);
  // células vazias antes do dia 1
  assert.equal(set2026[0].iso, null);
});

test('filtrarLogs: por grupo e matrícula', () => {
  const logs = [
    log({ id: 'a', tipo: 'BAIXA', matricula: 'F7-MEC' }),
    log({ id: 'b', tipo: 'CONFERENCIA', matricula: 'F7-LDR' }),
    log({ id: 'c', tipo: 'SAIDA_PECA_AVULSA', matricula: 'F7-MEC' }),
  ];
  assert.equal(filtrarLogs(logs, { grupo: 'peca' }).length, 1);
  assert.equal(filtrarLogs(logs, { matricula: 'mec' }).length, 2);
  assert.equal(filtrarLogs(logs, { grupo: 'peca', matricula: 'mec' }).length, 1);
});

test('formatarDataHora: dd/mm e HH:MM', () => {
  const iso = new Date(2026, 8, 12, 9, 4).toISOString();
  const { data, hora } = formatarDataHora(iso);
  assert.equal(data, '12/09');
  assert.equal(hora, '09:04');
});

test('agruparPorDia e chaveDoDia', () => {
  const g = agruparPorDia([
    log({ id: 'a', dataHora: '2026-09-12T09:04:00.000Z', tipo: 'BAIXA' }),
    log({ id: 'b', dataHora: '2026-09-12T10:00:00.000Z', tipo: 'BAIXA' }),
  ]);
  assert.equal(g.get('2026-09-12')!.length, 2);
  assert.equal(chaveDoDia('2026-09-12T09:04:00.000Z'), '2026-09-12');
});