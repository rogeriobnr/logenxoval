import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app';
import { ensureMigrated, resetDb } from './helpers';
import { closePool, getPool } from '../src/db/pool';
import { createUser } from '../src/repos/usersRepo';

const DEV_LDR = 'dev-fase05-lider';
const DEV_MEC = 'dev-fase05-mec';
const OP = (n: string) => `op-fase05-${n}`;

async function seedUser(opts: { matricula: string; nome: string; sobrenome: string; perfil: 'MECANICO' | 'LIDER' | 'ADMIN' }) {
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

function payloadBaixa(depositoId: string, device: string, over: Record<string, unknown> = {}) {
  return {
    depositoId,
    codigoSap: '1002341',
    descricao: 'Baixa offline via fila',
    quantidade: 2,
    reposicao: true,
    origem: 'OFFLINE',
    dispositivo: device,
    dataHora: new Date().toISOString(),
    assinaturaMatricula: 'F5-LDR',
    matriculaConfirmacao: 'F5-LDR',
    ...over,
  };
}

interface AckErrs {
  acks: Array<{ operationId: string; status: string }>;
  errors: Array<{ operationId: string; code: string }>;
  conflicts: Array<{ operationId: string; tipo: string }>;
}

async function sync(app: FastifyInstance, token: string, device: string, depositoId: string, operations: unknown[]) {
  const res = await app.inject({
    method: 'POST',
    url: '/sync',
    headers: auth(token, device),
    payload: { deviceId: device, depositoId, operations },
  });
  return { status: res.statusCode, body: res.json() as Partial<AckErrs> };
}

describe('fase05 - sincronização (fila de baixas offline)', () => {
  let app: FastifyInstance;
  let liderToken: string;
  let mecToken: string;
  let dep: string;

  before(async () => {
    await ensureMigrated();
    await resetDb();
    app = await buildApp({ jwtSecret: 'test-secret' });

    await seedUser({ matricula: 'F5-LDR', nome: 'Leo', sobrenome: 'Lider', perfil: 'LIDER' });
    await seedUser({ matricula: 'F5-MEC', nome: 'Mario', sobrenome: 'Mec', perfil: 'MECANICO' });

    liderToken = (await login(app, 'F5-LDR', DEV_LDR)).accessToken;
    mecToken = (await login(app, 'F5-MEC', DEV_MEC)).accessToken;

    const c = await app.inject({
      method: 'POST',
      url: '/deposits',
      headers: auth(liderToken, DEV_LDR),
      payload: { numero: '5501', nome: 'Depósito Sync', matriculaConfirmacao: 'F5-LDR' },
    });
    assert.equal(c.statusCode, 200, c.body);
    dep = c.json().deposito.id;

    const imp = await app.inject({
      method: 'POST',
      url: `/deposits/${dep}/enxoval/import`,
      headers: auth(liderToken, DEV_LDR),
      payload: {
        motivo: 'Base fase05',
        matriculaConfirmacao: 'F5-LDR',
        itens: [
          { codigoSap: '1002341', textoBreve: 'Parafuso M8x20', qtdOficial: 10, qtdAtual: 10, utilizacaoLivre: true, unidadeMedida: 'pç' },
          { codigoSap: '1002342', textoBreve: 'Porca M8', qtdOficial: 1, qtdAtual: 1, utilizacaoLivre: false },
        ],
      },
    });
    assert.equal(imp.statusCode, 200, imp.body);
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  describe('push de baixas offline', () => {
    it('envia baixa offline → ACK OK e movimento com origem OFFLINE', async () => {
      const r = await sync(app, liderToken, DEV_LDR, dep, [
        { operationId: OP('ok'), entidade: 'BAIXA', acao: 'CREATE', payload: payloadBaixa(dep, DEV_LDR) },
      ]);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual(r.body!.acks, [{ operationId: OP('ok'), status: 'OK' }]);
      assert.equal(r.body!.errors!.length, 0);

      const pool = getPool();
      const { rows } = await pool.query(
        'SELECT origem, quantidade, matricula FROM goldbox_movements WHERE operation_id = $1',
        [OP('ok')],
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].origem, 'OFFLINE');
      assert.equal(rows[0].quantidade, 2);
    });

    it('reenvio do mesmo operationId → ACK JA_PROCESSADO, sem duplicar', async () => {
      const r = await sync(app, liderToken, DEV_LDR, dep, [
        { operationId: OP('ok'), entidade: 'BAIXA', acao: 'CREATE', payload: payloadBaixa(dep, DEV_LDR) },
      ]);
      assert.equal(r.body!.acks![0].status, 'JA_PROCESSADO');
      const pool = getPool();
      const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM goldbox_movements WHERE operation_id = $1',
        [OP('ok')],
      );
      assert.equal(rows[0].n, 1);
    });

    it('baixa que deixa saldo negativo → ACK OK + divergência SALDO_NEGATIVO', async () => {
      const r = await sync(app, liderToken, DEV_LDR, dep, [
        {
          operationId: OP('neg'),
          entidade: 'BAIXA',
          acao: 'CREATE',
          payload: payloadBaixa(dep, DEV_LDR, { codigoSap: '1002342', quantidade: 5 }),
        },
      ]);
      assert.equal(r.body!.acks![0].status, 'OK');
      const pool = getPool();
      const { rows } = await pool.query(
        "SELECT COUNT(*)::int AS n FROM divergences WHERE deposito_id = $1 AND tipo = 'SALDO_NEGATIVO'",
        [dep],
      );
      assert.equal(rows[0].n, 1);
    });

    it('masse de operações mistas: válida + inválida → ack e erro isolados', async () => {
      const r = await sync(app, liderToken, DEV_LDR, dep, [
        { operationId: OP('ok2'), entidade: 'BAIXA', acao: 'CREATE', payload: payloadBaixa(dep, DEV_LDR, { quantidade: 1 }) },
        { operationId: OP('bad'), entidade: 'BAIXA', acao: 'CREATE', payload: payloadBaixa(dep, DEV_LDR, { quantidade: -5 }) },
      ]);
      const acks = r.body!.acks!.map((a) => a.operationId);
      const errs = r.body!.errors!;
      assert.ok(acks.includes(OP('ok2')));
      assert.ok(errs.some((e) => e.operationId === OP('bad') && e.code === 'VALIDATION_FAILED'));
    });

    it('item fora do enxoval → erro ITEM_INDISPONIVEL', async () => {
      const r = await sync(app, liderToken, DEV_LDR, dep, [
        { operationId: OP('nope'), entidade: 'BAIXA', acao: 'CREATE', payload: payloadBaixa(dep, DEV_LDR, { codigoSap: '9999999' }) },
      ]);
      assert.equal(r.body!.errors![0].code, 'ITEM_INDISPONIVEL');
    });

    it('payload com depositoId divergente do lote → erro DEPOSITO_NAO_AUTORIZADO', async () => {
      const r = await sync(app, liderToken, DEV_LDR, dep, [
        { operationId: OP('xdep'), entidade: 'BAIXA', acao: 'CREATE', payload: payloadBaixa('outro-dep', DEV_LDR) },
      ]);
      assert.equal(r.body!.errors![0].code, 'DEPOSITO_NAO_AUTORIZADO');
    });

    it('operação de entidade não suportada → 400 (validação do envelope)', async () => {
      const r = await sync(app, liderToken, DEV_LDR, dep, [
        { operationId: OP('q'), entidade: 'CONFERENCIA', acao: 'CREATE', payload: {} },
      ]);
      assert.equal(r.status, 400);
    });

    it('usuário sem acesso ao depósito → 403 no lote inteiro', async () => {
      const r = await sync(app, mecToken, DEV_MEC, dep, [
        { operationId: OP('mec'), entidade: 'BAIXA', acao: 'CREATE', payload: payloadBaixa(dep, DEV_LDR) },
      ]);
      assert.equal(r.status, 403);
    });

    it('corpo inválido (operations ausente) → 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/sync',
        headers: auth(liderToken, DEV_LDR),
        payload: { deviceId: DEV_LDR, depositoId: dep },
      });
      assert.equal(res.statusCode, 400);
    });

    it('auditoria registra as baixas vindas da fila', async () => {
      const pool = getPool();
      const { rows } = await pool.query(
        "SELECT COUNT(*)::int AS n FROM audit_logs WHERE deposito_id = $1 AND tipo = 'BAIXA' AND origem = 'OFFLINE'",
        [dep],
      );
      assert.ok(rows[0].n >= 2, `esperado >=2, veio ${rows[0].n}`);
    });
  });
});