import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app';
import { ensureMigrated, resetDb } from './helpers';
import { closePool } from '../src/db/pool';
import { createUser } from '../src/repos/usersRepo';
import { grantDepositAccess } from '../src/repos/depositsRepo';

const DEV_LDR = 'dev-fase10-lider';
const DEV_MEC = 'dev-fase10-mec';
const OP = (n: string) => `op-fase10-${n}`;

const ITENS = [
  { codigo: 'LUVA-40', descricao: 'Luvas descartáveis', qtd: 40 },
  { codigo: 'AD-ISOL', descricao: 'Adesivo isolante', qtd: 2 },
];

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

describe('fase10 - consumíveis e EPIs (solicitações)', () => {
  let app: FastifyInstance;
  let liderToken: string;
  let mecToken: string;
  let liderId: string;
  let mecId: string;
  let dep: string;
  let requestId: string;
  let reqLider: string;

  before(async () => {
    await ensureMigrated();
    await resetDb();
    app = await buildApp({ jwtSecret: 'test-secret' });

    const lider = await seedUser({ matricula: 'F10-LDR', nome: 'Leo', sobrenome: 'Lider', perfil: 'LIDER' });
    const mec = await seedUser({ matricula: 'F10-MEC', nome: 'Mario', sobrenome: 'Mec', perfil: 'MECANICO' });
    liderId = lider.id;
    mecId = mec.id;

    liderToken = (await login(app, 'F10-LDR', DEV_LDR)).accessToken;
    mecToken = (await login(app, 'F10-MEC', DEV_MEC)).accessToken;

    const c = await app.inject({
      method: 'POST',
      url: '/deposits',
      headers: auth(liderToken, DEV_LDR),
      payload: { numero: '5510', nome: 'Depósito Consumíveis', matriculaConfirmacao: 'F10-LDR' },
    });
    assert.equal(c.statusCode, 200, c.body);
    dep = c.json().deposito.id;
    await grantDepositAccess({ userId: mec.id, depositoId: dep, concedidoPor: lider.id });
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  it('lista consumíveis e EPIs vazios para qualquer perfil', async () => {
    const cons = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/consumables`,
      headers: auth(mecToken, DEV_MEC),
    });
    assert.equal(cons.statusCode, 200, cons.body);
    assert.deepEqual(cons.json().consumiveis, []);

    const ppe = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/ppe`,
      headers: auth(mecToken, DEV_MEC),
    });
    assert.equal(ppe.statusCode, 200, ppe.body);
    assert.deepEqual(ppe.json().ppe, []);
  });

  it('mecânico cria solicitação de consumível → RASCUNHO + log SOLICITACAO_CRIADA', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/deposits/${dep}/requests`,
      headers: auth(mecToken, DEV_MEC),
      payload: {
        operationId: OP('criar-consumivel'),
        tipo: 'CONSUMIVEL',
        itens: ITENS,
        assinaturaMatricula: 'F10-MEC',
        matriculaConfirmacao: 'F10-MEC',
      },
    });
    assert.equal(res.statusCode, 200, res.body);
    const { solicitacao, jaProcessada } = res.json();
    assert.equal(jaProcessada, false);
    assert.equal(solicitacao.status, 'RASCUNHO');
    assert.equal(solicitacao.tipo, 'CONSUMIVEL');
    assert.equal(solicitacao.matricula, 'F10-MEC');
    assert.equal(solicitacao.itens.length, 2);
    requestId = solicitacao.id;

    const logs = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/logs`,
      headers: auth(mecToken, DEV_MEC),
    });
    const tipos = logs.json().logs.map((l: { tipo: string }) => l.tipo);
    assert.ok(tipos.includes('SOLICITACAO_CRIADA'), `faltou SOLICITACAO_CRIADA: ${tipos.join(',')}`);
  });

  it('duplicar envio da mesma operationId → jaProcessada=true e mesma solicitação', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/deposits/${dep}/requests`,
      headers: auth(mecToken, DEV_MEC),
      payload: {
        operationId: OP('criar-consumivel'),
        tipo: 'CONSUMIVEL',
        itens: ITENS,
        assinaturaMatricula: 'F10-MEC',
        matriculaConfirmacao: 'F10-MEC',
      },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().jaProcessada, true);
    assert.equal(res.json().solicitacao.id, requestId);
  });

  it('dono compartilha → ENVIADA + log SOLICITACAO_ENVIADA', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/deposits/${dep}/requests/${requestId}/transition`,
      headers: auth(mecToken, DEV_MEC),
      payload: { operationId: OP('trans-enviada'), para: 'ENVIADA', assinaturaMatricula: 'F10-MEC' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().solicitacao.status, 'ENVIADA');

    const logs = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/logs`,
      headers: auth(mecToken, DEV_MEC),
    });
    const tipos = logs.json().logs.map((l: { tipo: string }) => l.tipo);
    assert.ok(tipos.includes('SOLICITACAO_ENVIADA'), `faltou SOLICITACAO_ENVIADA: ${tipos.join(',')}`);
  });

  it('mecânico não consegue transicionar solicitação de outra pessoa → 403', async () => {
    const criada = await app.inject({
      method: 'POST',
      url: `/deposits/${dep}/requests`,
      headers: auth(liderToken, DEV_LDR),
      payload: {
        operationId: OP('lider-cria'),
        tipo: 'EPI',
        itens: [{ codigo: 'CAP-5', descricao: 'Capacete', qtd: 5 }],
        assinaturaMatricula: 'F10-LDR',
        matriculaConfirmacao: 'F10-LDR',
      },
    });
    assert.equal(criada.statusCode, 200, criada.body);
    reqLider = criada.json().solicitacao.id;
    assert.equal(criada.json().solicitacao.solicitanteId, liderId);

    for (const para of ['ENVIADA', 'EXCLUIDA']) {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/requests/${reqLider}/transition`,
        headers: auth(mecToken, DEV_MEC),
        payload: { operationId: OP(`mec-nao-pode-${para}`), para, assinaturaMatricula: 'F10-MEC' },
      });
      assert.equal(res.statusCode, 403, res.body);
    }
  });

  it('liderança marca recebido com itens não recebidos → RECEBIDA + log SOLICITACAO_RECEBIDA', async () => {
    const rec = await app.inject({
      method: 'POST',
      url: `/deposits/${dep}/requests/${requestId}/transition`,
      headers: auth(liderToken, DEV_LDR),
      payload: {
        operationId: OP('lider-recebe'),
        para: 'RECEBIDA',
        naoRecebidos: ['AD-ISOL'],
        assinaturaMatricula: 'F10-LDR',
      },
    });
    assert.equal(rec.statusCode, 200, rec.body);
    const sol = rec.json().solicitacao;
    assert.equal(sol.status, 'RECEBIDA');
    const recebidoDe = Object.fromEntries(sol.itens.map((i: { codigo: string; recebido?: boolean }) => [i.codigo, i.recebido]));
    assert.equal(recebidoDe['LUVA-40'], true);
    assert.equal(recebidoDe['AD-ISOL'], false);

    const logs = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/logs`,
      headers: auth(liderToken, DEV_LDR),
    });
    const tipos = logs.json().logs.map((l: { tipo: string }) => l.tipo);
    assert.ok(tipos.includes('SOLICITACAO_RECEBIDA'), `faltou SOLICITACAO_RECEBIDA: ${tipos.join(',')}`);
  });

  it('liderança exclui solicitação → EXCLUIDA + log SOLICITACAO_EXCLUIDA', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/deposits/${dep}/requests/${requestId}/transition`,
      headers: auth(liderToken, DEV_LDR),
      payload: { operationId: OP('lider-exclui'), para: 'EXCLUIDA', assinaturaMatricula: 'F10-LDR' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().solicitacao.status, 'EXCLUIDA');

    const logs = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/logs`,
      headers: auth(liderToken, DEV_LDR),
    });
    const tipos = logs.json().logs.map((l: { tipo: string }) => l.tipo);
    assert.ok(tipos.includes('SOLICITACAO_EXCLUIDA'), `faltou SOLICITACAO_EXCLUIDA: ${tipos.join(',')}`);
  });

  it('lista de solicitações: excluída não aparece; mecânico vê as próprias e líder vê todas', async () => {
    const mec = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/requests`,
      headers: auth(mecToken, DEV_MEC),
    });
    assert.equal(mec.statusCode, 200, mec.body);
    assert.equal(mec.json().solicitacoes.length, 0);

    const ldr = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/requests`,
      headers: auth(liderToken, DEV_LDR),
    });
    assert.equal(ldr.statusCode, 200, ldr.body);
    assert.ok(!ldr.json().solicitacoes.some((r: { id: string }) => r.id === requestId), 'solicitação excluída veio na lista');
    assert.equal(ldr.json().solicitacoes.length, 1);
    assert.equal(ldr.json().solicitacoes[0].id, reqLider);
  });

  it('sincronização com solicitante diferente do usuário → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sync',
      headers: auth(mecToken, DEV_MEC),
      payload: {
        deviceId: DEV_MEC,
        depositoId: dep,
        operations: [
          {
            operationId: OP('sync-epi'),
            entidade: 'SOLICITACAO',
            acao: 'CREATE',
            payload: {
              depositoId: dep,
              solicitanteId: liderId,
              matricula: 'F10-MEC',
              tipo: 'EPI',
              itens: [{ codigo: 'CAP-5', descricao: 'Capacete', qtd: 5 }],
              assinaturaMatricula: 'F10-MEC',
            },
          },
        ],
      },
    });
    assert.equal(res.statusCode, 200, res.body);
    const j = res.json();
    assert.equal(j.acks.length, 0);
    assert.equal(j.errors.length, 1);
    assert.equal(j.errors[0].code, 'PERMISSAO_NEGADA');
  });

  it('sincronização com solicitante correto cria a solicitação (EPI)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sync',
      headers: auth(mecToken, DEV_MEC),
      payload: {
        deviceId: DEV_MEC,
        depositoId: dep,
        operations: [
          {
            operationId: OP('sync-epi'),
            entidade: 'SOLICITACAO',
            acao: 'CREATE',
            payload: {
              depositoId: dep,
              solicitanteId: mecId,
              matricula: 'F10-MEC',
              tipo: 'EPI',
              itens: [{ codigo: 'CAP-5', descricao: 'Capacete', qtd: 5 }],
              assinaturaMatricula: 'F10-MEC',
            },
          },
        ],
      },
    });
    assert.equal(res.statusCode, 200, res.body);
    const { acks, errors } = res.json();
    assert.equal(errors.length, 0, JSON.stringify(errors));
    assert.equal(acks[0].operationId, OP('sync-epi'));

    const ldr = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/requests?tipo=EPI`,
      headers: auth(liderToken, DEV_LDR),
    });
    assert.equal(ldr.statusCode, 200, ldr.body);
    const epi = ldr.json().solicitacoes.find((r: { matricula: string }) => r.matricula === 'F10-MEC');
    assert.ok(epi, 'solicitação EPI não criada pelo sync');
    assert.equal(epi.status, 'RASCUNHO');

    // Transição offline via /sync (entidade SOLICITACAO_TRANSICAO).
    const trans = await app.inject({
      method: 'POST',
      url: '/sync',
      headers: auth(mecToken, DEV_MEC),
      payload: {
        deviceId: DEV_MEC,
        depositoId: dep,
        operations: [
          {
            operationId: OP('sync-epi-trans'),
            entidade: 'SOLICITACAO_TRANSICAO',
            acao: 'CREATE',
            payload: {
              depositoId: dep,
              requestId: epi.id,
              para: 'ENVIADA',
              assinaturaMatricula: 'F10-MEC',
            },
          },
        ],
      },
    });
    assert.equal(trans.statusCode, 200, trans.body);
    const t = trans.json();
    assert.equal(t.errors.length, 0, JSON.stringify(t.errors));
    assert.equal(t.acks[0].operationId, OP('sync-epi-trans'));

    const antes = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/requests?tipo=EPI`,
      headers: auth(liderToken, DEV_LDR),
    });
    const depois = antes.json().solicitacoes.find((r: { matricula: string }) => r.matricula === 'F10-MEC');
    assert.equal(depois.status, 'ENVIADA');
  });

  it('dono exclui solicitação EPI sincronizada → fora da lista + log SOLICITACAO_EXCLUIDA', async () => {
    const ldr = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/requests?tipo=EPI`,
      headers: auth(liderToken, DEV_LDR),
    });
    const epi = ldr.json().solicitacoes.find((r: { id: string; matricula: string }) => r.matricula === 'F10-MEC');
    assert.ok(epi, 'solicitação EPI do mecânico não encontrada');

    const res = await app.inject({
      method: 'POST',
      url: `/deposits/${dep}/requests/${epi.id}/transition`,
      headers: auth(mecToken, DEV_MEC),
      payload: { operationId: OP('mec-exclui-epi'), para: 'EXCLUIDA', assinaturaMatricula: 'F10-MEC' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().solicitacao.status, 'EXCLUIDA');

    const depois = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/requests?tipo=EPI`,
      headers: auth(liderToken, DEV_LDR),
    });
    assert.ok(
      !depois.json().solicitacoes.some((r: { id: string }) => r.id === epi.id),
      'solicitação excluída pelo dono veio na lista',
    );

    const logs = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/logs`,
      headers: auth(mecToken, DEV_MEC),
    });
    const tipos = logs.json().logs.map((l: { tipo: string }) => l.tipo);
    assert.ok(tipos.includes('SOLICITACAO_EXCLUIDA'), `faltou SOLICITACAO_EXCLUIDA: ${tipos.join(',')}`);
  });
});