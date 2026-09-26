import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app';
import { ensureMigrated, resetDb } from './helpers';
import { closePool } from '../src/db/pool';
import { createUser } from '../src/repos/usersRepo';
import { grantDepositAccess } from '../src/repos/depositsRepo';

const DEV_LIDER = 'dev-fase19-lider';
const DEV_MEC = 'dev-fase19-mec';
const DEV_OUT = 'dev-fase19-outro';

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

describe('fase19 - lista de divergências (pendências de reposição no espelho)', () => {
  let app: FastifyInstance;
  let liderToken: string;
  let mecToken: string;
  let outroToken: string;
  let dep: string;

  before(async () => {
    await ensureMigrated();
    await resetDb();
    app = await buildApp({ jwtSecret: 'test-secret' });

    const lider = await seedUser({ matricula: 'F9-LDR', nome: 'Leo', sobrenome: 'Lider', perfil: 'LIDER' });
    const mec = await seedUser({ matricula: 'F9-MEC', nome: 'Mario', sobrenome: 'Mec', perfil: 'MECANICO' });
    await seedUser({ matricula: 'F9-OUT', nome: 'Oscar', sobrenome: 'Fora', perfil: 'MECANICO' });

    liderToken = (await login(app, 'F9-LDR', DEV_LIDER)).accessToken;
    mecToken = (await login(app, 'F9-MEC', DEV_MEC)).accessToken;
    outroToken = (await login(app, 'F9-OUT', DEV_OUT)).accessToken;

    const c = await app.inject({
      method: 'POST',
      url: '/deposits',
      headers: auth(liderToken, DEV_LIDER),
      payload: { numero: '4801', nome: 'Divergências', matriculaConfirmacao: 'F9-LDR' },
    });
    assert.equal(c.statusCode, 200, c.body);
    dep = c.json().deposito.id;
    await grantDepositAccess({ userId: mec.id, depositoId: dep, concedidoPor: lider.id });

    const imp = await app.inject({
      method: 'POST',
      url: `/deposits/${dep}/enxoval/import`,
      headers: auth(liderToken, DEV_LIDER),
      payload: {
        motivo: 'Base fase19',
        matriculaConfirmacao: 'F9-LDR',
        itens: [
          { codigoSap: '1002341', textoBreve: 'Parafuso M8x20', qtdOficial: 10, qtdAtual: 10, utilizacaoLivre: true, unidadeMedida: 'pç' },
          { codigoSap: '1002342', textoBreve: 'Porca M8', qtdOficial: 20, qtdAtual: 20, utilizacaoLivre: false, unidadeMedida: 'pç' },
          { codigoSap: '1002343', textoBreve: 'Arruela M8', qtdOficial: 1, qtdAtual: 1, utilizacaoLivre: false },
        ],
      },
    });
    assert.equal(imp.statusCode, 200, imp.body);
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  async function baixa(codigoSap: string, quantidade: number, reposicao: boolean) {
    const res = await app.inject({
      method: 'POST',
      url: `/deposits/${dep}/goldbox/baixa`,
      headers: auth(liderToken, DEV_LIDER),
      payload: {
        operationId: 'op-f19-' + Math.random().toString(36).slice(2, 10),
        codigoSap,
        quantidade,
        reposicao,
        origem: 'ONLINE',
        dispositivo: 'test-pwa',
        dataHora: new Date().toISOString(),
        assinaturaMatricula: 'F9-LDR',
        matriculaConfirmacao: 'F9-LDR',
      },
    });
    assert.equal(res.statusCode, 200, res.body);
    return res.json();
  }

  async function get(overrides: Record<string, unknown> = {}) {
    const query = Object.entries(overrides)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');
    return app.inject({
      method: 'GET',
      url: `/deposits/${dep}/divergences${query ? `?${query}` : ''}`,
      headers: auth(liderToken, DEV_LIDER),
    });
  }

  it('baixa com é reposição cria pendência e baixa que zera o saldo cria SALDO_NEGATIVO', async () => {
    const b1 = await baixa('1002341', 2, true);
    assert.equal(b1.divergenciaCriada, false);
    const b2 = await baixa('1002343', 3, true);
    assert.equal(b2.divergenciaCriada, true);
  });

  it('GET /divergences lista as pendências ABERTAS com descrição do enxoval corrente', async () => {
    const res = await get({ status: 'ABERTA' });
    assert.equal(res.statusCode, 200, res.body);
    const { divergencias } = res.json();
    assert.ok(divergencias.length >= 2);
    const rep = divergencias.find((d: { codigoSap: string; tipo: string }) => d.codigoSap === '1002341' && d.tipo === 'REPOSICAO');
    assert.ok(rep);
    assert.equal(rep.status, 'ABERTA');
    assert.equal(rep.quantidade, 2);
    assert.equal(rep.descricao, 'Parafuso M8x20');
    const neg = divergencias.find((d: { codigoSap: string; tipo: string }) => d.codigoSap === '1002343' && d.tipo === 'SALDO_NEGATIVO');
    assert.ok(neg);
    assert.equal(neg.descricao, 'Arruela M8');
  });

  it('filtro tipo=REPOSICAO devolve apenas reposições', async () => {
    const res = await get({ tipo: 'REPOSICAO' });
    assert.equal(res.statusCode, 200, res.body);
    const { divergencias } = res.json();
    assert.ok(divergencias.length >= 1);
    assert.ok(divergencias.every((d: { tipo: string }) => d.tipo === 'REPOSICAO'));
  });

  it('usuário do mesmo depósito consegue listar; usuário sem acesso recebe 403', async () => {
    const mec = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/divergences`,
      headers: auth(mecToken, DEV_MEC),
    });
    assert.equal(mec.statusCode, 200, mec.body);

    const out = await app.inject({
      method: 'GET',
      url: `/deposits/${dep}/divergences`,
      headers: auth(outroToken, DEV_OUT),
    });
    assert.equal(out.statusCode, 403, out.body);
  });

  it('sem token → 401', async () => {
    const res = await app.inject({ method: 'GET', url: `/deposits/${dep}/divergences` });
    assert.equal(res.statusCode, 401, res.body);
  });

  it('entrada resolve a REPOSICAO e GET com status=RESOLVIDA mostra o histórico com responsável', async () => {
    const entrada = await app.inject({
      method: 'POST',
      url: `/deposits/${dep}/goldbox/entrada`,
      headers: auth(liderToken, DEV_LIDER),
      payload: {
        operationId: 'op-f19-ent-' + Math.random().toString(36).slice(2, 10),
        codigoSap: '1002341',
        quantidade: 5,
        origem: 'ONLINE',
        dispositivo: 'test-pwa',
        dataHora: new Date().toISOString(),
        assinaturaMatricula: 'F9-LDR',
        matriculaConfirmacao: 'F9-LDR',
      },
    });
    assert.equal(entrada.statusCode, 200, entrada.body);
    assert.equal(entrada.json().divergenciasFechadas, 1);

    const abertas = await get({ status: 'ABERTA', tipo: 'REPOSICAO' });
    const aindaAberta = abertas.json().divergencias.find(
      (d: { codigoSap: string }) => d.codigoSap === '1002341',
    );
    assert.ok(!aindaAberta);

    const resolvidas = await get({ status: 'RESOLVIDA' });
    const div = resolvidas.json().divergencias.find(
      (d: { codigoSap: string; tipo: string }) => d.codigoSap === '1002341' && d.tipo === 'REPOSICAO',
    );
    assert.ok(div);
    assert.equal(div.resolvidoPor, 'F9-LDR');
    assert.ok(div.resolvidoEm);
  });
});