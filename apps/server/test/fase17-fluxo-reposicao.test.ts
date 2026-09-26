import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app';
import { ensureMigrated, resetDb } from './helpers';
import { closePool, getPool } from '../src/db/pool';
import { createUser } from '../src/repos/usersRepo';
import { grantDepositAccess } from '../src/repos/depositsRepo';

const DEV_LIDER = 'dev-fase17-lider';
const DEV_MEC = 'dev-fase17-mec';

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

describe('fase17 - pendência de baixa na conferência e baixa com "é reposição"', () => {
  let app: FastifyInstance;
  let liderToken: string;
  let dep: string;
  let inspecaoMenorId: string;

  before(async () => {
    await ensureMigrated();
    await resetDb();
    app = await buildApp({ jwtSecret: 'test-secret' });

    const lider = await seedUser({ matricula: 'F7-LDR', nome: 'Leo', sobrenome: 'Lider', perfil: 'LIDER' });
    const mec = await seedUser({ matricula: 'F7-MEC', nome: 'Mario', sobrenome: 'Mec', perfil: 'MECANICO' });

    liderToken = (await login(app, 'F7-LDR', DEV_LIDER)).accessToken;
    const mecToken = (await login(app, 'F7-MEC', DEV_MEC)).accessToken;

    const c = await app.inject({
      method: 'POST',
      url: '/deposits',
      headers: auth(liderToken, DEV_LIDER),
      payload: { numero: '4701', nome: 'Fluxo Reposição', matriculaConfirmacao: 'F7-LDR' },
    });
    assert.equal(c.statusCode, 200, c.body);
    dep = c.json().deposito.id;
    await grantDepositAccess({ userId: mec.id, depositoId: dep, concedidoPor: lider.id });

    const imp = await app.inject({
      method: 'POST',
      url: `/deposits/${dep}/enxoval/import`,
      headers: auth(liderToken, DEV_LIDER),
      payload: {
        motivo: 'Base fase17',
        matriculaConfirmacao: 'F7-LDR',
        itens: [
          { codigoSap: '1002341', textoBreve: 'Parafuso M8x20', qtdOficial: 10, qtdAtual: 10, utilizacaoLivre: true, unidadeMedida: 'pç' },
          { codigoSap: '1002342', textoBreve: 'Porca M8', qtdOficial: 20, qtdAtual: 20, utilizacaoLivre: false, unidadeMedida: 'pç' },
          { codigoSap: '1002343', textoBreve: 'Arruela M8', qtdOficial: 1, qtdAtual: 1, utilizacaoLivre: false, unidadeMedida: 'pç' },
        ],
      },
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
        operationId: 'op-f17-' + Math.random().toString(36).slice(2, 10),
        codigoSap: '1002341',
        descricao: 'Baixa fase17',
        quantidade: 2,
        reposicao: true,
        origem: 'ONLINE',
        dispositivo: 'test-pwa',
        dataHora: new Date().toISOString(),
        assinaturaMatricula: 'F7-LDR',
        matriculaConfirmacao: 'F7-LDR',
        ...overrides,
      },
    });
  }

  async function contaReposicaoAberta(sap = '1002341') {
    const pool = getPool();
    const res = await pool.query(
      "SELECT COUNT(*)::int AS n FROM divergences WHERE deposito_id = $1 AND tipo = 'REPOSICAO' AND status = 'ABERTA' AND codigo_sap = $2",
      [dep, sap],
    );
    return (res.rows[0] as { n: number }).n;
  }

  describe('conferência registra pendência de baixa', () => {
    it('físico menor que o sistema → pendenciaBaixa=true e qtdOficial do enxoval lançado', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/inspections`,
        headers: auth(liderToken, DEV_LIDER),
        payload: {
          hora: '09:00',
          assinaturaMatricula: 'F7-LDR',
          matriculaConfirmacao: 'F7-LDR',
          itens: [{ codigoSap: '1002341', qtdFisica: 7 }],
        },
      });
      assert.equal(res.statusCode, 200, res.body);
      const item = res.json().itens[0];
      assert.equal(item.qtdSistema, 10); // após baixas (ainda sem baixas)
      assert.equal(item.qtdOficial, 10); // enxoval lançado
      assert.equal(item.pendenciaBaixa, true);
      assert.equal(item.diferenca, -3);
      inspecaoMenorId = res.json().inspecao.id;
    });

    it('físico maior que o sistema → pendenciaBaixa=false', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/inspections`,
        headers: auth(liderToken, DEV_LIDER),
        payload: {
          hora: '09:05',
          assinaturaMatricula: 'F7-LDR',
          matriculaConfirmacao: 'F7-LDR',
          itens: [{ codigoSap: '1002342', qtdFisica: 25 }],
        },
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().itens[0].pendenciaBaixa, false);
    });

    it('detalhe da conferência expõe qtdOficial e pendenciaBaixa', async () => {
      const det = await app.inject({
        method: 'GET',
        url: `/deposits/${dep}/inspections/${inspecaoMenorId}`,
        headers: auth(liderToken, DEV_LIDER),
      });
      assert.equal(det.statusCode, 200, det.body);
      const item = det.json().itens.find((i: { codigoSap: string }) => i.codigoSap === '1002341');
      assert.equal(item.qtdOficial, 10);
      assert.equal(item.pendenciaBaixa, true);
    });

    it('após baixas, a conferência guarda lançado (qtdOficial) e pós baixas (qtdSistema) separados', async () => {
      // baixa 3 unidades do 1002341 (sem marcação de reposição para não poluir a lista)
      const b = await baixa({ codigoSap: '1002341', quantidade: 3, reposicao: false });
      assert.equal(b.statusCode, 200, b.body);
      assert.equal(await contaReposicaoAberta(), 0);

      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/inspections`,
        headers: auth(liderToken, DEV_LIDER),
        payload: {
          hora: '10:00',
          assinaturaMatricula: 'F7-LDR',
          matriculaConfirmacao: 'F7-LDR',
          itens: [{ codigoSap: '1002341', qtdFisica: 6 }],
        },
      });
      assert.equal(res.statusCode, 200, res.body);
      const item = res.json().itens[0];
      assert.equal(item.qtdOficial, 10); // enxoval lançado permanece 10
      assert.equal(item.qtdSistema, 7); // após baixas (10 - 3)
      assert.equal(item.pendenciaBaixa, true); // físico 6 < sistema 7
      assert.equal(item.diferenca, -1);
    });
  });

  describe('baixa com "é reposição" alimenta a lista de aguardando reposição', () => {
    it('baixa com é reposição → divergência REPOSICAO ABERTA criada', async () => {
      const res = await baixa({ codigoSap: '1002341', quantidade: 2 });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().divergenciaCriada, false); // saldo continua >= 0
      assert.equal(await contaReposicaoAberta('1002341'), 1);

      const pool = getPool();
      const div = await pool.query(
        "SELECT * FROM divergences WHERE deposito_id = $1 AND codigo_sap = '1002341' AND tipo = 'REPOSICAO' AND status = 'ABERTA'",
        [dep],
      );
      assert.equal(div.rows.length, 1);
      assert.equal(Number(div.rows[0].quantidade), 2);
      assert.equal(div.rows[0].origem_operation_id, res.json().baixa.operationId);
    });

    it('nova baixa com é reposição no mesmo item não duplica a pendência', async () => {
      await baixa({ codigoSap: '1002341', quantidade: 1 });
      assert.equal(await contaReposicaoAberta('1002341'), 1);
    });

    it('baixa sem é reposição não cria REPOSICAO', async () => {
      await baixa({ codigoSap: '1002342', quantidade: 1, reposicao: false });
      const pool = getPool();
      const res = await pool.query(
        "SELECT COUNT(*)::int AS n FROM divergences WHERE deposito_id = $1 AND codigo_sap = '1002342' AND tipo = 'REPOSICAO'",
        [dep],
      );
      assert.equal(res.rows[0].n, 0);
    });

    it('baixa que zera/negativa o saldo + é reposição → SALDO_NEGATIVO e REPOSICAO', async () => {
      const res = await baixa({ codigoSap: '1002343', quantidade: 3 });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().divergenciaCriada, true);
      const pool = getPool();
      const saldo = await pool.query(
        "SELECT COUNT(*)::int AS n FROM divergences WHERE deposito_id = $1 AND codigo_sap = '1002343' AND status = 'ABERTA'",
        [dep],
      );
      assert.equal(saldo.rows[0].n, 2); // SALDO_NEGATIVO + REPOSICAO
    });

    it('a entrada de material resolve a pendência da lista (REPOSICAO → RESOLVIDA)', async () => {
      const entrada = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/goldbox/entrada`,
        headers: auth(liderToken, DEV_LIDER),
        payload: {
          operationId: 'op-f17-ent-' + Math.random().toString(36).slice(2, 10),
          codigoSap: '1002341',
          quantidade: 5,
          origem: 'ONLINE',
          dispositivo: 'test-pwa',
          dataHora: new Date().toISOString(),
          assinaturaMatricula: 'F7-LDR',
          matriculaConfirmacao: 'F7-LDR',
        },
      });
      assert.equal(entrada.statusCode, 200, entrada.body);
      assert.equal(entrada.json().divergenciasFechadas, 1);
      assert.equal(await contaReposicaoAberta('1002341'), 0);

      const pool = getPool();
      const div = await pool.query(
        "SELECT * FROM divergences WHERE deposito_id = $1 AND codigo_sap = '1002341' AND tipo = 'REPOSICAO'",
        [dep],
      );
      assert.equal(div.rows[0].status, 'RESOLVIDA');
      assert.equal(div.rows[0].resolvido_por, 'F7-LDR');
    });
  });
});