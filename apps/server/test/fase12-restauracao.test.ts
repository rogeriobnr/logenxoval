import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app';
import { ensureMigrated, resetDb } from './helpers';
import { closePool } from '../src/db/pool';
import { createUser } from '../src/repos/usersRepo';
import { grantDepositAccess } from '../src/repos/depositsRepo';

const DEV_LDR = 'dev-fase12-lider';
const DEV_MEC = 'dev-fase12-mec';

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

function itensLote(n: number): Array<Record<string, unknown>> {
  return [1002341, 1002342, 1002343].slice(0, n).map((sap, i) => ({
    codigoSap: String(sap),
    textoBreve: `Item ${sap}`,
    qtdOficial: 10 + i,
    qtdAtual: 10 + i,
    utilizacaoLivre: true,
  }));
}

describe('fase12 - snapshots e restauração de versão (teste #20)', () => {
  let app: FastifyInstance;
  let liderToken: string;
  let mecToken: string;
  let mecId: string;
  let dep: string;

  before(async () => {
    await ensureMigrated();
    await resetDb();
    app = await buildApp({ jwtSecret: 'test-secret' });

    const lider = await seedUser({ matricula: 'F12-LDR', nome: 'Leo', sobrenome: 'Lider', perfil: 'LIDER' });
    const mec = await seedUser({ matricula: 'F12-MEC', nome: 'Mario', sobrenome: 'Mec', perfil: 'MECANICO' });
    mecId = mec.id;

    liderToken = (await login(app, 'F12-LDR', DEV_LDR)).accessToken;
    mecToken = (await login(app, 'F12-MEC', DEV_MEC)).accessToken;

    const c = await app.inject({
      method: 'POST',
      url: '/deposits',
      headers: auth(liderToken, DEV_LDR),
      payload: { numero: '5512', nome: 'Depósito Restauração', matriculaConfirmacao: 'F12-LDR' },
    });
    assert.equal(c.statusCode, 200, c.body);
    dep = c.json().deposito.id;
    await grantDepositAccess({ userId: mec.id, depositoId: dep, concedidoPor: lider.id });
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  async function importarEnxoval(itens: unknown[]) {
    return app.inject({
      method: 'POST',
      url: `/deposits/${dep}/enxoval/import`,
      headers: auth(liderToken, DEV_LDR),
      payload: { motivo: 'Importação da lista oficial', matriculaConfirmacao: 'F12-LDR', itens },
    });
  }

  async function registrarBaixa(op: string, quantidade: number) {
    return app.inject({
      method: 'POST',
      url: `/deposits/${dep}/goldbox/baixa`,
      headers: auth(liderToken, DEV_LDR),
      payload: {
        operationId: op,
        codigoSap: '1002341',
        descricao: 'Item 1002341',
        quantidade,
        reposicao: false,
        origem: 'ONLINE',
        dispositivo: DEV_LDR,
        dataHora: '2026-09-24T09:00:00.000Z',
        assinaturaMatricula: 'F12-LDR',
        matriculaConfirmacao: 'F12-LDR',
      },
    });
  }

  async function restaurar(snapshotId: string, extra?: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: `/deposits/${dep}/snapshots/${snapshotId}/restore`,
      headers: auth(liderToken, DEV_LDR),
      payload: { motivo: 'Correção de versão após inconsistência detectada', matriculaConfirmacao: 'F12-LDR', ...extra },
    });
  }

  it('lista snapshots vazia antes de qualquer publicação', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/snapshots`,
      headers: auth(liderToken, DEV_LDR),
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json().snapshots, []);
  });

  it('publica v1 (3 itens) e v2 (2 itens) com um movimento goldbox', async () => {
    const v1 = await importarEnxoval(itensLote(3));
    assert.equal(v1.statusCode, 200, v1.body);
    assert.equal(v1.json().versao.versao, 1);

    const baixa = await registrarBaixa('op-f12-baixa-1', 2);
    assert.equal(baixa.statusCode, 200, baixa.body);

    const v2 = await importarEnxoval(itensLote(2));
    assert.equal(v2.statusCode, 200, v2.body);
    assert.equal(v2.json().versao.versao, 2);
  });

  it('lista snapshots com metadados (sem payload) e localiza o da v1', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/snapshots`,
      headers: auth(liderToken, DEV_LDR),
    });
    assert.equal(res.statusCode, 200, res.body);
    const snaps = res.json().snapshots as Array<Record<string, unknown>>;
    assert.ok(snaps.length >= 2);
    const v1 = snaps.find((s) => (s.titulo as string).includes('pós-publicação v1'));
    assert.ok(v1, `snapshot da v1 não encontrado: ${JSON.stringify(snaps)}`);
    assert.equal(v1.tipo, 'DEPOIS');
    assert.ok(v1.id);
    assert.ok(v1.dataEm);
    assert.equal('payload' in v1, false);
  });

  it('mecânico não pode restaurar → 403', async () => {
    const lista = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/snapshots`,
      headers: auth(mecToken, DEV_MEC),
    });
    const snapshotId = lista.json().snapshots[0].id;
    const res = await app.inject({
      method: 'POST',
      url: `/deposits/${dep}/snapshots/${snapshotId}/restore`,
      headers: auth(mecToken, DEV_MEC),
      payload: { motivo: 'Tentativa sem permissão de mecânico', matriculaConfirmacao: 'F12-MEC' },
    });
    assert.equal(res.statusCode, 403, res.body);
  });

  it('matrícula de confirmação divergente → 403', async () => {
    const lista = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/snapshots`,
      headers: auth(liderToken, DEV_LDR),
    });
    const snapshotId = lista.json().snapshots[0].id;
    const res = await restaurar(snapshotId, { matriculaConfirmacao: 'F12-MEC' });
    assert.equal(res.statusCode, 403, res.body);
  });

  it('snapshot inexistente → 404', async () => {
    const res = await restaurar('snapshot-inexistente-001');
    assert.equal(res.statusCode, 404, res.body);
  });

  it('restaura o snapshot da v1 criando nova versão 3 que preserva histórico e goldbox (teste #20)', async () => {
    const goldboxAntes = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/goldbox`,
      headers: auth(liderToken, DEV_LDR),
    });
    const movAntes = goldboxAntes.json().movimentos as Array<{ id: string }>;

    const lista = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/snapshots`,
      headers: auth(liderToken, DEV_LDR),
    });
    const snaps = lista.json().snapshots as Array<{ id: string; titulo: string }>;
    const v1 = snaps.find((s) => s.titulo.includes('pós-publicação v1'));
    assert.ok(v1);

    const res = await restaurar(v1.id);
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.versao.versao, 3);
    assert.equal(body.versao.status, 'PUBLICADA');
    assert.equal(body.itens.length, 3, 'enxoval restaurado deve voltar com os 3 itens da v1');

    // Versão atual do depósito aponta para a versão 3.
    const depRes = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}`,
      headers: auth(liderToken, DEV_LDR),
    });
    assert.equal(depRes.json().deposito.versaoAtualEnxoval, body.versao.id);

    // Histórico preservado: v1 e v2 ficam SUBSTITUIDA, v3 PUBLICADA.
    const vers = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/enxoval/versions`,
      headers: auth(liderToken, DEV_LDR),
    });
    const versoes = vers.json().versoes as Array<{ versao: number; status: string }>;
    assert.equal(versoes.length, 3);
    const porNumero = Object.fromEntries(versoes.map((v) => [v.versao, v.status]));
    assert.equal(porNumero[1], 'SUBSTITUIDA');
    assert.equal(porNumero[2], 'SUBSTITUIDA');
    assert.equal(porNumero[3], 'PUBLICADA');

    // Goldbox preservado (não foi tocado pela restauração).
    const goldboxDepois = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/goldbox`,
      headers: auth(liderToken, DEV_LDR),
    });
    const movDepois = goldboxDepois.json().movimentos as Array<{ id: string }>;
    assert.deepEqual(movDepois.map((m) => m.id), movAntes.map((m) => m.id));

    // Auditoria registrar RESTAURACAO e o segundo snapshot DEPOIS pós-restauração.
    const logs = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/logs`,
      headers: auth(liderToken, DEV_LDR),
    });
    const tipos = logs.json().logs.map((l: { tipo: string }) => l.tipo);
    assert.ok(tipos.includes('RESTAURACAO'), `faltou RESTAURACAO: ${tipos.join(',')}`);

    const snapFim = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/snapshots`,
      headers: auth(liderToken, DEV_LDR),
    });
    const snapsFim = snapFim.json().snapshots as Array<{ titulo: string }>;
    assert.ok(snapsFim.some((s) => s.titulo.includes('pós-restauração v3')));
  });
});