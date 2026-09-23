import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app';
import { ensureMigrated, resetDb } from './helpers';
import { closePool, getPool } from '../src/db/pool';
import { createUser } from '../src/repos/usersRepo';
import { grantDepositAccess } from '../src/repos/depositsRepo';

const DEV_ADMIN = 'dev-fase03-admin';
const DEV_LIDER = 'dev-fase03-lider';
const DEV_MEC = 'dev-fase03-mecanico';

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
    { codigoSap: '1002343', textoBreve: 'Arruela M8', qtdOficial: 30, qtdAtual: 30, utilizacaoLivre: false },
  ];
}

function itensV2() {
  return [
    ...itensV1().slice(0, 2),
    { codigoSap: '1002344', textoBreve: 'Óleo 5W30', qtdOficial: 4, qtdAtual: 4, utilizacaoLivre: true, unidadeMedida: 'L' },
  ];
}

describe('fase03 - enxoval (cadastro por importação e consulta)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let liderToken: string;
  let mecToken: string;
  let mec: Awaited<ReturnType<typeof seedUser>>;
  let depAtivo: string;
  let depOutro: string;

  before(async () => {
    await ensureMigrated();
    await resetDb();
    app = await buildApp({ jwtSecret: 'test-secret' });

    await seedUser({ matricula: 'F3-ADM', nome: 'Ana', sobrenome: 'Admin', perfil: 'ADMIN' });
    await seedUser({ matricula: 'F3-LDR', nome: 'Leo', sobrenome: 'Lider', perfil: 'LIDER' });
    mec = await seedUser({ matricula: 'F3-MEC', nome: 'Mario', sobrenome: 'Mec', perfil: 'MECANICO' });

    adminToken = (await login(app, 'F3-ADM', DEV_ADMIN)).accessToken;
    liderToken = (await login(app, 'F3-LDR', DEV_LIDER)).accessToken;
    mecToken = (await login(app, 'F3-MEC', DEV_MEC)).accessToken;

    const c1 = await app.inject({
      method: 'POST',
      url: '/deposits',
      headers: auth(liderToken, DEV_LIDER),
      payload: { numero: '3301', nome: 'Galpão Centro', matriculaConfirmacao: 'F3-LDR' },
    });
    depAtivo = c1.json().deposito.id;

    const c2 = await app.inject({
      method: 'POST',
      url: '/deposits',
      headers: auth(liderToken, DEV_LIDER),
      payload: { numero: '3302', nome: 'Galpão Norte', matriculaConfirmacao: 'F3-LDR' },
    });
    depOutro = c2.json().deposito.id;
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  async function importarEnxoval(depositoId: string, itens: unknown[]) {
    return app.inject({
      method: 'POST',
      url: `/deposits/${depositoId}/enxoval/import`,
      headers: auth(liderToken, DEV_LIDER),
      payload: {
        motivo: 'Importação da lista oficial',
        matriculaConfirmacao: 'F3-LDR',
        itens,
      },
    });
  }

  describe('importação (publicação de versão 1)', () => {
    it('líder importa enxoval e publica a versão 1', async () => {
      const res = await importarEnxoval(depAtivo, itensV1());
      assert.equal(res.statusCode, 200, res.body);
      const body = res.json();
      assert.equal(body.versao.versao, 1);
      assert.equal(body.itens.length, 3);
      const saps = (body.itens as Array<{ codigoSap: string }>).map((i) => i.codigoSap);
      assert.deepEqual([...saps].sort(), ['1002341', '1002342', '1002343']);
      assert.ok(body.itens.every((i: { qtdAtual: number }) => i.qtdAtual >= 0));
    });

    it('depósito passa a referenciar a versão atual', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/deposits/${depAtivo}`,
        headers: auth(liderToken, DEV_LIDER),
      });
      assert.equal(res.statusCode, 200);
      assert.ok(res.json().deposito.versaoAtualEnxoval);
    });

    it('log de publicação gravado (auditoria)', async () => {
      const pool = getPool();
      const { rows } = await pool.query(
        "SELECT tipo, motivo FROM audit_logs WHERE deposito_id = $1 AND tipo = 'PUBLICACAO_ENXOVAL'",
        [depAtivo],
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].motivo, 'Importação da lista oficial');
    });
  });

  describe('consulta do enxoval', () => {
    it('GET enxoval retorna itens da versão atual', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/deposits/${depAtivo}/enxoval`,
        headers: auth(liderToken, DEV_LIDER),
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.versao.versao, 1);
      assert.equal(body.itens.length, 3);
    });

    it('GET versions lista as versões', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/deposits/${depAtivo}/enxoval/versions`,
        headers: auth(liderToken, DEV_LIDER),
      });
      assert.equal(res.statusCode, 200);
      const versoes = res.json().versoes as Array<{ versao: number }>;
      assert.equal(versoes.length, 1);
      assert.equal(versoes[0].versao, 1);
    });

    it('GET version detail retorna os itens da versão', async () => {
      const list = await app.inject({
        method: 'GET',
        url: `/deposits/${depAtivo}/enxoval/versions`,
        headers: auth(liderToken, DEV_LIDER),
      });
      const v1 = (list.json().versoes as Array<{ id: string }>)[0];
      const res = await app.inject({
        method: 'GET',
        url: `/deposits/${depAtivo}/enxoval/versions/${v1.id}`,
        headers: auth(liderToken, DEV_LIDER),
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().itens.length, 3);
    });
  });

  describe('permissões e isolamento', () => {
    it('mecânico sem acesso não consulta enxoval (403)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/deposits/${depAtivo}/enxoval`,
        headers: auth(mecToken, DEV_MEC),
      });
      assert.equal(res.statusCode, 403);
    });

    it('mecânico com acesso consulta mas não importa (403)', async () => {
      await grantDepositAccess({ userId: mec.id, depositoId: depAtivo, concedidoPor: 'F3-LDR' });

      const leitura = await app.inject({
        method: 'GET',
        url: `/deposits/${depAtivo}/enxoval`,
        headers: auth(mecToken, DEV_MEC),
      });
      assert.equal(leitura.statusCode, 200);
      assert.equal(leitura.json().itens.length, 3);

      const importar = await app.inject({
        method: 'POST',
        url: `/deposits/${depAtivo}/enxoval/import`,
        headers: auth(mecToken, DEV_MEC),
        payload: { motivo: 'Tentativa sem permissão', matriculaConfirmacao: 'F3-MEC', itens: itensV1() },
      });
      assert.equal(importar.statusCode, 403);
    });

    it('matrícula de confirmação divergente → 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${depAtivo}/enxoval/import`,
        headers: auth(liderToken, DEV_LIDER),
        payload: {
          motivo: 'Matrícula errada de propósito',
          matriculaConfirmacao: 'F3-MEC',
          itens: itensV1(),
        },
      });
      assert.equal(res.statusCode, 403);
    });

    it('enxoval sem itens → 400 (validação)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${depAtivo}/enxoval/import`,
        headers: auth(liderToken, DEV_LIDER),
        payload: { motivo: 'Lista vazia não pode publicar', matriculaConfirmacao: 'F3-LDR', itens: [] },
      });
      assert.equal(res.statusCode, 400);
    });
  });

  describe('nova versão (publicação 2)', () => {
    it('líder publica versão 2 e a anterior vira SUBSTITUIDA', async () => {
      const res = await importarEnxoval(depAtivo, itensV2());
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().versao.versao, 2);
      assert.equal(res.json().itens.length, 3);

      const atual = await app.inject({
        method: 'GET',
        url: `/deposits/${depAtivo}/enxoval`,
        headers: auth(liderToken, DEV_LIDER),
      });
      assert.equal(atual.json().versao.versao, 2);
      const saps = (atual.json().itens as Array<{ codigoSap: string }>).map((i) => i.codigoSap);
      assert.ok(saps.includes('1002344'));
      assert.ok(!saps.includes('1002343'));

      const versions = await app.inject({
        method: 'GET',
        url: `/deposits/${depAtivo}/enxoval/versions`,
        headers: auth(liderToken, DEV_LIDER),
      });
      const list = versions.json().versoes as Array<{ versao: number; status: string; id: string }>;
      assert.equal(list.length, 2);
      assert.deepEqual(
        list.map((v) => v.versao).sort(),
        [1, 2],
      );
      const v1 = list.find((v) => v.versao === 1)!;
      assert.equal(v1.status, 'SUBSTITUIDA');

      const v1D = await app.inject({
        method: 'GET',
        url: `/deposits/${depAtivo}/enxoval/versions/${v1.id}`,
        headers: auth(liderToken, DEV_LIDER),
      });
      assert.equal(v1D.json().itens.length, 3);
      assert.ok((v1D.json().itens as Array<{ codigoSap: string }>).some((i) => i.codigoSap === '1002343'));
    });
  });

  describe('isolamento entre depósitos no enxoval', () => {
    it('depósito sem enxoval → versão nula e lista vazia', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/deposits/${depOutro}/enxoval`,
        headers: auth(liderToken, DEV_LIDER),
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().versao, null);
      assert.equal(res.json().itens.length, 0);
    });
  });
});