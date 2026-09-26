import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app';
import { ensureMigrated, resetDb } from './helpers';
import { closePool } from '../src/db/pool';
import { createUser } from '../src/repos/usersRepo';

async function login(app: FastifyInstance, matricula: string, senha: string, device: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { 'x-device-id': device },
    payload: { matricula, senha, deviceId: device },
  });
  return res;
}

describe('cadastro público POST /auth/register', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let novoId: string;

  before(async () => {
    await ensureMigrated();
    await resetDb();
    app = await buildApp({ jwtSecret: 'test-secret' });

    const admin = await createUser({
      matricula: 'CD-ADM',
      nome: 'Ana',
      sobrenome: 'Admin',
      perfil: 'ADMIN',
      senhaHash: await bcrypt.hash('senha-admin-123', 4),
    });
    adminToken = (await login(app, 'CD-ADM', 'senha-admin-123', 'dev-cd-adm')).json().accessToken;
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  it('registro público sem token cria usuário PENDENTE', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        nome: 'Carlos',
        sobrenome: 'Mecanico',
        matricula: 'CD-MEC',
        senha: 'senha-nova-123',
        perfil: 'MECANICO',
      },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.usuario.status, 'PENDENTE');
    assert.equal(body.usuario.perfil, 'MECANICO');
    novoId = body.usuario.id;
  });

  it('matrícula duplicada → 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        nome: 'Carlos',
        sobrenome: 'Mecanico',
        matricula: 'CD-MEC',
        senha: 'senha-nova-123',
        perfil: 'MECANICO',
      },
    });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error.code, 'CONFLITO');
  });

  it('perfil ADMIN é rejeitado no cadastro público', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        nome: 'X',
        sobrenome: 'Y',
        matricula: 'CD-ADM2',
        senha: 'senha-nova-123',
        perfil: 'ADMIN',
      },
    });
    assert.equal(res.statusCode, 400);
  });

  it('senha curta → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        nome: 'X',
        sobrenome: 'Y',
        matricula: 'CD-MEC2',
        senha: 'curta',
        perfil: 'LIDER',
      },
    });
    assert.equal(res.statusCode, 400);
  });

  it('login de usuário PENDENTE → 403 com mensagem de aprovação', async () => {
    const res = await login(app, 'CD-MEC', 'senha-nova-123', 'dev-cd-mec');
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error.code, 'PERMISSAO_NEGADA');
    assert.match(res.json().error.message, /aguardando aprovação/i);
  });

  it('refresh de usuário PENDENTE também é negado', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: 'token-inexistente', deviceId: 'dev-cd-mec' },
    });
    assert.equal(res.statusCode, 401); // sem sessão válida criada
  });

  it('admin aprova (PATCH ATIVO) e o usuário passa a logar', async () => {
    const patch = await app.inject({
      method: 'PATCH',
      url: `/users/${novoId}`,
      headers: { authorization: `Bearer ${adminToken}`, 'x-device-id': 'dev-cd-adm' },
      payload: { status: 'ATIVO' },
    });
    assert.equal(patch.statusCode, 200, patch.body);

    const res = await login(app, 'CD-MEC', 'senha-nova-123', 'dev-cd-mec');
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().usuario.perfil, 'MECANICO');
    assert.ok(res.json().accessToken);
  });

  it('bloqueado permanece bloqueado pelo admin', async () => {
    const patch = await app.inject({
      method: 'PATCH',
      url: `/users/${novoId}`,
      headers: { authorization: `Bearer ${adminToken}`, 'x-device-id': 'dev-cd-adm' },
      payload: { status: 'BLOQUEADO' },
    });
    assert.equal(patch.statusCode, 200, patch.body);
    const res = await login(app, 'CD-MEC', 'senha-nova-123', 'dev-cd-mec');
    assert.equal(res.statusCode, 403);
  });
});