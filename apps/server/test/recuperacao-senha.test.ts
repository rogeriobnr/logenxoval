import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app';
import { ensureMigrated, resetDb } from './helpers';
import { closePool, getPool } from '../src/db/pool';
import { createUser } from '../src/repos/usersRepo';
import { sha256Hex } from '../src/lib/crypto';

const TOKEN_VALIDO = 'token-de-teste-para-reset-0000001';

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

describe('recuperação de senha via e-mail e gerenciamento de PIN', () => {
  let app: FastifyInstance;
  let mecToken: string;
  let userId: string;

  before(async () => {
    await ensureMigrated();
    await resetDb();
    app = await buildApp({ jwtSecret: 'test-secret' });

    const admin = await createUser({
      matricula: 'RC-ADM',
      nome: 'Ana',
      sobrenome: 'Admin',
      perfil: 'ADMIN',
      senhaHash: await bcrypt.hash('senha-admin-123', 4),
      email: 'rc.adm@teste.com',
    });
    void admin;

    const mec = await createUser({
      matricula: 'RC-MEC',
      nome: 'Mario',
      sobrenome: 'Mecanico',
      perfil: 'MECANICO',
      senhaHash: await bcrypt.hash('senha-antiga-123', 4),
      email: 'rc.mec@teste.com',
    });
    userId = mec.id;

    const res = await login(app, 'RC-MEC', 'senha-antiga-123', 'dev-rc-mec');
    assert.equal(res.statusCode, 200, res.body);
    mecToken = res.json().accessToken;
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  it('forgot-password com e-mail inexistente → 200 sem vazar existência', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'nao-existe@teste.com' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.match(res.json().mensagem, /Se o e-mail estiver cadastrado/i);

    const pool = getPool();
    const { rows } = await pool.query('SELECT 1 FROM password_resets');
    assert.equal(rows.length, 0);
  });

  it('forgot-password com e-mail cadastrado → 200 (SMTP não configurado usa log)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'RC.MEC@TESTE.COM' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().ok, true);

    const pool = getPool();
    const { rows } = await pool.query('SELECT 1 FROM password_resets WHERE user_id = $1', [userId]);
    assert.equal(rows.length, 1);
  });

  it('reset com token inválido → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token: 'token-invalido-0000000000', novaSenha: 'nova-senha-123' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'VALIDATION_FAILED');
  });

  it('reset completo: token válido troca a senha e revoga sessões', async () => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO password_resets (id, user_id, token_hash, expira_em)
       VALUES ($1, $2, $3, now() + interval '30 minutes')`,
      ['rc-r1', userId, sha256Hex(TOKEN_VALIDO)],
    );

    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token: TOKEN_VALIDO, novaSenha: 'nova-senha-123' },
    });
    assert.equal(res.statusCode, 200, res.body);

    const antiga = await login(app, 'RC-MEC', 'senha-antiga-123', 'dev-rc-mec');
    assert.equal(antiga.statusCode, 401);
    const nova = await login(app, 'RC-MEC', 'nova-senha-123', 'dev-rc-mec');
    assert.equal(nova.statusCode, 200, nova.body);
  });

  it('reuso do mesmo token → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token: TOKEN_VALIDO, novaSenha: 'outra-senha-123' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'VALIDATION_FAILED');
  });

  it('change-pin cria o primeiro PIN e depois exige o PIN atual', async () => {
    // sem PIN: criar com pinAtual vazio
    const criar = await app.inject({
      method: 'POST',
      url: '/auth/change-pin',
      headers: auth(mecToken, 'dev-rc-mec'),
      payload: { pinAtual: '', novoPin: '3579' },
    });
    assert.equal(criar.statusCode, 200, criar.body);

    // troca com PIN atual correto
    const trocar = await app.inject({
      method: 'POST',
      url: '/auth/change-pin',
      headers: auth(mecToken, 'dev-rc-mec'),
      payload: { pinAtual: '3579', novoPin: '2468' },
    });
    assert.equal(trocar.statusCode, 200, trocar.body);

    // PIN atual errado → 403
    const errado = await app.inject({
      method: 'POST',
      url: '/auth/change-pin',
      headers: auth(mecToken, 'dev-rc-mec'),
      payload: { pinAtual: '0000', novoPin: '1111' },
    });
    assert.equal(errado.statusCode, 403);
  });

  it('change-pin sem autenticação → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/change-pin',
      payload: { pinAtual: '2468', novoPin: '1111' },
    });
    assert.equal(res.statusCode, 401);
  });
});