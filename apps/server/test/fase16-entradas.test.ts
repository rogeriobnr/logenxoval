import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app';
import { ensureMigrated, resetDb } from './helpers';
import { closePool, getPool } from '../src/db/pool';
import { createUser } from '../src/repos/usersRepo';
import { grantDepositAccess } from '../src/repos/depositsRepo';

const DEV_ADMIN = 'dev-fase16-admin';
const DEV_LIDER = 'dev-fase16-lider';
const DEV_MEC = 'dev-fase16-mecanico';

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
  ];
}

describe('fase16 - entrada de material (enxoval) e consumível/EPI', () => {
  let app: FastifyInstance;
  let liderToken: string;
  let mecToken: string;
  let dep: string;
  let mec: Awaited<ReturnType<typeof seedUser>>;

  before(async () => {
    await ensureMigrated();
    await resetDb();
    app = await buildApp({ jwtSecret: 'test-secret' });

    await seedUser({ matricula: 'F6-LDR', nome: 'Leo', sobrenome: 'Lider', perfil: 'LIDER' });
    mec = await seedUser({ matricula: 'F6-MEC', nome: 'Mario', sobrenome: 'Mec', perfil: 'MECANICO' });

    liderToken = (await login(app, 'F6-LDR', DEV_LIDER)).accessToken;
    mecToken = (await login(app, 'F6-MEC', DEV_MEC)).accessToken;

    const c = await app.inject({
      method: 'POST',
      url: '/deposits',
      headers: auth(liderToken, DEV_LIDER),
      payload: { numero: '4601', nome: 'Entradas Central', matriculaConfirmacao: 'F6-LDR' },
    });
    assert.equal(c.statusCode, 200, c.body);
    dep = c.json().deposito.id;
    await grantDepositAccess({ userId: mec.id, depositoId: dep, concedidoPor: 'F6-LDR' });

    const imp = await app.inject({
      method: 'POST',
      url: `/deposits/${dep}/enxoval/import`,
      headers: auth(liderToken, DEV_LIDER),
      payload: { motivo: 'Base fase16', matriculaConfirmacao: 'F6-LDR', itens: itensV1() },
    });
    assert.equal(imp.statusCode, 200, imp.body);
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  async function entradaMaterial(payload: Record<string, unknown> = {}) {
    return app.inject({
      method: 'POST',
      url: `/deposits/${dep}/goldbox/entrada`,
      headers: auth(liderToken, DEV_LIDER),
      payload: {
        operationId: 'op-ent-' + Math.random().toString(36).slice(2, 10),
        codigoSap: '1002342',
        quantidade: 3,
        origem: 'ONLINE',
        dispositivo: 'test-pwa',
        dataHora: new Date().toISOString(),
        assinaturaMatricula: 'F6-LDR',
        matriculaConfirmacao: 'F6-LDR',
        ...payload,
      },
    });
  }

  describe('entrada goldbox (enxoval)', () => {
    it('credita o saldo e grava movimento tipo ENTRADA + auditoria', async () => {
      const res = await entradaMaterial({ quantidade: 5 });
      assert.equal(res.statusCode, 200, res.body);
      const body = res.json();
      assert.equal(body.jaProcessada, false);
      assert.equal(body.saldo, 25);
      assert.equal(body.divergenciasFechadas, 0);
      assert.equal(body.entrada.tipo, 'ENTRADA');
      assert.equal(body.entrada.nomeCompleto, 'Leo Lider');
      assert.equal(body.entrada.quantidade, 5);

      const pool = getPool();
      const audit = await pool.query(
        "SELECT COUNT(*)::int AS n FROM audit_logs WHERE deposito_id = $1 AND tipo = 'ENTRADA_MATERIAL'",
        [dep],
      );
      assert.equal(audit.rows[0].n, 1);
    });

    it('operationId repetida não credita de novo (idempotência)', async () => {
      const first = await entradaMaterial({ quantidade: 2 });
      const operationId = first.json().entrada.operationId;
      const saldoApos = first.json().saldo;
      const again = await entradaMaterial({ quantidade: 2, operationId });
      assert.equal(again.statusCode, 200, again.body);
      assert.equal(again.json().jaProcessada, true);

      const pool = getPool();
      const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM goldbox_movements WHERE operation_id = $1',
        [operationId],
      );
      assert.equal(rows[0].n, 1);

      const saldo = await pool.query(
        'SELECT qtd_atual FROM inventory_items WHERE deposito_id = $1 AND codigo_sap = $2',
        [dep, '1002342'],
      );
      assert.equal(saldo.rows[0].qtd_atual, saldoApos);
    });

    it('entrada resolve divergência REPOSICAO pendente do mesmo item', async () => {
      const pool = getPool();
      await pool.query(
        `INSERT INTO divergences (id, deposito_id, codigo_sap, tipo, quantidade, status, criado_em, criado_por)
         VALUES (gen_random_uuid(), $1, '1002342', 'REPOSICAO', 7, 'ABERTA', now(), 'F6-LDR')`,
        [dep],
      );

      const res = await entradaMaterial({ quantidade: 4 });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().divergenciasFechadas, 1);

      const div = await pool.query(
        "SELECT * FROM divergences WHERE deposito_id = $1 AND codigo_sap = '1002342' AND tipo = 'REPOSICAO'",
        [dep],
      );
      assert.equal(div.rows.length, 1);
      assert.equal(div.rows[0].status, 'RESOLVIDA');
      assert.equal(div.rows[0].resolvido_por, 'F6-LDR');

      const audit = await pool.query(
        "SELECT COUNT(*)::int AS n FROM audit_logs WHERE deposito_id = $1 AND tipo = 'REPOSICAO'",
        [dep],
      );
      assert.ok(audit.rows[0].n >= 1);
    });

    it('item fora do enxoval → 404 ITEM_INDISPONIVEL', async () => {
      const res = await entradaMaterial({ codigoSap: '9999999' });
      assert.equal(res.statusCode, 404, res.body);
      assert.equal(res.json().error.code, 'ITEM_INDISPONIVEL');
    });

    it('matrícula de confirmação divergente → 403 MATRICULA_INVALIDA', async () => {
      const res = await entradaMaterial({ matriculaConfirmacao: 'F6-MEC' });
      assert.equal(res.statusCode, 403, res.body);
      assert.equal(res.json().error.code, 'MATRICULA_INVALIDA');
    });

    it('mecânico não pode registrar entrada → 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/goldbox/entrada`,
        headers: auth(mecToken, DEV_MEC),
        payload: {
          operationId: 'op-noperm-' + Math.random(),
          codigoSap: '1002342',
          quantidade: 1,
          origem: 'ONLINE',
          dispositivo: 'test-pwa',
          dataHora: new Date().toISOString(),
          assinaturaMatricula: 'F6-MEC',
        },
      });
      assert.equal(res.statusCode, 403, res.body);
    });

    it('histórico filtra tipo=ENTRADA', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/deposits/${dep}/goldbox?tipo=ENTRADA`,
        headers: auth(liderToken, DEV_LIDER),
      });
      assert.equal(res.statusCode, 200, res.body);
      const movs = res.json().movimentos as Array<{ tipo: string }>;
      assert.ok(movs.length > 0);
      assert.ok(movs.every((m) => m.tipo === 'ENTRADA'));
    });
  });

  describe('entrada consumível/EPI (estoque)', () => {
    async function entradaEstoque(overrides: Record<string, unknown> = {}) {
      const tipo = (overrides.tipo as string) ?? 'CONSUMIVEL';
      return app.inject({
        method: 'POST',
        url: `/deposits/${dep}/estoque/entrada`,
        headers: auth(liderToken, DEV_LIDER),
        payload: {
          operationId: 'op-est-' + Math.random().toString(36).slice(2, 10),
          tipo,
          codigo: 'LUVA-LATEX',
          descricao: 'Luva de látex descartável',
          quantidade: 10,
          origem: 'ONLINE',
          dispositivo: 'test-pwa',
          dataHora: new Date().toISOString(),
          assinaturaMatricula: 'F6-LDR',
          matriculaConfirmacao: 'F6-LDR',
          ...overrides,
        },
      });
    }

    it('cria o item no catálogo quando ainda não existe', async () => {
      const res = await entradaEstoque({ codigo: 'FITA-100', descricao: 'Fita isolante 20m' });
      assert.equal(res.statusCode, 200, res.body);
      const body = res.json();
      assert.equal(body.jaProcessada, false);
      assert.equal(body.criado, true);
      assert.equal(body.saldo, 10);

      const pool = getPool();
      const item = await pool.query('SELECT * FROM consumables WHERE deposito_id = $1 AND codigo = $2', [dep, 'FITA-100']);
      assert.equal(item.rows.length, 1);
      assert.equal(item.rows[0].estoque_atual, 10);
      assert.equal(item.rows[0].descricao, 'Fita isolante 20m');

      const mov = await pool.query(
        'SELECT * FROM consumable_movements WHERE deposito_id = $1 AND tipo = $2',
        [dep, 'ENTRADA'],
      );
      assert.equal(mov.rows.length, 1);

      const audit = await pool.query(
        "SELECT COUNT(*)::int AS n FROM audit_logs WHERE deposito_id = $1 AND tipo = 'ENTRADA_ESTOQUE'",
        [dep],
      );
      assert.equal(audit.rows[0].n, 1);
    });

    it('credita o saldo de item já existente', async () => {
      const res = await entradaEstoque({ codigo: 'FITA-100', quantidade: 5 });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().criado, false);
      assert.equal(res.json().saldo, 15);

      const pool = getPool();
      const item = await pool.query('SELECT estoque_atual FROM consumables WHERE deposito_id = $1 AND codigo = $2', [dep, 'FITA-100']);
      assert.equal(item.rows[0].estoque_atual, 15);
    });

    it('operationId repetida é idempotente', async () => {
      const operationId = 'op-est-rep-' + Math.random().toString(36).slice(2, 10);
      const res = await entradaEstoque({ codigo: 'FITA-100', quantidade: 2, operationId });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().jaProcessada, false);
      assert.equal(res.json().saldo, 17);
      const again = await entradaEstoque({ codigo: 'FITA-100', quantidade: 2, operationId });
      assert.equal(again.statusCode, 200, again.body);
      assert.equal(again.json().jaProcessada, true);
      assert.equal(again.json().saldo, 17);

      const pool = getPool();
      const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM consumable_movements WHERE operation_id = $1',
        [operationId],
      );
      assert.equal(rows[0].n, 1);
    });

    it('EPI cria item em ppe_items', async () => {
      const res = await entradaEstoque({ tipo: 'EPI', codigo: 'CAPACETE', descricao: 'Capacete de segurança' });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().criado, true);

      const pool = getPool();
      const item = await pool.query('SELECT * FROM ppe_items WHERE deposito_id = $1 AND codigo = $2', [dep, 'CAPACETE']);
      assert.equal(item.rows.length, 1);
      assert.equal(item.rows[0].estoque_atual, 10);
    });

    it('tipo inválido → 400', async () => {
      const res = await entradaEstoque({ tipo: 'OUTRO' });
      assert.equal(res.statusCode, 400, res.body);
    });

    it('mecânico não pode registrar entrada de estoque → 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/estoque/entrada`,
        headers: auth(mecToken, DEV_MEC),
        payload: {
          operationId: 'op-noperm-' + Math.random(),
          tipo: 'CONSUMIVEL',
          codigo: 'X',
          descricao: 'Item X',
          quantidade: 1,
          origem: 'ONLINE',
          dispositivo: 'test-pwa',
          dataHora: new Date().toISOString(),
          assinaturaMatricula: 'F6-MEC',
        },
      });
      assert.equal(res.statusCode, 403, res.body);
    });
  });

  describe('sync offline (fila)', () => {
    it('processa ENTRADA_MATERIAL da fila e credita o saldo', async () => {
      const operationId = 'op-sync-mat-' + Math.random().toString(36).slice(2, 10);
      const res = await app.inject({
        method: 'POST',
        url: '/sync',
        headers: auth(liderToken, DEV_LIDER),
        payload: {
          deviceId: DEV_LIDER,
          depositoId: dep,
          operations: [
            {
              operationId,
              entidade: 'ENTRADA_MATERIAL',
              acao: 'CREATE',
              payload: {
                depositoId: dep,
                codigoSap: '1002341',
                quantidade: 2,
                origem: 'OFFLINE',
                dispositivo: 'test-pwa',
                dataHora: new Date().toISOString(),
                assinaturaMatricula: 'F6-LDR',
                matriculaConfirmacao: 'F6-LDR',
              },
            },
          ],
        },
      });
      assert.equal(res.statusCode, 200, res.body);
      const body = res.json();
      assert.deepEqual(body.acks, [{ operationId, status: 'OK' }]);
      assert.deepEqual(body.errors, []);

      const pool = getPool();
      const mov = await pool.query(
        'SELECT * FROM goldbox_movements WHERE operation_id = $1',
        [operationId],
      );
      assert.equal(mov.rows.length, 1);
      assert.equal(mov.rows[0].tipo, 'ENTRADA');
    });

    it('reenvio da mesma operação → ACK JA_PROCESSADO', async () => {
      const operationId = 'op-sync-mat-' + Math.random().toString(36).slice(2, 10);
      const payload = {
        deviceId: DEV_LIDER,
        depositoId: dep,
        operations: [
          {
            operationId,
            entidade: 'ENTRADA_MATERIAL',
            acao: 'CREATE',
            payload: {
              depositoId: dep,
              codigoSap: '1002341',
              quantidade: 1,
              origem: 'OFFLINE',
              dispositivo: 'test-pwa',
              dataHora: new Date().toISOString(),
              assinaturaMatricula: 'F6-LDR',
              matriculaConfirmacao: 'F6-LDR',
            },
          },
        ],
      };
      const first = await app.inject({ method: 'POST', url: '/sync', headers: auth(liderToken, DEV_LIDER), payload });
      assert.equal(first.statusCode, 200, first.body);
      const again = await app.inject({ method: 'POST', url: '/sync', headers: auth(liderToken, DEV_LIDER), payload });
      assert.deepEqual(again.json().acks, [{ operationId, status: 'JA_PROCESSADO' }]);
    });

    it('processa ENTRADA_ESTOQUE da fila e cria o item', async () => {
      const operationId = 'op-sync-est-' + Math.random().toString(36).slice(2, 10);
      const res = await app.inject({
        method: 'POST',
        url: '/sync',
        headers: auth(liderToken, DEV_LIDER),
        payload: {
          deviceId: DEV_LIDER,
          depositoId: dep,
          operations: [
            {
              operationId,
              entidade: 'ENTRADA_ESTOQUE',
              acao: 'CREATE',
              payload: {
                depositoId: dep,
                tipo: 'EPI',
                codigo: 'OCULOS',
                descricao: 'Óculos de proteção',
                quantidade: 6,
                origem: 'OFFLINE',
                dispositivo: 'test-pwa',
                dataHora: new Date().toISOString(),
                assinaturaMatricula: 'F6-LDR',
                matriculaConfirmacao: 'F6-LDR',
              },
            },
          ],
        },
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.deepEqual(res.json().acks, [{ operationId, status: 'OK' }]);

      const pool = getPool();
      const item = await pool.query('SELECT * FROM ppe_items WHERE deposito_id = $1 AND codigo = $2', [dep, 'OCULOS']);
      assert.equal(item.rows.length, 1);
      assert.equal(item.rows[0].estoque_atual, 6);
    });

    it('mecânico na fila com entrada → erros PERMISSAO_NEGADA', async () => {
      const operationId = 'op-sync-mec-' + Math.random().toString(36).slice(2, 10);
      const res = await app.inject({
        method: 'POST',
        url: '/sync',
        headers: auth(mecToken, DEV_MEC),
        payload: {
          deviceId: DEV_MEC,
          depositoId: dep,
          operations: [
            {
              operationId,
              entidade: 'ENTRADA_MATERIAL',
              acao: 'CREATE',
              payload: {
                depositoId: dep,
                codigoSap: '1002341',
                quantidade: 1,
                origem: 'OFFLINE',
                dispositivo: 'test-pwa',
                dataHora: new Date().toISOString(),
                assinaturaMatricula: 'F6-MEC',
              },
            },
          ],
        },
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.deepEqual(res.json().errors, [{ operationId, code: 'PERMISSAO_NEGADA', message: 'Entrada de material exige LIDER ou ADMIN' }]);
    });
  });
});