import 'fake-indexeddb/auto';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { getStoredSession, db } from '../src/db/db';
import { deriveLocalVerifier } from '../src/lib/crypto';
import {
  autenticarOffline,
  atualizarHashCredencialOffline,
  gravarCredencialOffline,
  OFFLINE_CRED_NUNCA_CONHECIDO,
} from '../src/lib/offlineAuth';

beforeEach(async () => {
  await db.offlineCreds.clear();
  await db.session.clear();
  await db.kv.clear();
});

const depositos = [
  { id: 'd1', numero: '1001', nome: 'Galpão A' },
  { id: 'd2', numero: '1002', nome: 'Galpão B' },
];

async function seed(matricula: string, senha: string, salt = 'salt-fixo') {
  const hashLocal = await deriveLocalVerifier(senha, salt);
  await gravarCredencialOffline({
    userId: `u-${matricula}`,
    matricula,
    nomeCompleto: `${matricula} Nome`,
    perfil: 'MECANICO',
    depositos,
    saltLocal: salt,
    hashLocal,
  });
}

test('matrícula nunca autenticada online → erro com mensagem clara', async () => {
  const res = await autenticarOffline('FANTASMA', 'qualquer');
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.code, 'OFFLINE_INDISPONIVEL');
    assert.equal(res.message, OFFLINE_CRED_NUNCA_CONHECIDO);
  }
});

test('senha correta cria sessão local e escolhe primeiro depósito', async () => {
  await seed('MEC-1002', 'senha-teste-123');
  const res = await autenticarOffline('MEC-1002', 'senha-teste-123');
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.session.matricula, 'MEC-1002');
  assert.equal(res.session.depositoAtivo, 'd1');
  assert.ok(new Date(res.session.expiresAt).getTime() > Date.now());

  const sessao = await getStoredSession();
  assert.equal(sessao?.matricula, 'MEC-1002');
});

test('senha errada → não autorizado', async () => {
  await seed('MEC-1002', 'senha-teste-123');
  const res = await autenticarOffline('MEC-1002', 'senha-errada');
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, 'UNAUTHORIZED');
});

test('multi-usuário: troca de matrícula funciona após a primeira ter autenticado', async () => {
  await seed('MEC-1002', 'senha-teste-123');
  await seed('LID-1001', 'outra-senha-123');
  const a = await autenticarOffline('MEC-1002', 'senha-teste-123');
  assert.equal(a.ok, true);
  const b = await autenticarOffline('LID-1001', 'outra-senha-123');
  assert.equal(b.ok, true);
  if (b.ok) assert.equal(b.session.matricula, 'LID-1001');
});

test('regressão: getStoredSession devolve a sessão ativa (chave userId, não chave constante)', async () => {
  await db.session.put({
    userId: 'u-antigo',
    matricula: 'ANTIGO',
    nomeCompleto: 'Usuário Antigo',
    perfil: 'MECANICO',
    depositos: [],
    depositoAtivo: '',
    saltLocal: 'x',
    hashLocal: 'y',
    loginEm: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-12-31T00:00:00.000Z',
    lastActivityAt: '2026-01-01T00:00:00.000Z',
  });
  await seed('MEC-1002', 'senha-teste-123');
  await autenticarOffline('MEC-1002', 'senha-teste-123');

  const ativa = await getStoredSession();
  assert.equal(ativa?.matricula, 'MEC-1002');
  assert.equal(ativa?.userId, 'u-MEC-1002');
});

test('logout (limpar sessão) não invalida a credencial offline do aparelho', async () => {
  await seed('MEC-1002', 'senha-teste-123');
  const primeiro = await autenticarOffline('MEC-1002', 'senha-teste-123');
  assert.equal(primeiro.ok, true);
  await db.session.clear();
  const segundo = await autenticarOffline('MEC-1002', 'senha-teste-123');
  assert.equal(segundo.ok, true);
});

test('troca de senha atualiza o hash local (senha antiga falha, nova passa)', async () => {
  await seed('MEC-1002', 'senha-velha-123-b');
  const novoHash = await deriveLocalVerifier('senha-nova-123-b', 'salt-fixo');
  await atualizarHashCredencialOffline('MEC-1002', novoHash);

  const velha = await autenticarOffline('MEC-1002', 'senha-velha-123-b');
  assert.equal(velha.ok, false);
  const nova = await autenticarOffline('MEC-1002', 'senha-nova-123-b');
  assert.equal(nova.ok, true);
});