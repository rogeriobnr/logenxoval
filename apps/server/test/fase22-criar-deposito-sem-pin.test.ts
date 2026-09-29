import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app';
import { ensureMigrated, resetDb } from './helpers';
import { closePool } from '../src/db/pool';
import { createUser } from '../src/repos/usersRepo';

/**
 * Regressão: cadastrar depósito NÃO exige PIN. O formulário de criação não tem
 * campo de PIN e `createDepositoBodySchema` nem aceita `pin`; antes, um líder com
 * PIN definido recebia 403 "PIN obrigatório" sem como enviar o valor.
 */
describe('criar depósito sem PIN (fase 22)', () => {
  let app: FastifyInstance;
  let tokenComPin: string;

  before(async () => {
    await ensureMigrated();
    await resetDb();
    app = await buildApp({ jwtSecret: 'test-secret' });

    // Líder COM PIN definido (o cenário que quebrava).
    await createUser({
      matricula: 'CD-LDR',
      nome: 'Lia',
      sobrenome: 'Lider',
      perfil: 'LIDER',
      senhaHash: await bcrypt.hash('senha-cd-123', 4),
      pinHash: await bcrypt.hash('8642', 4),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'x-device-id': 'dev-cd-ldr' },
      payload: { matricula: 'CD-LDR', senha: 'senha-cd-123', deviceId: 'dev-cd-ldr' },
    });
    assert.equal(res.statusCode, 200, res.body);
    tokenComPin = res.json().accessToken;
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  it('líder com PIN definido cria depósito sem enviar PIN → 200', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/deposits',
      headers: { authorization: `Bearer ${tokenComPin}`, 'x-device-id': 'dev-cd-ldr' },
      payload: { numero: '4820', nome: 'Galpao Novo', matriculaConfirmacao: 'CD-LDR' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().deposito.numero, '4820');
  });

  it('PIN continua sendo exigido em outras ações de depósito (desativar)', async () => {
    // Garante que a remoção foi só na criação, não no resto das ações críticas.
    const criacao = await app.inject({
      method: 'POST',
      url: '/deposits',
      headers: { authorization: `Bearer ${tokenComPin}`, 'x-device-id': 'dev-cd-ldr' },
      payload: { numero: '4821', nome: 'Outro Galpao', matriculaConfirmacao: 'CD-LDR' },
    });
    assert.equal(criacao.statusCode, 200, criacao.body);
    const id = criacao.json().deposito.id;

    const semPin = await app.inject({
      method: 'POST',
      url: `/deposits/${id}/deactivate`,
      headers: { authorization: `Bearer ${tokenComPin}`, 'x-device-id': 'dev-cd-ldr' },
      payload: { matriculaConfirmacao: 'CD-LDR', motivo: 'Fim do teste' },
    });
    assert.equal(semPin.statusCode, 403, semPin.body);

    const comPin = await app.inject({
      method: 'POST',
      url: `/deposits/${id}/deactivate`,
      headers: { authorization: `Bearer ${tokenComPin}`, 'x-device-id': 'dev-cd-ldr' },
      payload: { matriculaConfirmacao: 'CD-LDR', pin: '8642', motivo: 'Fim do teste' },
    });
    assert.equal(comPin.statusCode, 200, comPin.body);
  });
});
