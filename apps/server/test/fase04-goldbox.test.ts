import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app';
import { ensureMigrated, resetDb } from './helpers';
import { closePool, getPool } from '../src/db/pool';
import { createUser } from '../src/repos/usersRepo';
import { grantDepositAccess } from '../src/repos/depositsRepo';

const DEV_ADMIN = 'dev-fase04-admin';
const DEV_LIDER = 'dev-fase04-lider';
const DEV_MEC = 'dev-fase04-mecanico';

async function seedUser(opts: {
  matricula: string;
  nome: string;
  sobrenome: string;
  perfil: 'MECANICO' | 'LIDER' | 'ADMIN';
}) {
  const senhaHash = await bcrypt.hash('senha-teste-123', 4);
  return createUser({ ...opts, senhaHash });
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

function itensV1() {
  return [
    { codigoSap: '1002341', textoBreve: 'Parafuso M8x20', qtdOficial: 10, qtdAtual: 10, utilizacaoLivre: true, unidadeMedida: 'pç' },
    { codigoSap: '1002342', textoBreve: 'Porca M8', qtdOficial: 20, qtdAtual: 20, utilizacaoLivre: false, unidadeMedida: 'pç' },
    { codigoSap: '1002343', textoBreve: 'Arruela M8', qtdOficial: 1, qtdAtual: 1, utilizacaoLivre: false },
  ];
}

describe('fase04 - goldbox (baixa, estorno e histórico)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let liderToken: string;
  let mecToken: string;
  let mec: Awaited<ReturnType<typeof seedUser>>;
  let dep: string;

  before(async () => {
    await ensureMigrated();
    await resetDb();
    app = await buildApp({ jwtSecret: 'test-secret' });

    await seedUser({ matricula: 'F4-ADM', nome: 'Ana', sobrenome: 'Admin', perfil: 'ADMIN' });
    await seedUser({ matricula: 'F4-LDR', nome: 'Leo', sobrenome: 'Lider', perfil: 'LIDER' });
    mec = await seedUser({ matricula: 'F4-MEC', nome: 'Mario', sobrenome: 'Mec', perfil: 'MECANICO' });

    adminToken = (await login(app, 'F4-ADM', DEV_ADMIN)).accessToken;
    liderToken = (await login(app, 'F4-LDR', DEV_LIDER)).accessToken;
    mecToken = (await login(app, 'F4-MEC', DEV_MEC)).accessToken;

    const c = await app.inject({
      method: 'POST',
      url: '/deposits',
      headers: auth(liderToken, DEV_LIDER),
      payload: { numero: '4401', nome: 'Goldbox Central', matriculaConfirmacao: 'F4-LDR' },
    });
    assert.equal(c.statusCode, 200, c.body);
    dep = c.json().deposito.id;

    const imp = await app.inject({
      method: 'POST',
      url: `/deposits/${dep}/enxoval/import`,
      headers: auth(liderToken, DEV_LIDER),
      payload: { motivo: 'Base fase04', matriculaConfirmacao: 'F4-LDR', itens: itensV1() },
    });
    assert.equal(imp.statusCode, 200, imp.body);
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  async function baixa(overrides: Record<string, unknown> = {}) {
    return app.inject({
      method: 'POST',
      url: `/deposits/${dep}/goldbox/baixa`,
      headers: auth(liderToken, DEV_LIDER),
      payload: {
        operationId: 'op-' + Math.random().toString(36).slice(2, 10),
        codigoSap: '1002341',
        descricao: 'Baixa em teste',
        quantidade: 2,
        reposicao: true,
        origem: 'ONLINE',
        dispositivo: 'test-pwa',
        dataHora: new Date().toISOString(),
        assinaturaMatricula: 'F4-LDR',
        ...overrides,
      },
    });
  }

  describe('baixa', () => {
    it('baixa simples debita o saldo e grava histórico + auditoria', async () => {
      const res = await baixa({ quantidade: 2 });
      assert.equal(res.statusCode, 200, res.body);
      const body = res.json();
      assert.equal(body.jaProcessada, false);
      assert.equal(body.saldo, 8);
      assert.equal(body.divergenciaCriada, false);
      assert.equal(body.baixa.quantidade, 2);
      assert.equal(body.baixa.statusSync, 'ENVIADO');
      assert.equal(body.baixa.nomeCompleto, 'Leo Lider');

      const pool = getPool();
      const audit = await pool.query(
        "SELECT * FROM audit_logs WHERE deposito_id = $1 AND tipo = 'BAIXA'",
        [dep],
      );
      assert.equal(audit.rows.length, 1);
    });

    it('operationId repetida não debita de novo (idempotência)', async () => {
      const first = await baixa({ quantidade: 2 });
      const operationId = first.json().baixa.operationId;
      assert.equal(operationId, first.json().baixa.operationId);
      const again = await baixa({ quantidade: 2, operationId });
      assert.equal(again.statusCode, 200);
      assert.equal(again.json().jaProcessada, true);

      const pool = getPool();
      const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM goldbox_movements WHERE operation_id = $1',
        [operationId],
      );
      assert.equal(rows[0].n, 1);
    });

    it('saldo pode ficar negativo → cria divergência SALDO_NEGATIVO', async () => {
      const res = await baixa({ codigoSap: '1002343', quantidade: 5 });
      assert.equal(res.statusCode, 200, res.body);
      const body = res.json();
      assert.equal(body.saldo, -4);
      assert.equal(body.divergenciaCriada, true);

      const pool = getPool();
      const div = await pool.query(
        "SELECT * FROM divergences WHERE deposito_id = $1 AND tipo = 'SALDO_NEGATIVO'",
        [dep],
      );
      assert.equal(div.rows.length, 1);
      assert.equal(div.rows[0].status, 'ABERTA');

      const audit = await pool.query(
        "SELECT * FROM audit_logs WHERE deposito_id = $1 AND tipo = 'DIVERGENCIA'",
        [dep],
      );
      assert.equal(audit.rows.length, 1);
    });

    it('item fora do enxoval atual → 404 ITEM_INDISPONIVEL', async () => {
      const res = await baixa({ codigoSap: '9999999' });
      assert.equal(res.statusCode, 404, res.body);
      assert.equal(res.json().error.code, 'ITEM_INDISPONIVEL');
    });

    it('matrícula de confirmação divergente → 403 MATRICULA_INVALIDA', async () => {
      const res = await baixa({ quantidade: 1, matriculaConfirmacao: 'F4-MEC' });
      assert.equal(res.statusCode, 403, res.body);
      assert.equal(res.json().error.code, 'MATRICULA_INVALIDA');
    });

    it('mecânico sem acesso → 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/goldbox/baixa`,
        headers: auth(mecToken, DEV_MEC),
        payload: {
          operationId: 'op-noperm-' + Math.random(),
          codigoSap: '1002341',
          quantidade: 1,
          reposicao: false,
          origem: 'ONLINE',
          dispositivo: 'test-pwa',
          dataHora: new Date().toISOString(),
          assinaturaMatricula: 'F4-MEC',
        },
      });
      assert.equal(res.statusCode, 403, res.body);
    });

    it('mecânico com acesso baixa normalmente', async () => {
      await grantDepositAccess({ userId: mec.id, depositoId: dep, concedidoPor: 'F4-LDR' });
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/goldbox/baixa`,
        headers: auth(mecToken, DEV_MEC),
        payload: {
          operationId: 'op-mec-' + Math.random(),
          codigoSap: '1002342',
          quantidade: 1,
          reposicao: false,
          origem: 'ONLINE',
          dispositivo: 'test-pwa',
          dataHora: new Date().toISOString(),
          assinaturaMatricula: 'F4-MEC',
          matriculaConfirmacao: 'F4-MEC',
        },
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().baixa.nomeCompleto, 'Mario Mec');
    });

    it('depósito inativo → 409', async () => {
      const pool = getPool();
      await pool.query("UPDATE deposits SET status = 'INATIVO' WHERE id = $1", [dep]);
      const res = await baixa({ quantidade: 1 });
      assert.equal(res.statusCode, 409, res.body);
      await pool.query("UPDATE deposits SET status = 'ATIVO' WHERE id = $1", [dep]);
    });
  });

  describe('estorno', () => {
    it('mecânico não pode estornar (403)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/goldbox/estorno`,
        headers: auth(mecToken, DEV_MEC),
        payload: { operationId: 'opx-' + Math.random().toString(36).slice(2, 10), operationIdOriginal: 'op-qualquer', motivo: 'tentativa inválida', assinaturaMatricula: 'F4-MEC' },
      });
      assert.equal(res.statusCode, 403, res.body);
    });

    it('líder estorna e restaura o saldo', async () => {
      const first = await baixa({ quantidade: 2 });
      const originalOp = first.json().baixa.operationId;
      const saldoAntes = first.json().saldo;

      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/goldbox/estorno`,
        headers: auth(liderToken, DEV_LIDER),
        payload: {
          operationId: 'op-estorno-' + Math.random(),
          operationIdOriginal: originalOp,
          motivo: 'Contagem divergiu na conferência',
          assinaturaMatricula: 'F4-LDR',
          matriculaConfirmacao: 'F4-LDR',
        },
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().estorno.estornoDe, originalOp);
      assert.equal(res.json().estorno.quantidade, -2);
      assert.equal(res.json().saldo, saldoAntes + 2);
    });

    it('estornar duas vezes o mesmo movimento → 409', async () => {
      const first = await baixa({ quantidade: 1 });
      const originalOp = first.json().baixa.operationId;
      const est = () =>
        app.inject({
          method: 'POST',
          url: `/deposits/${dep}/goldbox/estorno`,
          headers: auth(liderToken, DEV_LIDER),
          payload: { operationId: 'oprest' + Math.random().toString(36).slice(2, 10), operationIdOriginal: originalOp, motivo: 'duplo', assinaturaMatricula: 'F4-LDR' },
        });
      assert.equal((await est()).statusCode, 200);
      const again = await est();
      assert.equal(again.statusCode, 409, again.body);
    });

    it('estorno de movimento inexistente → 404', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/goldbox/estorno`,
        headers: auth(liderToken, DEV_LIDER),
        payload: { operationId: 'op-x-' + Math.random(), operationIdOriginal: 'op-nao-existe', motivo: 'inexistente', assinaturaMatricula: 'F4-LDR' },
      });
      assert.equal(res.statusCode, 404, res.body);
    });

    it('estorno não apaga o movimento original (auditoria ESTORNO)', async () => {
      const pool = getPool();
      const est = await pool.query("SELECT COUNT(*)::int AS n FROM audit_logs WHERE deposito_id = $1 AND tipo = 'ESTORNO'", [dep]);
      assert.ok(est.rows[0].n >= 1);
    });
  });

  describe('histórico', () => {
    it('lista movimentos com filtro de item', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/deposits/${dep}/goldbox?codigoSap=1002341`,
        headers: auth(liderToken, DEV_LIDER),
      });
      assert.equal(res.statusCode, 200);
      const movs = res.json().movimentos as Array<{ codigoSap: string }>;
      assert.ok(movs.length > 0);
      assert.ok(movs.every((m) => m.codigoSap === '1002341'));
    });

    it('filtro tipo=BAIXA exclui estornos', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/deposits/${dep}/goldbox?tipo=BAIXA`,
        headers: auth(liderToken, DEV_LIDER),
      });
      assert.equal(res.statusCode, 200);
      const movs = res.json().movimentos as Array<{ estornoDe?: string }>;
      assert.ok(movs.every((m) => !m.estornoDe));
    });

    it('filtro tipo=ESTORNO retorna somente estornos', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/deposits/${dep}/goldbox?tipo=ESTORNO`,
        headers: auth(liderToken, DEV_LIDER),
      });
      assert.equal(res.statusCode, 200);
      const movs = res.json().movimentos as Array<{ estornoDe?: string }>;
      assert.ok(movs.length > 0);
      assert.ok(movs.every((m) => !!m.estornoDe));
    });

    it('filtro por usuário (matrícula)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/deposits/${dep}/goldbox?usuario=F4-MEC`,
        headers: auth(liderToken, DEV_LIDER),
      });
      assert.equal(res.statusCode, 200);
      const movs = res.json().movimentos as Array<{ matricula: string }>;
      assert.ok(movs.length > 0);
      assert.ok(movs.every((m) => m.matricula === 'F4-MEC'));
    });

    it('query inválida → 400', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/deposits/${dep}/goldbox?reposicao=nao-booleano`,
        headers: auth(liderToken, DEV_LIDER),
      });
      assert.equal(res.statusCode, 400, res.body);
    });
  });
});