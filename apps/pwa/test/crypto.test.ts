import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveLocalVerifier, verifierIgual } from '../src/lib/crypto';

test('PBKDF2: derive é determinístico para mesma senha e salt', async () => {
  const a = await deriveLocalVerifier('abc123', 'salt-dispositivo');
  const b = await deriveLocalVerifier('abc123', 'salt-dispositivo');
  assert.equal(a, b);
  assert.ok(a.length > 10);
});

test('PBKDF2: senhas diferentes geram hashes diferentes', async () => {
  const a = await deriveLocalVerifier('abc123', 'salt');
  const b = await deriveLocalVerifier('abc124', 'salt');
  assert.notEqual(a, b);
});

test('PBKDF2: salts diferentes geram hashes diferentes', async () => {
  const a = await deriveLocalVerifier('abc123', 'salt-1');
  const b = await deriveLocalVerifier('abc123', 'salt-2');
  assert.notEqual(a, b);
});

test('verifierIgual: compara hash armazenado com o calculado', async () => {
  const hash = await deriveLocalVerifier('minha-senha', 'salt-x');
  assert.equal(verifierIgual(hash, hash), true);
  const outro = await deriveLocalVerifier('outra-senha', 'salt-x');
  assert.equal(verifierIgual(hash, outro), false);
});