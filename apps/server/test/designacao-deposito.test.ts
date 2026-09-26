import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { ensureMigrated, resetDb } from './helpers';
import { closePool, getPool } from '../src/db/pool';
import { createUser } from '../src/repos/usersRepo';

const DEV_ADMIN = 'dev-design-admin-01';
const DEV_MEC = 'dev-design-mec-001';
const DEV_LIDER = 'dev-design-lider-01';

function auth(token: string, device: string) {
  return { authorization: `Bearer ${token}`, 'x-device-id': device };
}

async function login(app: FastifyInstance, matricula: string, device: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    headers: { 'x-device-id': device },
    payload: { matricula, senha: 'senha-teste-123', deviceId: device },
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
}

describe('designação de usuário a depósito (admin)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let admPinToken: string;
  let liderToken: string;
  let mecToken: string;
  let mecId: string;
  let depId: string;

  before(async () => {
    await ensureMigrated();
    await resetDb();
    app = await buildApp({ jwtSecret: 'test-secret' });

    const admin = await createUser({
      matricula: 'ADM-DESIG',
      nome: 'Ana',
      sobrenome: 'Admin',
      perfil: 'ADMIN',
      senhaHash: await bcrypt.hash('senha-teste-123', 4),
    });
    void admin;
    const admPin = await createUser({
      matricula: 'ADM-PIN',
      nome: 'Pin',
      sobrenome: 'Admin',
      perfil: 'ADMIN',
      senhaHash: await bcrypt.hash('senha-teste-123', 4),
      email: 'pin.admin@teste.com',
      pinHash: await bcrypt.hash('4321', 4),
    });
    void admPin;
    const lider = await createUser({
      matricula: 'LDR-DESIG',
      nome: 'Leo',
      sobrenome: 'Lider',
      perfil: 'LIDER',
      senhaHash: await bcrypt.hash('senha-teste-123', 4),
    });
    void lider;
    const mec = await createUser({
      matricula: 'MEC-DESIG',
      nome: 'Mario',
      sobrenome: 'Mecanico',
      perfil: 'MECANICO',
      senhaHash: await bcrypt.hash('senha-teste-123', 4),
    });
    mecId = mec.id;

    adminToken = (await login(app, 'ADM-DESIG', DEV_ADMIN)).accessToken;
    admPinToken = (await login(app, 'ADM-PIN', 'dev-adm-pin')).accessToken;
    liderToken = (await login(app, 'LDR-DESIG', DEV_LIDER)).accessToken;
    mecToken = (await login(app, 'MEC-DESIG', DEV_MEC)).accessToken;

    const dep = await app.inject({
      method: 'POST',
      url: '/deposits',
      headers: auth(adminToken, DEV_ADMIN),
      payload: { numero: '7501', nome: 'Galpão Designação', matriculaConfirmacao: 'ADM-DESIG' },
    });
    assert.equal(dep.statusCode, 200, dep.body);
    depId = dep.json().deposito.id;
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  it('GET /users inclui depositoIds (inicia vazio para mecânico)', async () => {
    const res = await app.inject({ method: 'GET', url: '/users', headers: auth(adminToken, DEV_ADMIN) });
    assert.equal(res.statusCode, 200, res.body);
    const mec = (res.json().usuarios as Array<{ id: string; depositoIds: string[] }>).find((u) => u.id === mecId);
    assert.ok(mec, 'mecânico presente na listagem');
    assert.deepEqual(mec!.depositoIds, []);
  });

  it('mecânico ainda não enxerga o depósito', async () => {
    const lista = await app.inject({ method: 'GET', url: '/deposits', headers: auth(mecToken, DEV_MEC) });
    assert.equal(lista.statusCode, 200);
    assert.equal((lista.json().depositos as unknown[]).length, 0);
    const gett = await app.inject({ method: 'GET', url: `/deposits/${depId}`, headers: auth(mecToken, DEV_MEC) });
    assert.equal(gett.statusCode, 403);
  });

  it('líder não pode designar usuário (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/users/${mecId}/deposits`,
      headers: auth(liderToken, DEV_LIDER),
      payload: { depositoId: depId, matriculaConfirmacao: 'LDR-DESIG' },
    });
    assert.equal(res.statusCode, 403);
  });

  it('matrícula de confirmação divergente → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/users/${mecId}/deposits`,
      headers: auth(adminToken, DEV_ADMIN),
      payload: { depositoId: depId, matriculaConfirmacao: 'MEC-DESIG' },
    });
    assert.equal(res.statusCode, 403);
  });

  it('designa o depósito → mecânico passa a enxergar', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/users/${mecId}/deposits`,
      headers: auth(adminToken, DEV_ADMIN),
      payload: { depositoId: depId, matriculaConfirmacao: 'ADM-DESIG' },
    });
    assert.equal(res.statusCode, 200, res.body);

    const lista = await app.inject({ method: 'GET', url: '/deposits', headers: auth(mecToken, DEV_MEC) });
    assert.equal(lista.statusCode, 200);
    assert.equal((lista.json().depositos as unknown[]).length, 1);

    const gett = await app.inject({ method: 'GET', url: `/deposits/${depId}`, headers: auth(mecToken, DEV_MEC) });
    assert.equal(gett.statusCode, 200);

    const users = await app.inject({ method: 'GET', url: '/users', headers: auth(adminToken, DEV_ADMIN) });
    const mec = (users.json().usuarios as Array<{ id: string; depositoIds: string[] }>).find((u) => u.id === mecId);
    assert.deepEqual(mec!.depositoIds, [depId]);
  });

  it('auditoria gravada (DESIGNACAO_DEPOSITO)', async () => {
    const pool = getPool();
    const { rows } = await pool.query(
      "SELECT 1 FROM audit_logs WHERE tipo = 'DESIGNACAO_DEPOSITO' AND deposito_id = $1",
      [depId],
    );
    assert.equal(rows.length, 1);
  });

  it('revoga o acesso → mecânico cai fora e auditoria grava', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/users/${mecId}/deposits/${depId}`,
      headers: auth(adminToken, DEV_ADMIN),
      payload: { matriculaConfirmacao: 'ADM-DESIG' },
    });
    assert.equal(res.statusCode, 200, res.body);

    const lista = await app.inject({ method: 'GET', url: '/deposits', headers: auth(mecToken, DEV_MEC) });
    assert.equal((lista.json().depositos as unknown[]).length, 0);
    const gett = await app.inject({ method: 'GET', url: `/deposits/${depId}`, headers: auth(mecToken, DEV_MEC) });
    assert.equal(gett.statusCode, 403);

    const pool = getPool();
    const { rows } = await pool.query(
      "SELECT 1 FROM audit_logs WHERE tipo = 'REVOGACAO_DEPOSITO' AND deposito_id = $1",
      [depId],
    );
    assert.equal(rows.length, 1);
  });

  it('com PIN do admin configurado, designar sem PIN → 403; com PIN → 200', async () => {
    const semPin = await app.inject({
      method: 'POST',
      url: `/users/${mecId}/deposits`,
      headers: auth(admPinToken, 'dev-adm-pin'),
      payload: { depositoId: depId, matriculaConfirmacao: 'ADM-PIN' },
    });
    assert.equal(semPin.statusCode, 403);

    const pinErrado = await app.inject({
      method: 'POST',
      url: `/users/${mecId}/deposits`,
      headers: auth(admPinToken, 'dev-adm-pin'),
      payload: { depositoId: depId, matriculaConfirmacao: 'ADM-PIN', pin: '0000' },
    });
    assert.equal(pinErrado.statusCode, 403);

    const comPin = await app.inject({
      method: 'POST',
      url: `/users/${mecId}/deposits`,
      headers: auth(admPinToken, 'dev-adm-pin'),
      payload: { depositoId: depId, matriculaConfirmacao: 'ADM-PIN', pin: '4321' },
    });
    assert.equal(comPin.statusCode, 200, comPin.body);

    const lista = await app.inject({ method: 'GET', url: '/deposits', headers: auth(mecToken, DEV_MEC) });
    assert.equal((lista.json().depositos as unknown[]).length, 1);
  });

  it('usuário ou depósito inexistente → 404', async () => {
    const uInex = await app.inject({
      method: 'POST',
      url: `/users/nao-existe/deposits`,
      headers: auth(adminToken, DEV_ADMIN),
      payload: { depositoId: depId, matriculaConfirmacao: 'ADM-DESIG', pin: '4321' },
    });
    assert.equal(uInex.statusCode, 404);

    const dInex = await app.inject({
      method: 'POST',
      url: `/users/${mecId}/deposits`,
      headers: auth(adminToken, DEV_ADMIN),
      payload: { depositoId: 'nao-existe', matriculaConfirmacao: 'ADM-DESIG', pin: '4321' },
    });
    assert.equal(dInex.statusCode, 404);
  });
});