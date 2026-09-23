import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assinarMatricula } from '../src/lib/assinatura';

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

test('assinarMatricula: retorna sha256 hex determinístico da matrícula', async () => {
  const esperado = sha256Hex('logenxoval:assinatura:TESTE-MATRICULA');
  assert.equal(await assinarMatricula('TESTE-MATRICULA'), esperado);
});

test('assinarMatricula: mesma matrícula gera sempre o mesmo valor', async () => {
  const a = await assinarMatricula('ABC-123');
  const b = await assinarMatricula('ABC-123');
  assert.equal(a, b);
});

test('assinarMatricula: matrículas diferentes geram valores diferentes', async () => {
  const a = await assinarMatricula('ABC-123');
  const b = await assinarMatricula('ABC-124');
  assert.notEqual(a, b);
});

test('assinarMatricula: resultado é hex de 64 caracteres', async () => {
  const r = await assinarMatricula('X');
  assert.match(r, /^[0-9a-f]{64}$/);
});