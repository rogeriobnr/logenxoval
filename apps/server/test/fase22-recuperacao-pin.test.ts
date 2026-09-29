import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app';
import { ensureMigrated, resetDb } from './helpers';
import { closePool, getPool } from '../src/db/pool';
import { createUser } from '../src/repos/usersRepo';
import { sha256Hex } from '../src/lib/crypto';

const TOKEN_PIN = 'token-de-teste-para-pin-000000001';

function auth(token: string, device: string) {
  return { authorization: `Bearer ${token}`, 'x-device-id': device };
}

async function login(app: FastifyInstance, matricula: string, senha: string, device: string) {
  return app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { 'x-device-id': device },
    payload: { matricula, senha, deviceId: device },
  });
}

describe('recuperação de PIN por e-mail (fase 22)', () => {
  let app: FastifyInstance;
  let token: string;
  let userId: string;

  before(async () => {
    await ensureMigrated();
    await resetDb();
    app = await buildApp({ jwtSecret: 'test-secret' });

    const mec = await createUser({
      matricula: 'RP-MEC',
      nome: 'Paula',
      sobrenome: 'Mecanica',
      perfil: 'MECANICO',
      senhaHash: await bcrypt.hash('senha-fixa-123', 4),
      email: 'rp.mec@teste.com',
      pinHash: await bcrypt.hash('1234', 4),
    });
    userId = mec.id;

    const res = await login(app, 'RP-MEC', 'senha-fixa-123', 'dev-rp-mec');
    assert.equal(res.statusCode, 200, res.body);
    token = res.json().accessToken;
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  it('forgot-pin com e-mail inexistente → 200 sem vazar existência', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/forgot-pin',
      payload: { email: 'nao-existe@teste.com' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.match(res.json().mensagem, /se o e-mail estiver cadastrado/i);

    const pool = getPool();
    const { rows } = await pool.query('SELECT 1 FROM pin_resets');
    assert.equal(rows.length, 0);
  });

  it('forgot-pin com e-mail cadastrado → grava token (SMTP ausente loga o link)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/forgot-pin',
      payload: { email: 'RP.MEC@TESTE.COM' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().ok, true);

    const pool = getPool();
    const { rows } = await pool.query('SELECT 1 FROM pin_resets WHERE user_id = $1', [userId]);
    assert.equal(rows.length, 1);
  });

  it('reset-pin com token inválido → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-pin',
      payload: { token: 'token-invalido-0000000000', novoPin: '9999' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'VALIDATION_FAILED');
  });

  it('reset-pin válido troca o PIN sem afetar a senha nem a sessão', async () => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO pin_resets (id, user_id, token_hash, expira_em)
       VALUES ($1, $2, $3, now() + interval '30 minutes')`,
      ['rp-r1', userId, sha256Hex(TOKEN_PIN)],
    );

    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-pin',
      payload: { token: TOKEN_PIN, novoPin: '8642' },
    });
    assert.equal(res.statusCode, 200, res.body);

    // a senha continua igual
    const loginOk = await login(app, 'RP-MEC', 'senha-fixa-123', 'dev-rp-mec');
    assert.equal(loginOk.statusCode, 200, loginOk.body);

    // o token antigo da sessão continua válido (recuperação de PIN não revoga sessões)
    const trocarComNovoPin = await app.inject({
      method: 'POST',
      url: '/auth/change-pin',
      headers: auth(token, 'dev-rp-mec'),
      payload: { pinAtual: '8642', novoPin: '1357' },
    });
    assert.equal(trocarComNovoPin.statusCode, 200, trocarComNovoPin.body);
  });

  it('reuso do mesmo token → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-pin',
      payload: { token: TOKEN_PIN, novoPin: '5555' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'VALIDATION_FAILED');
  });

  it('reset-pin com PIN fora do formato → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-pin',
      payload: { token: TOKEN_PIN, novoPin: 'abc' },
    });
    assert.equal(res.statusCode, 400);
  });
});
