import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app';
import { ensureMigrated, resetDb } from './helpers';
import { closePool } from '../src/db/pool';
import { createUser } from '../src/repos/usersRepo';
import { grantDepositAccess } from '../src/repos/depositsRepo';

const DEV_LIDER = 'dev-fase21-lider';
const DEV_MEC = 'dev-fase21-mec';
const DEV_OUT = 'dev-fase21-outro';

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

describe('fase21 - CRUD de consumíveis/EPIs e solicitações por qualquer usuário', () => {
  let app: FastifyInstance;
  let liderToken: string;
  let mecToken: string;
  let outroToken: string;
  let dep: string;

  before(async () => {
    await ensureMigrated();
    await resetDb();
    app = await buildApp({ jwtSecret: 'test-secret' });

    const lider = await seedUser({ matricula: 'F21-LDR', nome: 'Leo', sobrenome: 'Lider', perfil: 'LIDER' });
    const mec = await seedUser({ matricula: 'F21-MEC', nome: 'Mario', sobrenome: 'Mec', perfil: 'MECANICO' });
    await seedUser({ matricula: 'F21-OUT', nome: 'Oscar', sobrenome: 'Fora', perfil: 'MECANICO' });

    liderToken = (await login(app, 'F21-LDR', DEV_LIDER)).accessToken;
    mecToken = (await login(app, 'F21-MEC', DEV_MEC)).accessToken;
    outroToken = (await login(app, 'F21-OUT', DEV_OUT)).accessToken;

    const c = await app.inject({
      method: 'POST',
      url: '/deposits',
      headers: auth(liderToken, DEV_LIDER),
      payload: { numero: '4901', nome: 'Catálogo remodelado', matriculaConfirmacao: 'F21-LDR' },
    });
    assert.equal(c.statusCode, 200, c.body);
    dep = c.json().deposito.id;
    await grantDepositAccess({ userId: mec.id, depositoId: dep, concedidoPor: lider.id });
  });

  after(async () => {
    await app.close();
    await closePool();
  });

  async function listarConsumiveis(token = mecToken, device = DEV_MEC) {
    const res = await app.inject({ method: 'GET', url: `/deposits/${dep}/consumables`, headers: auth(token, device) });
    assert.equal(res.statusCode, 200, res.body);
    return res.json().consumiveis as Array<{ id: string; codigo: string; descricao: string; unidade: string; estoqueMinimo: number; estoqueAtual: number }>;
  }

  async function listarPpe(token = mecToken, device = DEV_MEC) {
    const res = await app.inject({ method: 'GET', url: `/deposits/${dep}/ppe`, headers: auth(token, device) });
    assert.equal(res.statusCode, 200, res.body);
    return res.json().ppe as Array<{ id: string; codigo: string; descricao: string }>;
  }

  describe('catálogo de consumíveis', () => {
    let itemId: string;

    it('mecânico cadastra consumível direto no catálogo (sem entrada)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/estoque/CONSUMIVEL`,
        headers: auth(mecToken, DEV_MEC),
        payload: {
          codigo: 'OLEO-15W40',
          descricao: 'Óleo motor 15W40',
          unidade: 'litro',
          estoqueMinimo: 5,
          assinaturaMatricula: 'F21-MEC',
          matriculaConfirmacao: 'F21-MEC',
        },
      });
      assert.equal(res.statusCode, 200, res.body);
      itemId = res.json().item.itemId as string;

      const lista = await listarConsumiveis();
      const criado = lista.find((c) => c.codigo === 'OLEO-15W40');
      assert.ok(criado);
      assert.equal(criado.descricao, 'Óleo motor 15W40');
      assert.equal(criado.unidade, 'litro');
      assert.equal(criado.estoqueMinimo, 5);
      assert.equal(criado.estoqueAtual, 0);
    });

    it('código duplicado → 409 e payload inválido → 400', async () => {
      const dup = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/estoque/CONSUMIVEL`,
        headers: auth(mecToken, DEV_MEC),
        payload: { codigo: 'OLEO-15W40', descricao: 'Duplicado', assinaturaMatricula: 'F21-MEC' },
      });
      assert.equal(dup.statusCode, 409, dup.body);

      const invalido = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/estoque/CONSUMIVEL`,
        headers: auth(mecToken, DEV_MEC),
        payload: { descricao: 'Sem código', assinaturaMatricula: 'F21-MEC' },
      });
      assert.equal(invalido.statusCode, 400, invalido.body);
    });

    it('mecânico edita o item (inclusive o código)', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/deposits/${dep}/estoque/CONSUMIVEL/${itemId}`,
        headers: auth(mecToken, DEV_MEC),
        payload: {
          codigo: 'OLEO-15W40-REV',
          descricao: 'Óleo motor 15W40 (revisado)',
          unidade: 'L',
          estoqueMinimo: 8,
          assinaturaMatricula: 'F21-MEC',
          matriculaConfirmacao: 'F21-MEC',
        },
      });
      assert.equal(res.statusCode, 200, res.body);

      const lista = await listarConsumiveis();
      const editado = lista.find((c) => c.id === itemId);
      assert.ok(editado);
      assert.equal(editado.codigo, 'OLEO-15W40-REV');
      assert.equal(editado.descricao, 'Óleo motor 15W40 (revisado)');
      assert.equal(editado.unidade, 'L');
      assert.equal(editado.estoqueMinimo, 8);
    });

    it('editar para um código já existente → 409; item inexistente → 404', async () => {
      await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/estoque/CONSUMIVEL`,
        headers: auth(mecToken, DEV_MEC),
        payload: { codigo: 'FILTRO-X', descricao: 'Filtro X', assinaturaMatricula: 'F21-MEC' },
      });
      const conflito = await app.inject({
        method: 'PUT',
        url: `/deposits/${dep}/estoque/CONSUMIVEL/${itemId}`,
        headers: auth(mecToken, DEV_MEC),
        payload: { codigo: 'FILTRO-X', descricao: 'Colidindo', assinaturaMatricula: 'F21-MEC' },
      });
      assert.equal(conflito.statusCode, 409, conflito.body);

      const naoExiste = await app.inject({
        method: 'PUT',
        url: `/deposits/${dep}/estoque/CONSUMIVEL/nao-existe`,
        headers: auth(mecToken, DEV_MEC),
        payload: { codigo: 'X', descricao: 'X', assinaturaMatricula: 'F21-MEC' },
      });
      assert.equal(naoExiste.statusCode, 404, naoExiste.body);
    });

    it('usuário sem acesso ao depósito recebe 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/estoque/CONSUMIVEL`,
        headers: auth(outroToken, DEV_OUT),
        payload: { codigo: 'SEM-ACESSO', descricao: 'Sem acesso', assinaturaMatricula: 'F21-OUT' },
      });
      assert.equal(res.statusCode, 403, res.body);
    });
  });

  describe('catálogo de EPIs', () => {
    it('cadastra e edita EPI (qualquer usuário)', async () => {
      const c = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/estoque/EPI`,
        headers: auth(mecToken, DEV_MEC),
        payload: { codigo: 'LUVA-NIT', descricao: 'Luva nitrílica', estoqueMinimo: 2, assinaturaMatricula: 'F21-MEC' },
      });
      assert.equal(c.statusCode, 200, c.body);
      const id = c.json().item.itemId as string;

      const ed = await app.inject({
        method: 'PUT',
        url: `/deposits/${dep}/estoque/EPI/${id}`,
        headers: auth(mecToken, DEV_MEC),
        payload: { codigo: 'LUVA-NIT-P', descricao: 'Luva nitrílica P', estoqueMinimo: 4, assinaturaMatricula: 'F21-MEC' },
      });
      assert.equal(ed.statusCode, 200, ed.body);

      const lista = await listarPpe();
      assert.ok(lista.some((p) => p.codigo === 'LUVA-NIT-P'));
    });
  });

  describe('solicitações', () => {
    it('enviar:true cria a solicitação já ENVIADA', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/requests`,
        headers: auth(mecToken, DEV_MEC),
        payload: {
          operationId: 'op-f21-req-enviar',
          tipo: 'CONSUMIVEL',
          itens: [{ codigo: 'OLEO-15W40-REV', descricao: 'Óleo', qtd: 3 }],
          enviar: true,
          assinaturaMatricula: 'F21-MEC',
          matriculaConfirmacao: 'F21-MEC',
        },
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().solicitacao.status, 'ENVIADA');
    });

    it('sem enviar continua RASCUNHO (backcompat)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/deposits/${dep}/requests`,
        headers: auth(liderToken, DEV_LIDER),
        payload: {
          operationId: 'op-f21-req-rascunho',
          tipo: 'CONSUMIVEL',
          itens: [{ codigo: 'OLEO-15W40-REV', descricao: 'Óleo', qtd: 1 }],
          assinaturaMatricula: 'F21-LDR',
          matriculaConfirmacao: 'F21-LDR',
        },
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().solicitacao.status, 'RASCUNHO');
    });
  });
});
