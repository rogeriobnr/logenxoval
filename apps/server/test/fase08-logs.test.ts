import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app';
import { ensureMigrated, resetDb } from './helpers';
import { closePool } from '../src/db/pool';
import { createUser } from '../src/repos/usersRepo';
import { grantDepositAccess } from '../src/repos/depositsRepo';

const DEV_LDR = 'dev-fase08-lider';
const DEV_MEC = 'dev-fase08-mec';
const OP = (n: string) => `op-fase08-${n}`;

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

describe('fase08 - logs e calendário', () => {
  let app: FastifyInstance;
  let liderToken: string;
  let mecToken: string;
  let dep: string;

  before(async () => {
    await ensureMigrated();
    await resetDb();
    app = await buildApp({ jwtSecret: 'test-secret' });

    const lider = await seedUser({ matricula: 'F8-LDR', nome: 'Leo', sobrenome: 'Lider', perfil: 'LIDER' });
    const mec = await seedUser({ matricula: 'F8-MEC', nome: 'Mario', sobrenome: 'Mec', perfil: 'MECANICO' });

    liderToken = (await login(app, 'F8-LDR', DEV_LDR)).accessToken;
    mecToken = (await login(app, 'F8-MEC', DEV_MEC)).accessToken;

    const c = await app.inject({
      method: 'POST',
      url: '/deposits',
      headers: auth(liderToken, DEV_LDR),
      payload: { numero: '5508', nome: 'Depósito Logs', matriculaConfirmacao: 'F8-LDR' },
    });
    assert.equal(c.statusCode, 200, c.body);
    dep = c.json().deposito.id;
    await grantDepositAccess({ userId: mec.id, depositoId: dep, concedidoPor: lider.id });

    const imp = await app.inject({
      method: 'POST',
      url: `/deposits/${dep}/enxoval/import`,
      headers: auth(liderToken, DEV_LDR),
      payload: {
        motivo: 'Base fase08',
        matriculaConfirmacao: 'F8-LDR',
        itens: [
          { codigoSap: '1002341', textoBreve: 'Parafuso M8x20', qtdOficial: 10, qtdAtual: 10, utilizacaoLivre: true },
        ],
      },
    });
    assert.equal(imp.statusCode, 200, imp.body);

    // BAIXA (mecânico)
    const b = await app.inject({
      method: 'POST',
      url: `/deposits/${dep}/goldbox/baixa`,
      headers: auth(mecToken, DEV_MEC),
      payload: {
        operationId: OP('baixa'),
        codigoSap: '1002341',
        descricao: 'Parafuso M8x20',
        quantidade: 1,
        reposicao: false,
        origem: 'ONLINE',
        dispositivo: DEV_MEC,
        dataHora: new Date().toISOString(),
        assinaturaMatricula: 'F8-MEC',
        matriculaConfirmacao: 'F8-MEC',
      },
    });
    assert.equal(b.statusCode, 200, b.body);

    // ENTRADA_PECA_AVULSA (líder)
    const sp = await app.inject({
      method: 'POST',
      url: `/deposits/${dep}/spare-parts`,
      headers: auth(liderToken, DEV_LDR),
      payload: {
        operationId: OP('entrada-peca'),
        codigoSap: '1002341',
        descricao: 'Parafuso M8x20',
        origem: 'BACKLOG',
        quantidade: 2,
        assinaturaMatricula: 'F8-LDR',
      },
    });
    assert.equal(sp.statusCode, 200, sp.body);

    // CONFERENCIA (líder)
    const cf = await app.inject({
      method: 'POST',
      url: `/deposits/${dep}/inspections`,
      headers: auth(liderToken, DEV_LDR),
      payload: {
        hora: '10:15',
        assinaturaMatricula: 'F8-LDR',
        matriculaConfirmacao: 'F8-LDR',
        itens: [{ codigoSap: '1002341', qtdFisica: 9, observacao: 'conferido' }],
      },
    });
    assert.equal(cf.statusCode, 200, cf.body);
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  it('GET /logs lista os registros do depósito em camelCase, mais recentes primeiro', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/logs`,
      headers: auth(liderToken, DEV_LDR),
    });
    assert.equal(res.statusCode, 200, res.body);
    const { logs } = res.json();
    const tipos = logs.map((l: { tipo: string }) => l.tipo);
    assert.ok(tipos.includes('BAIXA'), `esperava BAIXA: ${JSON.stringify(tipos)}`);
    assert.ok(tipos.includes('ENTRADA_PECA_AVULSA'), `esperava ENTRADA_PECA_AVULSA: ${JSON.stringify(tipos)}`);
    assert.ok(tipos.includes('CONFERENCIA'), `esperava CONFERENCIA: ${JSON.stringify(tipos)}`);

    const l0 = logs[0];
    assert.ok('dataHora' in l0, 'chave deve ser camelCase dataHora');
    assert.ok('usuarioId' in l0, 'chave deve ser camelCase usuarioId');
    assert.ok('operacaoId' in l0, 'chave deve ser camelCase operacaoId');
    assert.ok('depositoId' in l0 && l0.depositoId === dep, 'depositoId deve ser preenchido');

    // ordenação desc por dataHora
    for (let i = 1; i < logs.length; i++) {
      assert.ok(new Date(logs[i - 1].dataHora).getTime() >= new Date(logs[i].dataHora).getTime());
    }
  });

  it('filtra por tipo', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/logs?tipo=BAIXA`,
      headers: auth(liderToken, DEV_LDR),
    });
    assert.equal(res.statusCode, 200, res.body);
    const { logs } = res.json();
    assert.ok(logs.length > 0);
    for (const l of logs) assert.equal(l.tipo, 'BAIXA');
  });

  it('filtra por matrícula', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/logs?matricula=F8-MEC`,
      headers: auth(liderToken, DEV_LDR),
    });
    assert.equal(res.statusCode, 200, res.body);
    const { logs } = res.json();
    assert.ok(logs.length > 0);
    for (const l of logs) assert.equal(l.matricula, 'F8-MEC');
  });

  it('filtra por janela de data — janela no passado retorna lista vazia', async () => {
  const res = await app.inject({
    method: 'GET',
    url: `/deposits/${dep}/logs?dataIni=2020-01-01T00:00:00.000Z&dataFim=2020-01-02T00:00:00.000Z`,
    headers: auth(liderToken, DEV_LDR),
  });
  assert.equal(res.statusCode, 200, res.body);
  const { logs } = res.json();
  assert.ok(Array.isArray(logs));
  assert.equal(logs.length, 0);
});

  it('query inválida → 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/logs?tipo=NAO_EXISTE`,
      headers: auth(liderToken, DEV_LDR),
    });
    assert.equal(res.statusCode, 400, res.body);
  });

  it('usuário sem acesso ao depósito → 403', async () => {
    const d2 = await app.inject({
      method: 'POST',
      url: '/deposits',
      headers: auth(liderToken, DEV_LDR),
      payload: { numero: '5599', nome: 'Depósito Restrito', matriculaConfirmacao: 'F8-LDR' },
    });
    const dep2 = d2.json().deposito.id;
    await new Promise((r) => setTimeout(r, 5));
    // mecânico sem acesso a dep2 não vê logs
    const res = await app.inject({
      method: 'GET',
      url: `/deposits/${dep2}/logs`,
      headers: auth(mecToken, DEV_MEC),
    });
    assert.equal(res.statusCode, 403, res.body);
  });
});