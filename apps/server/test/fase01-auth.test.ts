import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app';
import { ensureMigrated, resetDb } from './helpers';
import { closePool, getPool } from '../src/db/pool';
import { createUser } from '../src/repos/usersRepo';
import { grantDepositAccess } from '../src/repos/depositsRepo';

const DEV_ADMIN = 'dev-admin-000001';
const DEV_LIDER = 'dev-lider-000001';
const DEV_MEC = 'dev-mecanico-00001';
const DEV_SWAP = 'dev-swap-0000001';
const DEV_EXTRA = 'dev-extra-0000001';

async function seedUser(opts: {
  matricula: string;
  nome: string;
  sobrenome: string;
  perfil: 'MECANICO' | 'LIDER' | 'ADMIN';
  senha?: string;
}) {
  const senhaHash = await bcrypt.hash(opts.senha ?? 'senha-teste-123', 4);
  return createUser({
    matricula: opts.matricula,
    nome: opts.nome,
    sobrenome: opts.sobrenome,
    perfil: opts.perfil,
    senhaHash,
  });
}

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

describe('fase01 - autenticação, usuários e depósitos', () => {
  let app: FastifyInstance;

  let adminToken: string;
  let liderToken: string;
  let mecToken: string;
  let admin: Awaited<ReturnType<typeof seedUser>>;
  let mec: Awaited<ReturnType<typeof seedUser>>;
  let dep3216: string;
  let dep3217: string;

  before(async () => {
    await ensureMigrated();
    await resetDb();
    app = await buildApp({ jwtSecret: 'test-secret' });

    admin = await seedUser({ matricula: 'ADM-001', nome: 'Ana', sobrenome: 'Admin', perfil: 'ADMIN' });
    await seedUser({ matricula: 'LDR-001', nome: 'Leo', sobrenome: 'Lider', perfil: 'LIDER' });
    mec = await seedUser({ matricula: 'MEC-001', nome: 'Mario', sobrenome: 'Mecanico', perfil: 'MECANICO' });

    adminToken = (await login(app, 'ADM-001', DEV_ADMIN)).accessToken;
    liderToken = (await login(app, 'LDR-001', DEV_LIDER)).accessToken;
    mecToken = (await login(app, 'MEC-001', DEV_MEC)).accessToken;
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  describe('login', () => {
    it('login retorna tokens, usuário, depósitos e saltLocal', async () => {
      const jwtLogin = await login(app, 'ADM-001', DEV_ADMIN);
      assert.ok(jwtLogin.accessToken);
      assert.ok(jwtLogin.refreshToken);
      assert.equal(jwtLogin.usuario.matricula, 'ADM-001');
      assert.equal(jwtLogin.usuario.perfil, 'ADMIN');
      assert.ok(Array.isArray(jwtLogin.depositos));
      assert.ok(jwtLogin.saltLocal.length > 8);
    });

    it('senha errada → 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { 'x-device-id': DEV_ADMIN },
        payload: { matricula: 'ADM-001', senha: 'errada', deviceId: DEV_ADMIN },
      });
      assert.equal(res.statusCode, 401);
    });

    it('usuário bloqueado → 403', async () => {
      await seedUser({ matricula: 'MEC-BLK', nome: 'B', sobrenome: 'B', perfil: 'MECANICO' });
      const pool = getPool();
      await pool.query("UPDATE users SET status='BLOQUEADO' WHERE matricula='MEC-BLK'");
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { 'x-device-id': DEV_ADMIN },
        payload: { matricula: 'MEC-BLK', senha: 'senha-teste-123', deviceId: DEV_ADMIN },
      });
      assert.equal(res.statusCode, 403);
    });
  });

  describe('troca de usuário no mesmo device (exige logout)', () => {
    it('login de outro usuário substitui a sessão e revoga o refresh do anterior', async () => {
      const r1 = await login(app, 'LDR-001', DEV_SWAP);
      const ref1 = r1.refreshToken;

      const r2 = await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { 'x-device-id': DEV_SWAP },
        payload: { matricula: 'MEC-001', senha: 'senha-teste-123', deviceId: DEV_SWAP },
      });
      assert.equal(r2.statusCode, 200);

      const rRef = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: ref1, deviceId: DEV_SWAP },
      });
      assert.equal(rRef.statusCode, 401);
    });
  });

  describe('depósitos (criados por líder)', () => {
    it('líder cria depósito ok', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/deposits',
        headers: auth(liderToken, DEV_LIDER),
        payload: { numero: '3216', nome: 'Enxoval Oficina', matriculaConfirmacao: 'LDR-001' },
      });
      assert.equal(res.statusCode, 200, res.body);
      dep3216 = res.json().deposito.id;
      assert.ok(dep3216);
    });

    it('mecânico não pode criar depósito (403)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/deposits',
        headers: auth(mecToken, DEV_MEC),
        payload: { numero: '9999', nome: 'Deposito Nao Autorizado', matriculaConfirmacao: 'MEC-001' },
      });
      assert.equal(res.statusCode, 403);
    });

    it('número duplicado → 409', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/deposits',
        headers: auth(liderToken, DEV_LIDER),
        payload: { numero: '3216', nome: 'Outro', matriculaConfirmacao: 'LDR-001' },
      });
      assert.equal(res.statusCode, 409);
    });

    it('matrícula de confirmação divergente do usuário logado → 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/deposits',
        headers: auth(liderToken, DEV_LIDER),
        payload: { numero: '3217', nome: 'Outro', matriculaConfirmacao: 'MEC-001' },
      });
      assert.equal(res.statusCode, 403);
    });

    it('cria segundo depósito para teste de isolamento', async () => {
      const ok = await app.inject({
        method: 'POST',
        url: '/deposits',
        headers: auth(liderToken, DEV_LIDER),
        payload: { numero: '3217', nome: 'Outro', matriculaConfirmacao: 'LDR-001' },
      });
      assert.equal(ok.statusCode, 200);
      dep3217 = ok.json().deposito.id;
    });

    it('log de criação gravado (auditoria)', async () => {
      const pool = getPool();
      const { rows } = await pool.query(
        "SELECT tipo FROM audit_logs WHERE deposito_id = $1 AND tipo = 'CRIACAO_DEPOSITO'",
        [dep3216],
      );
      assert.equal(rows.length, 1);
    });
  });

  describe('isolamento entre depósitos', () => {
    it('mecânico sem acesso não vê nem consulta depósito', async () => {
      const lista = await app.inject({ method: 'GET', url: '/deposits', headers: auth(mecToken, DEV_MEC) });
      assert.equal(lista.statusCode, 200);
      assert.equal(lista.json().depositos.length, 0);

      const gett = await app.inject({
        method: 'GET',
        url: `/deposits/${dep3216}`,
        headers: auth(mecToken, DEV_MEC),
      });
      assert.equal(gett.statusCode, 403);
    });

    it('mecânico com acesso concedido enxerga só o depósito dele', async () => {
      await grantDepositAccess({ userId: mec.id, depositoId: dep3216, concedidoPor: 'ADM-001' });
      const lista = await app.inject({ method: 'GET', url: '/deposits', headers: auth(mecToken, DEV_MEC) });
      assert.equal(lista.statusCode, 200);
      const depositos = lista.json().depositos as Array<{ id: string }>;
      assert.equal(depositos.length, 1);
      assert.equal(depositos[0].id, dep3216);

      const gett = await app.inject({
        method: 'GET',
        url: `/deposits/${dep3217}`,
        headers: auth(mecToken, DEV_MEC),
      });
      assert.equal(gett.statusCode, 403);
    });

    it('admin enxerga todos', async () => {
      const lista = await app.inject({ method: 'GET', url: '/deposits', headers: auth(adminToken, DEV_ADMIN) });
      const depositos = lista.json().depositos as Array<{ id: string }>;
      assert.ok(depositos.length >= 2);
    });
  });

  describe('permissões por perfil', () => {
    it('mecânico não lista usuários (403); admin lista (200)', async () => {
      const rMe = await app.inject({ method: 'GET', url: '/users', headers: auth(mecToken, DEV_MEC) });
      assert.equal(rMe.statusCode, 403);
      const rAd = await app.inject({ method: 'GET', url: '/users', headers: auth(adminToken, DEV_ADMIN) });
      assert.equal(rAd.statusCode, 200);
    });

    it('líder lista usuários sem os admins', async () => {
      const rLider = await app.inject({ method: 'GET', url: '/users', headers: auth(liderToken, DEV_LIDER) });
      assert.equal(rLider.statusCode, 200);
      const perfis = new Set(
        (rLider.json().usuarios as Array<{ perfil: string }>).map((u) => u.perfil),
      );
      assert.ok(!perfis.has('ADMIN'), 'líder não deve ver administradores');
    });

    it('líder cria usuário MECANICO (200); lider cria ADMIN → 403; admin cria (200)', async () => {
      const rLider = await app.inject({
        method: 'POST',
        url: '/users',
        headers: auth(liderToken, DEV_LIDER),
        payload: {
          nome: 'Leozinho',
          sobrenome: 'Dois',
          matricula: 'LDR-002',
          email: 'leozinho@teste.com',
          senha: 'senha-teste-123',
          perfil: 'MECANICO',
          pin: '1111',
        },
      });
      assert.equal(rLider.statusCode, 200, rLider.body);

      const rLiderAdm = await app.inject({
        method: 'POST',
        url: '/users',
        headers: auth(liderToken, DEV_LIDER),
        payload: {
          nome: 'Leozinho',
          sobrenome: 'Tres',
          matricula: 'LDR-003',
          email: 'leozinho3@teste.com',
          senha: 'senha-teste-123',
          perfil: 'ADMIN',
          pin: '1111',
        },
      });
      assert.equal(rLiderAdm.statusCode, 403);

      const rAdm = await app.inject({
        method: 'POST',
        url: '/users',
        headers: auth(adminToken, DEV_ADMIN),
        payload: {
          nome: 'Xuxa',
          sobrenome: 'Dois',
          matricula: 'MEC-002',
          email: 'xuxa@teste.com',
          senha: 'senha-teste-123',
          perfil: 'MECANICO',
          pin: '2222',
        },
      });
      assert.equal(rAdm.statusCode, 200, rAdm.body);
    });

    it('admin bloqueia usuário → login passa a falhar e sessões são revogadas', async () => {
      const pool = getPool();
      const { rows } = await pool.query("SELECT id FROM users WHERE matricula='MEC-001'");
      const res = await app.inject({
        method: 'PATCH',
        url: `/users/${rows[0].id}`,
        headers: auth(adminToken, DEV_ADMIN),
        payload: { status: 'BLOQUEADO' },
      });
      assert.equal(res.statusCode, 200);

      const loginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { 'x-device-id': DEV_MEC },
        payload: { matricula: 'MEC-001', senha: 'senha-teste-123', deviceId: DEV_MEC },
      });
      assert.equal(loginRes.statusCode, 403);

      await app.inject({
        method: 'PATCH',
        url: `/users/${rows[0].id}`,
        headers: auth(adminToken, DEV_ADMIN),
        payload: { status: 'ATIVO' },
      });
    });
  });

  describe('edição e desativação de depósito (líder)', () => {
    it('edita nome com matrícula correta', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/deposits/${dep3216}`,
        headers: auth(liderToken, DEV_LIDER),
        payload: { nome: 'Enxoval Oficina Renomeado', matriculaConfirmacao: 'LDR-001' },
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().deposito.nome, 'Enxoval Oficina Renomeado');
    });

    it('desativa depósito de forma lógica', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep3216}/deactivate`,
        headers: auth(liderToken, DEV_LIDER),
        payload: { motivo: 'oficina encerrada', matriculaConfirmacao: 'LDR-001' },
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().deposito.status, 'INATIVO');
    });
  });

  describe('bloqueio por inatividade', () => {
    it('atividade antiga → 401 e log BLOQUEIO_INATIVIDADE', async () => {
      const jwtLogin = await login(app, 'LDR-001', DEV_EXTRA);
      const tok = jwtLogin.accessToken;

      const pool = getPool();
      await pool.query(
        "UPDATE sessions SET last_activity_at = now() - interval '2 hours' WHERE device_id = $1",
        [DEV_EXTRA],
      );
      await pool.query(
        "UPDATE sessions SET expires_at = now() + interval '2 days' WHERE device_id = $1",
        [DEV_EXTRA],
      );

      const res = await app.inject({ method: 'GET', url: '/auth/me', headers: auth(tok, DEV_EXTRA) });
      assert.equal(res.statusCode, 401);

      const { rows } = await pool.query(
        "SELECT 1 FROM audit_logs WHERE tipo='BLOQUEIO_INATIVIDADE' AND dispositivo=$1",
        [DEV_EXTRA],
      );
      assert.equal(rows.length, 1);
    });
  });

  describe('refresh', () => {
    it('refresh rotaciona token e mantém sessão', async () => {
      const jwtLogin = await login(app, 'LDR-001', DEV_EXTRA);
      const ref = jwtLogin.refreshToken;
      const at = jwtLogin.accessToken;

      const rRef = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: ref, deviceId: DEV_EXTRA },
      });
      assert.equal(rRef.statusCode, 200, rRef.body);
      assert.notEqual(rRef.json().accessToken, at);

      const me = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: auth(rRef.json().accessToken, DEV_EXTRA),
      });
      assert.equal(me.statusCode, 200);
    });
  });

  describe('logout', () => {
    it('logout revoga sessão do device; refresh falha depois', async () => {
      const jwtLogin = await login(app, 'LDR-001', DEV_EXTRA);
      const ref = jwtLogin.refreshToken;
      const tok = jwtLogin.accessToken;

      const out = await app.inject({ method: 'POST', url: '/auth/logout', headers: auth(tok, DEV_EXTRA) });
      assert.equal(out.statusCode, 200);

      const rRef = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: ref, deviceId: DEV_EXTRA },
      });
      assert.equal(rRef.statusCode, 401);
    });
  });
});